const RATE_LIMIT = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 10_000;
  const max = 5;

  const data = RATE_LIMIT.get(ip) || [];
  const recent = data.filter(t => now - t < windowMs);
  recent.push(now);
  RATE_LIMIT.set(ip, recent);

  return recent.length > max;
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

  if (req.method !== 'POST') {
    console.warn('[405] Invalid method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket?.remoteAddress ||
    'unknown';

  if (isRateLimited(ip)) {
    console.warn('[429][LOCAL] IP:', ip);
    return res.status(429).json({
      error: 'Rate limit exceeded',
      source: 'local',
      message: 'Terlalu banyak request. Coba lagi dalam 10 detik.'
    });
  }

  const { contents } = req.body;

  console.log('====== REQUEST ======');
  console.log('IP:', ip);
  console.log('BODY:', JSON.stringify(req.body, null, 2));

  const API_KEY = process.env.GENERATIVE_API_KEY;
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  if (!API_KEY) {
    console.error('[CONFIG] Missing GENERATIVE_API_KEY');
    return res.status(500).json({
      error: 'Server not configured',
      source: 'config'
    });
  }

  const externalApiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`;

  try {
    const response = await fetch(externalApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
    });

    const data = await response.json();
    const geminiError = extractGeminiError(data);

    console.log('====== GEMINI RESPONSE ======');
    console.log(JSON.stringify(data, null, 2));

    if (response.status === 429) {
      console.error('[429][GEMINI]');
      return res.status(429).json({
        error: 'Rate limit',
        source: 'gemini',
        details: geminiError
      });
    }

    if (!response.ok) {
      console.error('[GEMINI ERROR]', response.status, geminiError);
      return res.status(response.status).json({
        error: 'Gemini API error',
        source: 'gemini',
        details: geminiError
      });
    }

    const duration = Date.now() - start;
    console.log('[200] Success in', duration, 'ms');

    return res.status(200).json({
      ok: true,
      model: GEMINI_MODEL,
      duration_ms: duration,
      result: data
    });

  } catch (err) {
    console.error('====== INTERNAL ERROR ======');
    console.error(err.stack || err.message);

    return res.status(500).json({
      error: 'Internal server error',
      source: 'internal',
      message: err.message
    });
  }
}
