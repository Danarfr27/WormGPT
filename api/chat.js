// Serverless function for Vercel to proxy requests to the Generative API
// Supports rotating multiple API keys.

let rotationIndex = 0;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contents } = req.body;

  const rawKeys = process.env.GENERATIVE_API_KEYS || process.env.GENERATIVE_API_KEY || '';
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  const keys = rawKeys
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (!keys.length) {
    return res.status(500).json({ error: 'Missing API key(s)' });
  }

  const results = [];
  const total = keys.length;

  for (let attempt = 0; attempt < total; attempt++) {
    const keyIndex = (rotationIndex + attempt) % total;
    const API_KEY = keys[keyIndex];

    const externalApiUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`;

    try {
      const response = await fetch(externalApiUrl, {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents })
      });

      const data = await response.json();

      if (response.ok) {
        let aiText = "";

        try {
          const c = data.candidates?.[0]?.content?.parts;
          if (Array.isArray(c)) {
            aiText = c.map(p => p.text || "").join("\n");
          }
        } catch(e){}

        if (!aiText) aiText = JSON.stringify(data).slice(0,500);

        rotationIndex = (keyIndex + 1) % total;

        return res.status(200).json({
          candidates: [{ content: { parts: [{ text: aiText }] } }],
          raw: data
        });
      }

      results.push({ status: response.status, detail: data });

      if (response.status >= 400 && response.status < 500 &&
          ![401,403,429].includes(response.status)) {
        return res.status(response.status).json({ error: data });
      }

    } catch (err) {
      results.push({ status: 'network_error', detail: String(err) });
    }
  }

  return res.status(502).json({ error: 'All API keys failed', attempts: results });
}
