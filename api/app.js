// GET /  -> entrega o aplicativo (private/controler27.html) somente com sessão válida.
// O HTML fica fora de "public/" de propósito: ele nunca é servido como arquivo estático.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, noStore, redirect, readSession, newSessionValue, sessionCookie, SESSION_DAYS } from './_lib.js';

let cached = null;
function loadHtml() {
  if (cached) return cached;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(process.cwd(), 'private', 'controler27.html'),
    path.join(here, '..', 'private', 'controler27.html')
  ];
  for (const p of candidates) {
    try { cached = fs.readFileSync(p); return cached; } catch (_) { /* tenta o próximo */ }
  }
  throw new Error('private/controler27.html não encontrado no deploy.');
}

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.statusCode = 405;
    return res.end('Método não permitido');
  }
  const cfg = env();
  const session = readSession(req, cfg);
  if (!session) return redirect(res, '/login');

  let body;
  try { body = loadHtml(); } catch (err) {
    console.error('[app]', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Erro interno: arquivo do aplicativo não encontrado no deploy.');
  }
  // sessão deslizante: renova os 90 dias a cada abertura do app
  res.setHeader('Set-Cookie', sessionCookie(newSessionValue(cfg), SESSION_DAYS * 86400));
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end(req.method === 'HEAD' ? undefined : body);
}
