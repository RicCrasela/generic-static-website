/**
 * LiveStream Web (MVP++)
 * - Username login ringan (localStorage)
 * - Viewer presence & counter
 * - Moderasi kata terlarang (di server) + notifikasi sistem
 * - Gifts dengan nominal
 */

const state = {
  me: loadUser(),
  ws: null,
  slidesEl: document.getElementById("slides"),
  liveList: [],
  peers: new Map(), // key: liveId -> RTCPeerConnection
  roleByLive: new Map(), // "host" | "viewer"
  joinedLive: new Set(), // liveId yang sedang ditonton (visible)
};

const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function $(sel, el=document) { return el.querySelector(sel); }
function el(tag, attrs={}) { const e=document.createElement(tag); Object.assign(e, attrs); return e; }

function loadUser() {
  const saved = localStorage.getItem("me");
  if (saved) return JSON.parse(saved);
  const me = { id: Math.random().toString(36).slice(2, 10), name: "user" + Math.floor(Math.random()*900 + 100) };
  localStorage.setItem("me", JSON.stringify(me));
  return me;
}
function setUserName(name) {
  state.me.name = name;
  localStorage.setItem("me", JSON.stringify(state.me));
}

async function ensureLoggedIn() {
  if (!state.me?.name) {
    const n = prompt("Masukkan username:");
    if (n) setUserName(n.trim());
  }
}

async function fetchJSON(url, opts={}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function connectWS() {
  const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
  const ws = new WebSocket(wsUrl);
  state.ws = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "hello", user: state.me }));
  };

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    switch (msg.type) {
      case "lives:update":
        state.liveList = msg.lives || [];
        renderFeed();
        break;
      case "viewer_count":
        updateViewerCount(msg.liveId, msg.count);
        break;
      case "system":
        appendChat(msg.liveId, msg.text, true);
        break;
      case "signal":
        await handleSignal(msg);
        break;
      case "chat":
        appendChat(msg.liveId, `${msg.user.name}: ${msg.text}`);
        break;
      case "like":
        appendLikeGift(metaEl(msg.liveId), { kind: "like", total: msg.total, user: msg.user });
        break;
      case "gift":
        appendLikeGift(metaEl(msg.liveId), { kind: "gift", amount: msg.amount, total: msg.total, user: msg.user });
        break;
    }
  };
  ws.onclose = () => setTimeout(connectWS, 1000);
}
function wsSend(obj) { state.ws && state.ws.readyState === 1 && state.ws.send(JSON.stringify(obj)); }

function metaEl(liveId) {
  const slide = state.slidesEl.querySelector(`.slide[data-live-id="${liveId}"]`);
  return slide && $(".meta", slide);
}

function renderFeed() {
  const container = state.slidesEl;
  container.innerHTML = "";
  if (!state.liveList.length) {
    const placeholder = el("div", { className: "slide", dataset: { placeholder: "1" } });
    placeholder.innerHTML = `<div style="text-align:center;color:#fff;"><h2>Belum ada live</h2><p>Tekan “Go Live”.</p></div>`;
    container.appendChild(placeholder);
    return;
  }
  for (const live of state.liveList) {
    const slide = createSlide(live);
    container.appendChild(slide);
  }
}

function createSlide(live) {
  const tpl = document.getElementById("slideTpl");
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.liveId = live.id;

  $(".title", node).textContent = live.title;
  $(".meta", node).textContent = `${live.host.name} · ${live.viewers || 0} menonton · ❤0 · 🎁0`;

  const video = $("video", node);
  const likeBtn = $(".likeBtn", node);
  const giftBtn = $(".giftBtn", node);
  const shareBtn = $(".shareBtn", node);
  const input = $(".composer input", node);
  const sendBtn = $(".sendBtn", node);

  likeBtn.onclick = () => wsSend({ type:"like", liveId: live.id, user: state.me });
  giftBtn.onclick = async () => {
    const amount = Number(prompt("Gift amount (10/50/100)?", "10") || "10");
    if (!amount) return;
    wsSend({ type:"gift", liveId: live.id, user: state.me, amount });
  };
  shareBtn.onclick = async () => {
    const url = location.origin + "/?live=" + live.id;
    if (navigator.share) await navigator.share({ title: live.title, url });
    else { await navigator.clipboard.writeText(url); alert("Link disalin"); }
  };
  sendBtn.onclick = () => {
    const text = input.value.trim();
    if (!text) return;
    wsSend({ type:"chat", liveId: live.id, user: state.me, text });
    input.value = "";
  };

  // Presence join/leave when visible
  const onVisible = async (visible) => {
    if (visible) {
      if (!state.joinedLive.has(live.id)) {
        state.joinedLive.add(live.id);
        wsSend({ type:"join_live", liveId: live.id, user: state.me });
        await ensureViewerConnection(live, video);
      }
    } else {
      if (state.joinedLive.has(live.id)) {
        state.joinedLive.delete(live.id);
        wsSend({ type:"leave_live", liveId: live.id, user: state.me });
        stopPeer(live.id);
      }
    }
  };

  const observer = new IntersectionObserver(async (entries) => {
    for (const ent of entries) onVisible(ent.isIntersecting);
  }, { threshold: 0.6 });
  observer.observe(node);

  return node;
}

