// Serverless function for Vercel to proxy requests to the Generative API
// Keeps API key on the server (set `GENERATIVE_API_KEY` in Vercel env vars)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contents } = req.body;

  // Read API key from environment only. Do NOT hard-code secrets in source.
  const API_KEY = process.env.GENERATIVE_API_KEY;
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (!API_KEY) {
    console.error('Missing GENERATIVE_API_KEY environment variable');
    return res.status(500).json({ error: 'Server not configured. Set GENERATIVE_API_KEY in environment.' });
  }

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

    if (!response.ok) {
      console.error('External API error', data);
      return res.status(response.status || 502).json({ error: 'External API error', details: data });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
}
