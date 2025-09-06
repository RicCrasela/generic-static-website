import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import { nanoid } from "nanoid";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const app = express();
app.use(cors());
app.use(express.json());

// Static serve frontend (index.html at project root)
app.use(express.static(ROOT));

// In-memory store
// liveId -> { id,title,host:{id,name},viewers:number, likes:number, gifts:number, createdAt, lastActive }
const lives = new Map();
// liveId -> Set<ws> viewers connections
const liveViewers = new Map();

function listLives() {
  return Array.from(lives.values()).map(l => ({
    ...l,
    viewers: (liveViewers.get(l.id)?.size || 0)
  }));
}

// Cleanup TTL for stale lives (no activity for 2 hours)
const TTL_MS = 2 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, live] of lives.entries()) {
    if ((now - (live.lastActive || live.createdAt)) > TTL_MS) {
      lives.delete(id);
      liveViewers.delete(id);
    }
  }
}, 60 * 1000);

// API
app.get("/api/lives", (req, res) => {
  res.json({ lives: listLives() });
});

app.post("/api/lives", (req, res) => {
  const { title, host } = req.body || {};
  if (!host || !host.id) return res.status(400).json({ error: "host required" });
  const id = nanoid(10);
  const live = { id, title: title || "Live", host, viewers: 0, likes: 0, gifts: 0, createdAt: Date.now(), lastActive: Date.now() };
  lives.set(id, live);
  broadcast({ type: "lives:update", lives: listLives() });
  res.json(live);
});

// HTTP server + WS
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}
function sendTo(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {
  ws.user = null;
  ws.joinedLive = null;

  // Kirim initial list
  sendTo(ws, { type: "lives:update", lives: listLives() });

  ws.on("message", async (buf) => {
    let msg = {};
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    switch (msg.type) {
      case "hello":
        ws.user = msg.user || null;
        break;

      case "join_live": {
        const { liveId } = msg;
        ws.joinedLive = liveId;
        if (!liveViewers.has(liveId)) liveViewers.set(liveId, new Set());
        liveViewers.get(liveId).add(ws);
        const live = lives.get(liveId);
        if (live) live.lastActive = Date.now();
        broadcast({ type: "viewer_count", liveId, count: liveViewers.get(liveId).size });
        broadcast({ type: "system", liveId, text: `${ws.user?.name || "penonton"} bergabung` });
        break;
      }

      case "leave_live": {
        const { liveId } = msg;
        if (liveViewers.has(liveId)) {
          liveViewers.get(liveId).delete(ws);
          broadcast({ type: "viewer_count", liveId, count: liveViewers.get(liveId).size });
          broadcast({ type: "system", liveId, text: `${ws.user?.name || "penonton"} keluar` });
        }
        ws.joinedLive = null;
        break;
      }

      case "live:started":
        // nothing; list already updated by POST /api/lives
        break;

      case "chat": {
        const live = lives.get(msg.liveId);
        if (live) live.lastActive = Date.now();
        // Moderasi kata terlarang sederhana
        const banned = ["kasar","jelek","bangsat"];
        let text = (msg.text || "").toString();
        const lowered = text.toLowerCase();
        for (const w of banned) {
          if (lowered.includes(w)) {
            // mask word
            const re = new RegExp(w, "gi");
            text = text.replace(re, "*".repeat(w.length));
          }
        }
        broadcast({ ...msg, text });
        break;
      }

      case "like": {
        const live = lives.get(msg.liveId);
        if (live) { live.likes = (live.likes || 0) + 1; live.lastActive = Date.now(); }
        broadcast({ ...msg, total: live?.likes || 0 });
        break;
      }

      case "gift": {
        const amount = Number(msg.amount || 10);
        const live = lives.get(msg.liveId);
        if (live) { live.gifts = (live.gifts || 0) + amount; live.lastActive = Date.now(); }
        broadcast({ ...msg, amount, total: live?.gifts || 0 });
        break;
      }

      case "signal": {
        // augment with role (host/viewer) hint for clients
        const role = msg.action === "offer" ? "viewer" :
                     msg.action === "answer" ? "host" : undefined;
        broadcast({ ...msg, role });
        break;
      }
    }
  });

  ws.on("close", () => {
    if (ws.joinedLive && liveViewers.has(ws.joinedLive)) {
      liveViewers.get(ws.joinedLive).delete(ws);
      broadcast({ type: "viewer_count", liveId: ws.joinedLive, count: liveViewers.get(ws.joinedLive).size });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("LiveStream server on http://localhost:" + PORT);
});