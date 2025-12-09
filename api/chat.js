// Simpan state rate limit di luar handler (Global scope dalam instance)
const RATE_LIMIT = new Map();

/**
 * Cek apakah IP terkena limit.
 * Settingan disesuaikan untuk Gemini Free Tier (Max ~15 RPM).
 * Kita set aman di 10 Request per 60 detik.
 */
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000; // Ubah ke 60 Detik (1 Menit)
  const max = 10;             // Maksimal 10 request per menit per IP

  const data = RATE_LIMIT.get(ip) || [];
  
  // Hapus data request yang sudah kadaluarsa (lebih dari 1 menit lalu)
  const recent = data.filter(t => now - t < windowMs);

  if (recent.length >= max) {
    return true; // Terkena limit
  }

  recent.push(now);
  RATE_LIMIT.set(ip, recent);
  
  // Optional: Bersihkan Map jika terlalu penuh (Garbage collection manual sederhana)
  if (RATE_LIMIT.size > 5000) {
    RATE_LIMIT.clear(); 
  }

  return false;
}

function extractGeminiError(data) {
  if (!data || !data.error) return null;
  return {
    code: data.error.code,
    status: data.error.status,
    message: data.error.message
  };
}

export default async function handler(req, res) {
  const start = Date.now();

  // 1. Validasi Method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // 2. Deteksi IP User (Support Vercel Proxy)
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown';

  // 3. Cek Rate Limit Lokal
  if (isRateLimited(ip)) {
    console.warn(`[429][LOCAL] IP: ${ip} hit rate limit.`);
    return res.status(429).json({
      error: 'Too Many Requests',
      source: 'local_proxy',
      message: 'Anda mengirim terlalu banyak pesan. Mohon tunggu 1 menit sebelum mencoba lagi.'
    });
  }

  // 4. Ambil Data Body
  const { contents } = req.body;
  if (!contents) {
    return res.status(400).json({ error: 'Body "contents" is required' });
  }

  // 5. Konfigurasi API & Model
  const API_KEY = process.env.GENERATIVE_API_KEY;
  // Default ke 1.5 Flash jika env tidak di-set
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash'; 

  if (!API_KEY) {
    console.error('[CONFIG] Missing GENERATIVE_API_KEY in Vercel');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const externalApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`;

  console.log(`[REQ] IP:${ip} | Model:${GEMINI_MODEL}`);

  try {
    // 6. Request ke Google Gemini
    const response = await fetch(externalApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
    });

    const data = await response.json();
    
    // 7. Handle Error dari Google (Terutama 429)
    if (!response.ok) {
      const geminiError = extractGeminiError(data);
      console.error('[GEMINI ERROR]', response.status, JSON.stringify(geminiError));

      // Jika Google kasih 429 (Limit Habis), kita teruskan statusnya
      if (response.status === 429) {
        return res.status(429).json({
          error: 'Gemini API Quota Exceeded',
          source: 'google_gemini',
          message: 'Server AI sedang sibuk (Kuota Habis). Coba lagi nanti.',
          details: geminiError
        });
      }

      return res.status(response.status).json({
        error: 'Upstream API Error',
        source: 'google_gemini',
        details: geminiError
      });
    }

    // 8. Sukses
    const duration = Date.now() - start;
    console.log(`[200] Success in ${duration}ms`);

    return res.status(200).json({
      ok: true,
      model: GEMINI_MODEL,
      result: data
    });

  } catch (err) {
    console.error('[INTERNAL ERROR]', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: err.message
    });
  }
}
