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
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

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

    // Build a single text prompt from the incoming `contents` conversation array
    // contents expected shape: [{ role: 'user'|'model', parts:[{text:'...'}] }, ...]
    function buildPrompt(contentsArr) {
      if (!Array.isArray(contentsArr)) return String(contentsArr || '');
      const lines = [];
      for (const item of contentsArr) {
        const role = (item && item.role) ? item.role : 'user';
        let text = '';
        if (Array.isArray(item.parts)) {
          text = item.parts.map(p => (p && p.text) || '').join('\n');
        } else if (typeof item.content === 'string') {
          text = item.content;
        }
        if (text) {
          lines.push(`${role.toUpperCase()}: ${text}`);
        }
      }
      return lines.join('\n\n');
    }

    const promptText = buildPrompt(contents);

    const externalApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateText?key=${API_KEY}`;

    try {
      const response = await fetch(externalApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // Use `prompt.text` which is compatible with many examples of generateText
        body: JSON.stringify({ prompt: { text: promptText } })
      });

      const data = await response.json().catch(e => ({ parseError: String(e) }));

      if (response.ok) {
        // Try to extract a single text response from common fields, then normalize
        let aiText = '';
        try {
          if (data.candidates && data.candidates.length) {
            const cand = data.candidates[0];
            if (cand.content && Array.isArray(cand.content.parts)) {
              aiText = cand.content.parts.join('\n');
            } else if (typeof cand.output === 'string') {
              aiText = cand.output;
            }
          }
          if (!aiText && Array.isArray(data.output) && data.output[0] && data.output[0].content) {
            // some variants return output[0].content[0].text
            const contents = data.output[0].content;
            if (Array.isArray(contents)) {
              aiText = contents.map(c => c.text || c).join('\n');
            }
          }
          if (!aiText && typeof data.output === 'string') aiText = data.output;
        } catch (e) {
          // fallback to stringifying the raw data
          aiText = '';
        }

        if (!aiText) {
          // As fallback, include a short summary of raw response
          aiText = (data && (data.candidates && JSON.stringify(data.candidates).slice(0, 500))) || JSON.stringify(data).slice(0, 500);
        }

        rotationIndex = (keyIndex + 1) % total;

        // Normalize response shape expected by frontend (candidates[].content.parts[].text)
        const normalized = {
          candidates: [
            { content: { parts: [{ text: aiText }] } }
          ],
          raw: data
        };

        return res.status(200).json(normalized);
      }

      // collect failed attempt details (masking key)
      results.push({ status: response.status, detail: data });

      if (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403 && response.status !== 429) {
        console.error('Non-retryable error from Generative API', { status: response.status, detail: data });
        return res.status(response.status).json({ error: 'External API error', details: data });
      }

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
