// Serverless function for Vercel to proxy requests to the Generative API
// Supports rotating multiple API keys. Provide keys via:
// - `GENERATIVE_API_KEYS` (comma-separated, up to 5 keys) OR
// - single `GENERATIVE_API_KEY`

let rotationIndex = 0; // module-scoped; persists across warm lambda instances

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contents } = req.body;
  // Read API keys from environment. Prefer comma-separated multiple keys.
  const rawKeys = process.env.GENERATIVE_API_KEYS || process.env.GENERATIVE_API_KEY || '';
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const keys = rawKeys
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
    .slice(0, 5); // limit to 5 keys

  if (!keys.length) {
    console.error('Missing GENERATIVE_API_KEY(S) environment variable');
    return res.status(500).json({ error: 'Server not configured. Set GENERATIVE_API_KEYS or GENERATIVE_API_KEY in environment.' });
  }

  // Try keys in round-robin order starting from rotationIndex. If a key returns a retryable error
  // (401/403/429/5xx), try the next key until all keys are exhausted.
  const results = [];
  const total = keys.length;

  for (let attempt = 0; attempt < total; attempt++) {
    const keyIndex = (rotationIndex + attempt) % total;
    const API_KEY = keys[keyIndex];

    const externalApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`;

    try {
      const response = await fetch(externalApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contents })
      });

      const data = await response.json();

      if (response.ok) {
        // advance rotation index so next request uses next key
        rotationIndex = (keyIndex + 1) % total;
        return res.status(200).json(data);
      }

      // collect failed attempt details (masking key)
      results.push({ status: response.status, detail: data });

      // If status is non-retryable (like 400), stop and return immediately
      if (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403 && response.status !== 429) {
        console.error('Non-retryable error from Generative API', { status: response.status, detail: data });
        return res.status(response.status).json({ error: 'External API error', details: data });
      }

      // Otherwise, try next key
      console.warn(`Key index ${keyIndex} failed with status ${response.status}; trying next key.`);
    } catch (err) {
      results.push({ status: 'network_error', detail: String(err) });
      console.warn(`Network error with key index ${keyIndex}; trying next key.`);
    }
  }

  // All keys exhausted
  console.error('All API keys failed', results);
  return res.status(502).json({ error: 'All API keys failed', attempts: results });
}