function appendChat(liveId, text, system=false) {
  const slide = state.slidesEl.querySelector(`.slide[data-live-id="${liveId}"]`);
  if (!slide) return;
  const chat = $(".chat", slide);
  const bubble = el("div", { className:"m" });
  bubble.textContent = text;
  if (system) bubble.style.opacity = "0.8";
  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;
}

function updateViewerCount(liveId, count) {
  const m = metaEl(liveId);
  if (!m) return;
  const parts = m.textContent.split("·");
  // Replace viewers part (middle)
  if (parts.length >= 1) {
    parts[1] = ` ${count} menonton `;
    m.textContent = parts.join("·");
  }
}

function appendLikeGift(metaNode, { kind, amount=0, total=0, user }) {
  if (!metaNode) return;
  // meta format: "host · X menonton · ❤L · 🎁G"
  const parts = metaNode.textContent.split("·").map(s => s.trim());
  const likeIndex = parts.findIndex(p => p.startsWith("❤"));
  const giftIndex = parts.findIndex(p => p.startsWith("🎁"));
  if (kind === "like" && likeIndex >= 0) {
    parts[likeIndex] = `❤${total}`;
  }
  if (kind === "gift" && giftIndex >= 0) {
    parts[giftIndex] = `🎁${total}`;
  }
  metaNode.textContent = `${parts[0]} · ${parts[1]} · ${parts[likeIndex]} · ${parts[giftIndex]}`;
}

// Host: start live
async function startLive() {
  await ensureLoggedIn();
  const title = prompt("Judul live?") || `Live ${state.me.name}`;
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

  const live = await fetchJSON("/api/lives", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ title, host: state.me })
  });

  // Tambahkan slide host di urutan pertama
  state.liveList.unshift(live);
  renderFeed();

  const slide = state.slidesEl.querySelector(`.slide[data-live-id="${live.id}"]`) || state.slidesEl.firstElementChild;
  const video = $("video", slide);
  video.muted = true;
  video.srcObject = stream;

  const pc = new RTCPeerConnection(ICE);
  state.peers.set(live.id, pc);
  state.roleByLive.set(live.id, "host");
  stream.getTracks().forEach(t => pc.addTrack(t, stream));

  pc.onicecandidate = (e) => {
    if (e.candidate) wsSend({ type:"signal", action:"candidate", liveId: live.id, from: state.me.id, data: e.candidate });
  };

  wsSend({ type:"live:started", liveId: live.id });
  alert("Live dimulai. Bagikan link: " + location.origin + "/?live=" + live.id);
}

// Viewer: connect to host
async function ensureViewerConnection(live, videoEl) {
  if (state.peers.has(live.id)) return;
  state.roleByLive.set(live.id, "viewer");

  const pc = new RTCPeerConnection(ICE);
  state.peers.set(live.id, pc);
  pc.onicecandidate = (e) => {
    if (e.candidate) wsSend({ type:"signal", action:"candidate", liveId: live.id, from: state.me.id, data: e.candidate });
  };
  pc.ontrack = (ev) => { videoEl.srcObject = ev.streams[0]; };

  const offer = await pc.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
  await pc.setLocalDescription(offer);
  wsSend({ type:"signal", action:"offer", liveId: live.id, from: state.me.id, data: offer });
}

function stopPeer(liveId) {
  const pc = state.peers.get(liveId);
  if (pc) {
    try { pc.getSenders().forEach(s=>s.track && s.track.stop()); } catch {}
    pc.close();
  }
  state.peers.delete(liveId);
  state.roleByLive.delete(liveId);
}

// Signaling handler
async function handleSignal(msg) {
  const { action, liveId, data, from, role } = msg;
  let pc = state.peers.get(liveId);

  // Host menerima offer dari viewer -> buat answer
  if (action === "offer" && role === "viewer") {
    if (!pc) {
      pc = new RTCPeerConnection(ICE);
      state.peers.set(liveId, pc);
      state.roleByLive.set(liveId, "host");

      // Ambil stream lokal dari video host
      const slide = state.slidesEl.querySelector(`.slide[data-live-id="${liveId}"]`);
      const video = slide && $("video", slide);
      const stream = video && video.srcObject;
      if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));

      pc.onicecandidate = (e) => {
        if (e.candidate) wsSend({ type:"signal", action:"candidate", liveId, from: state.me.id, data: e.candidate });
      };
    }
    await pc.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    wsSend({ type:"signal", action:"answer", liveId, from: state.me.id, data: answer, to: from });
    return;
  }

  // Viewer menerima answer dari host
  if (action === "answer" && role === "host") {
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(data));
    return;
  }

  // ICE
  if (action === "candidate") {
    if (!pc) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(data)); } catch {}
  }
}

document.getElementById("goLiveBtn").addEventListener("click", () => {
  startLive().catch(err => alert("Gagal mulai live: " + err.message));
});

// Inisialisasi
(async function init() {
  connectWS();
  try {
    const { lives } = await fetchJSON("/api/lives");
    state.liveList = lives || [];
    renderFeed();

    const params = new URLSearchParams(location.search);
    const liveId = params.get("live");
    if (liveId) {
      const idx = state.liveList.findIndex(l => l.id === liveId);
      if (idx >= 0) state.slidesEl.children[idx]?.scrollIntoView({ behavior:"smooth" });
    }
  } catch (e) {
    console.warn("Tidak bisa memuat daftar live:", e);
  }
})();