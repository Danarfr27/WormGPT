export default async function handler(req, res) {
  const requestId = crypto.randomUUID?.() || Date.now().toString();

  if (req.method !== 'POST') {
    console.warn(`[${requestId}] Invalid method:`, req.method);
    return res.status(405).json({ error: 'Method not allowed', requestId });
  }

  const { contents } = req.body || {};

  console.log(`[${requestId}] ===== INCOMING REQUEST =====`);
  console.log(`[${requestId}] Method:`, req.method);
  console.log(`[${requestId}] Body:`, JSON.stringify(req.body, null, 2));

  const API_KEY = process.env.GENERATIVE_API_KEY;
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  if (!API_KEY) {
    console.error(`[${requestId}] Missing GENERATIVE_API_KEY`);
    return res.status(500).json({
      error: 'Server not configured',
      cause: 'ENV_MISSING',
      requestId
    });
  }

  if (!contents) {
    console.error(`[${requestId}] Missing contents in body`);
    return res.status(400).json({
      error: 'Bad request',
      cause: 'CONTENTS_MISSING',
      requestId
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

    const raw = await response.text();
    let data;

    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error(`[${requestId}] Failed to parse JSON:`, raw);
      return res.status(502).json({
        error: 'Invalid JSON from Google API',
        cause: 'PARSE_ERROR',
        requestId
      });
    }

    console.log(`[${requestId}] ===== GEMINI RESPONSE =====`);
    console.log(`[${requestId}] Status:`, response.status);
    console.log(`[${requestId}] Body:`, JSON.stringify(data, null, 2));

    if (!response.ok) {
      const cause =
        data?.error?.message ||
        data?.error?.status ||
        'UNKNOWN_EXTERNAL_ERROR';

      console.error(`[${requestId}] External API failed:`, cause);

      return res.status(502).json({
        error: 'External API error',
        cause,
        status: response.status,
        requestId
      });
    }

    return res.status(200).json({
      ...data,
      requestId
    });

  } catch (error) {
    console.error(`[${requestId}] Proxy exception:`, error.message);
    console.error(error.stack);

    return res.status(500).json({
      error: 'Internal server error',
      cause: error.message,
      requestId
    });
  }
}
