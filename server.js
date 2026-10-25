const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
const APP_TOKEN = (process.env.SANX_APP_TOKEN || '').trim();
const MAX_BODY_BYTES = 32 * 1024;

const SYSTEM_PROMPTS = {
  santai_indonesia: 'Kamu adalah SANX AI, asisten pribadi milik M. IKSAN IRSAD. Jawab dengan bahasa Indonesia sehari-hari yang santai, ramah, jelas, dan membantu. Jangan mengaku mengetahui info terbaru jika belum memeriksanya.',
  mafa_maluku: 'Kamu adalah SANX AI, asisten pribadi milik M. IKSAN IRSAD. Gunakan gaya bicara santai Maluku Utara/Mafa secara natural, misalnya kita, ngana, tara, so, deng, torang bila sesuai. Jangan memaksakan dialek pada topik serius. Tetap jujur, jelas, dan membantu.'
};

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

async function readJson(req) {
  let body = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('Permintaan terlalu besar'), { status: 413 });
    body += chunk;
  }
  try { return JSON.parse(body || '{}'); }
  catch { throw Object.assign(new Error('JSON tidak valid'), { status: 400 }); }
}

async function askGemini(message, history, style) {
  if (!GEMINI_API_KEY) throw Object.assign(new Error('GEMINI_API_KEY belum diatur di Render'), { status: 503 });
  const contents = [];
  for (const item of history) {
    if (!item || typeof item.content !== 'string') continue;
    const role = item.role === 'assistant' ? 'model' : 'user';
    const content = item.content.trim().slice(0, 4000);
    if (content) contents.push({ role, parts: [{ text: content }] });
  }
  contents.push({ role: 'user', parts: [{ text: message }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPTS[style] || SYSTEM_PROMPTS.santai_indonesia }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const message = data?.error?.message || `Gemini API error HTTP ${resp.status}`;
    throw Object.assign(new Error(message.slice(0, 300)), { status: 502 });
  }
  const reply = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!reply) throw Object.assign(new Error('Balasan kosong dari Gemini. Coba kirim pesan lain.'), { status: 502 });
  return reply;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    return sendJson(res, 200, { name: 'SANX AI backend', owner: 'M. IKSAN IRSAD', status: 'online', endpoints: ['/health', 'POST /v1/chat'] });
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, aiConfigured: Boolean(GEMINI_API_KEY), model: GEMINI_MODEL });
  }
  if (req.method !== 'POST' || url.pathname !== '/v1/chat') return sendJson(res, 404, { error: 'Not found' });

  if (!APP_TOKEN || APP_TOKEN.length < 24) {
    return sendJson(res, 503, { error: 'SANX_APP_TOKEN belum diatur dengan aman di Render (gunakan token acak minimal 24 karakter)' });
  }
  const auth = req.headers.authorization || '';
  const supplied = auth.replace(/^Bearer\s+/i, '').trim();
  if (!supplied || supplied !== APP_TOKEN) return sendJson(res, 401, { error: 'Token aplikasi salah. Periksa Auth Token di Settings SANX AI.' });

  try {
    const parsed = await readJson(req);
    const message = typeof parsed.message === 'string' ? parsed.message.trim().slice(0, 4000) : '';
    if (!message) return sendJson(res, 400, { error: 'Pesan kosong' });
    const history = Array.isArray(parsed.history) ? parsed.history.slice(-16) : [];
    const style = parsed.systemStyle === 'mafa_maluku' ? 'mafa_maluku' : 'santai_indonesia';
    const reply = await askGemini(message, history, style);
    return sendJson(res, 200, { reply, usage: { remaining: null } });
  } catch (err) {
    console.error(err.message || err);
    return sendJson(res, err.status || 502, { error: err.message || 'Gagal menghubungi Gemini API' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SANX AI backend listening on port ${PORT}`);
  console.log(`Gemini key configured: ${Boolean(GEMINI_API_KEY)}`);
  console.log(`App token configured: ${Boolean(APP_TOKEN && APP_TOKEN.length >= 24)}`);
});
