// Login único (a senha do aplicativo).
//   POST /api/auth?a=login  corpo {proof}  -> confere a prova e grava o cookie de sessão (90 dias)
//   GET  /api/me                           -> público: informa se há sessão ({auth:true|false})
//   GET  /logout                           -> apaga o cookie e volta para /
import {
  env, authConfigured, noStore, json, redirect, readJson, readSession, checkProof,
  newSessionValue, sessionCookie, SESSION_DAYS
} from './_lib.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function route(req) {
  if (req.query && req.query.a) return String(req.query.a);
  const p = String(req.url || '').split('?')[0];
  if (p.endsWith('/logout')) return 'logout';
  if (p.endsWith('/me')) return 'me';
  if (p.endsWith('/auth')) return 'login';
  return '';
}

export default async function handler(req, res) {
  noStore(res);
  const cfg = env();
  const a = route(req);

  if (a === 'me') {
    return json(res, 200, { user: null, isOwner: true, auth: !!readSession(req, cfg), configured: authConfigured(cfg) });
  }

  if (a === 'logout') {
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    if (req.method === 'POST') return json(res, 200, { ok: true });
    return redirect(res, '/');
  }

  if (a === 'login') {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Método não permitido.' }); }
    if (!authConfigured(cfg)) {
      return json(res, 500, { error: 'Servidor sem APP_PROOF_HASH (ou APP_PASSWORD) configurado na Vercel.' });
    }
    const body = await readJson(req);
    if (body && checkProof(cfg, body.proof)) {
      res.setHeader('Set-Cookie', sessionCookie(newSessionValue(cfg), SESSION_DAYS * 86400));
      console.log('[c27log]', JSON.stringify({ t: Date.now(), e: 'server_login_ok' }));
      return json(res, 200, { ok: true });
    }
    console.log('[c27log]', JSON.stringify({ t: Date.now(), e: 'server_login_fail' }));
    await sleep(900); // freia tentativas em série
    return json(res, 401, { error: 'Credencial recusada.' });
  }

  return json(res, 404, { error: 'Rota não encontrada.' });
}
