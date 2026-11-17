// POST /api/log -> recebe o log de uso do app e envia para os Logs da Vercel (Project > Logs).
// Não grava arquivo (a Vercel não tem disco) e ignora os "heartbeats" para não poluir.
import { env, noStore, json, readJson, readSession } from './_lib.js';

export default async function handler(req, res) {
  noStore(res);
  const cfg = env();
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método não permitido.' }); }
  const session = readSession(req, cfg);
  if (!session) return json(res, 401, { error: 'Não autorizado.' });

  const body = await readJson(req);
  const sid = String((body && body.sid) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  const list = Array.isArray(body && body.ev) ? body.ev.slice(0, 50) : [];
  for (const e of list) {
    const name = String((e && e.e) || '').slice(0, 40);
    if (!name || /heartbeat/i.test(name)) continue;
    let d = {};
    try {
      const raw = JSON.stringify((e && e.d) || {});
      d = raw.length <= 400 ? JSON.parse(raw) : raw.slice(0, 400) + '…'; // detalhes longos são cortados
    } catch (_) { d = {}; }
    console.log('[c27log]', JSON.stringify({ t: Number(e && e.t) || Date.now(), user: session.u, sid, e: name, d }));
  }
  res.statusCode = 204;
  res.end();
}
