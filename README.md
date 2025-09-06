# LiveStream Web (MVP)

Aplikasi livestreaming mirip TikTok (MVP) dengan fitur:
- Siaran langsung via WebRTC
- Penonton real-time (peer-to-peer kecil)
- Daftar live yang aktif
- Chat dan like/gift virtual real-time (WebSocket)
- Swipe feed vertikal untuk berpindah live

Arsitektur:
- Frontend: HTML/CSS/JS (tanpa build)
- Backend: Node.js + Express + ws (signaling + chat) di folder `server/`
- WebRTC: STUN publik Google. Untuk skala besar, ganti ke SFU (LiveKit/mediasoup).

## Menjalankan

1) Install dependencies server:
   npm install
   (Perintah ini akan membaca `server/package.json` via npm workdir root karena skrip `postinstall` tidak digunakan.)

2) Jalankan server signaling + static hosting:
   npm start

   - Server berjalan di http://localhost:3000
   - Frontend dilayani dari root proyek

3) Uji lokal di 2 tab browser:
   - Tab A tekan “Go Live”, beri judul.
   - Tab B masuk sebagai penonton, pilih live di feed, atau buka link yang dibagikan.

Catatan: Untuk jaringan yang ketat, Anda bisa menambahkan TURN server sendiri pada `assets/script.js` (konfigurasi iceServers).

## Struktur
- index.html: UI feed
- assets/style.css: gaya + layout
- assets/script.js: logika WebRTC, chat, feed
- server/index.js: Express + ws signaling + room state

## Pengembangan lanjut
- Auth + profil (JWT/OAuth)
- SFU (LiveKit/mediasoup) agar skalabel
- Rekaman VOD dan replay
- Moderasi, report, banned words
- Monetisasi gifts/coins dan payment gateway
