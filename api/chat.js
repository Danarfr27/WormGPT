// Serverless function for Vercel with API Key Rotation Strategy
// Supports fallback to multiple keys if one hits Rate Limit (429)

export default async function handler(req, res) {
  // 1. Validasi Method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. Ambil Data Body
  const { contents } = req.body;
  if (!contents) {
    return res.status(400).json({ error: 'Body "contents" is required' });
  }

  // 3. Konfigurasi Kunci & Model
  // Ambil semua key dari .env dan pisahkan berdasarkan koma
  const keysString = process.env.GEMINI_API_KEYS || process.env.GENERATIVE_API_KEY || '';
  const apiKeys = keysString.split(',').filter(k => k.trim().length > 0);
  
  // Default ke 1.5-flash jika env tidak diisi (karena 2.5 belum rilis publik saat ini)
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (apiKeys.length === 0) {
    console.error('Missing GEMINI_API_KEYS environment variable');
    return res.status(500).json({ error: 'Server configuration error: No API keys found.' });
  }

  // 4. Logika Rotasi Key (Failover)
  let lastError = null;
  let success = false;
  let finalData = null;

  // Loop mencoba setiap key yang ada
  for (let i = 0; i < apiKeys.length; i++) {
    const currentKey = apiKeys[i].trim();
    const externalApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${currentKey}`;

    try {
      // console.log(`[Attempt] Using Key Index: ${i} for Model: ${GEMINI_MODEL}`); // Uncomment untuk debug

      const response = await fetch(externalApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents })
      });

      // Jika Sukses (200 OK)
      if (response.ok) {
        finalData = await response.json();
        success = true;
        break; // KELUAR dari loop, kita sudah dapat datanya
      }

      // Jika Error 429 (Rate Limit / Kuota Habis)
      if (response.status === 429) {
        console.warn(`[Limit] Key ke-${i + 1} habis (429). Mencoba key berikutnya...`);
        lastError = { status: 429, message: 'Rate limit exceeded' };
        continue; // LANJUT ke iterasi loop berikutnya (Key selanjutnya)
      }

      // Jika Error Lain (Misal 400 Bad Request karena prompt salah)
      // Biasanya tidak perlu ganti key, karena salahnya di input user
      const errorData = await response.json();
      console.error(`[API Error] Key ${i}:`, errorData);
      lastError = { status: response.status, details: errorData };
      break; // Stop mencoba, karena ini bukan masalah kuota

    } catch (error) {
      console.error(`[Network Error] Key ${i}:`, error);
      lastError = { status: 500, message: 'Internal Network Error' };
      // Jika error koneksi, lanjut coba key berikutnya
    }
  }

  // 5. Kirim Response Akhir ke User
  if (success && finalData) {
    return res.status(200).json(finalData);
  } else {
    // Jika semua key sudah dicoba dan gagal semua
    return res.status(lastError?.status || 500).json({
      error: 'Generation failed',
      message: 'Semua API Key sedang sibuk atau bermasalah.',
      details: lastError
    });
  }
}

