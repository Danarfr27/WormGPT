export default async function handler(req, res) {
  if (req.method !== 'POST') {
    console.warn('Invalid method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contents } = req.body;

  console.log("===== INCOMING REQUEST =====");
  console.log("Method:", req.method);
  console.log("Body:", JSON.stringify(req.body, null, 2));
  console.log("Contents:", JSON.stringify(contents, null, 2));

  const API_KEY = process.env.GENERATIVE_API_KEY;
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (!API_KEY) {
    console.error('Missing GENERATIVE_API_KEY');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const externalApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`;

  try {
    const response = await fetch(externalApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
    });

    const data = await response.json();

    console.log("===== GEMINI RESPONSE =====");
    console.log(JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error('External API error', data);
      return res.status(response.status || 502).json({
        error: 'External API error',
        details: data
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
}
