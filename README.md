# Hestia Chat

Aplikasi web chat AI yang ringan. 100% frontend statis — backend-nya memakai
**Hestia Bridge** (endpoint OpenAI-compatible) via API key. Nol dependensi npm.

## Cara pakai

1. Buka web Hestia Bridge (https://hestia-bridge-production.up.railway.app)
2. Tambah provider, lalu klik **+ Tambah key** — salin key `hb-…`
3. Buka Hestia Chat → **Pengaturan** → isi:
   - Bridge Base URL: `https://hestia-bridge-production.up.railway.app/v1` (default)
   - API Key: key `hb-…` tadi
   - System prompt: opsional
4. Klik **Test koneksi** → **Simpan** → pilih model → mulai chat.

Key tersimpan di `localStorage` HP/browser masing-masing (tidak dikirim ke mana
pun selain Bridge). Riwayat chat juga tersimpan lokal dan bisa dihapus.

## Menjalankan

node server.js
# atau: PORT=8080 node server.js

## Struktur

- `server.js` — static server Node tanpa dependensi (serve `public/`, fallback index.html)
- `public/index.html` — UI chat
- `public/styles.css` — light theme, aksen oranye
- `public/app.js` — logic chat, streaming SSE, parser markdown mini, localStorage
