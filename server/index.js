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

const lives = new Map(); // liveId -> { id,title,host:{id,name},viewers:number }
function listLives() {
  return Array.from(lives.values()).map(l => ({ ...l, viewers: (l.viewers || 0) }));
}

// API
app.get("/api/lives", (req, res) => {
  res.json({ lives: listLives() });
});

app.post("/api/lives", (req, res) => {
  const { title, host } = req.body || {};
  if (!host || !host.id) return res.status(400).json({ error: "host required" });
  const id = nanoid(10);
  const live = { id, title: title || "Live", host, viewers: 0, createdAt: Date.now() };
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

  // Kirim initial list
  sendTo(ws, { type: "lives:update", lives: listLives() });

  ws.on("message", async (buf) => {
    let msg = {};
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    switch (msg.type) {
      case "hello":
        ws.user = msg.user || null;
        break;

      case "live:started":
        // nothing; list already updated by POST /api/lives
        break;

      case "chat":
      case "like":
      case "gift":
        broadcast({ ...msg });
        break;

      case "signal": {
        // augment with role (host/viewer) hint for clients
        // heuristik: jika pengirim mengirim offer berarti viewer; pengirim answer berarti host
        const role = msg.action === "offer" ? "viewer" :
                     msg.action === "answer" ? "host" : undefined;
        broadcast({ ...msg, role });
        break;
      }
    }
  });

  ws.on("close", () => {
    // For MVP we don't track per-connection live membership; cleanup is manual or via TTL
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("LiveStream server on http://localhost:" + PORT);
});