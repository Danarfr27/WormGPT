# Firdhan AI - Backend Proxy Setup (Vercel)

Ringkasan: memindahkan panggilan API ke backend (serverless) sehingga API key tidak terlihat di sisi client. Endpoint serverless sudah ditambahkan di `api/chat.js`.

Langkah cepat untuk deploy di Vercel (GitHub):

- 1. Push repo ke GitHub dan hubungkan repository ke Vercel.
- 2. Di dashboard Vercel, buka project -> Settings -> Environment Variables.
- 3. Tambahkan variabel environment berikut (Production/Preview/Development sesuai kebutuhan):

  - `GENERATIVE_API_KEY` : API key Google Generative Language (contoh: `AIza...`) — wajib.
  - `GEMINI_MODEL` : (opsional) model, default `gemini-2.5-flash`.

- 4. Commit dan push perubahan (sudah menghapus API key dari `index.html`). Vercel otomatis akan deploy dari branch yang terhubung.

Pengujian lokal (opsional):

1. Install Vercel CLI (jika ingin menjalankan serverless function lokal):

```powershell
npm i -g vercel
vercel login
vercel dev
```

2. Atau jalankan web server static sederhana dan gunakan `node` untuk memanggil API (ingat API key harus di-set di environment lokal saat testing). Contoh (PowerShell):

```powershell
$env:GENERATIVE_API_KEY="YOUR_KEY_HERE"
vercel dev
```

Catatan keamanan:

- Jangan menyimpan API key di file klien (seperti `index.html`).
- Pastikan `GENERATIVE_API_KEY` hanya diset di environment Vercel, bukan di kode sumber.

Jika Anda mau, saya bisa:

- Menambahkan validasi lebih ketat pada `api/chat.js`.
- Menambahkan rate-limit atau caching sederhana untuk mengurangi biaya.
