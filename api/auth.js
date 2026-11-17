// /login (página + formulário), /logout e /api/me  (rotas definidas no vercel.json)
import {
  env, noStore, json, redirect, readForm, readSession, safeEqual,
  newSessionValue, sessionCookie, SESSION_DAYS
} from './_lib.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function route(req) {
  if (req.query && req.query.a) return String(req.query.a);
  const p = String(req.url || '').split('?')[0];
  if (p.endsWith('/logout')) return 'logout';
  if (p.endsWith('/login')) return 'login';
  if (p.endsWith('/me')) return 'me';
  return '';
}

function loginPage(message) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Controler27 PRO - Acesso</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.25rem;
       background:#0b1220;color:#e5e7eb;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .card{width:100%;max-width:380px;background:#111a2e;border:1px solid #1f2b45;border-radius:18px;padding:1.75rem;
        box-shadow:0 20px 50px rgba(0,0,0,.45)}
  .logo{width:52px;height:52px;border-radius:14px;margin:0 auto 1rem;display:flex;align-items:center;justify-content:center;
        background:linear-gradient(135deg,#1d4ed8,#4f46e5 55%,#38bdf8);font-size:24px}
  h1{margin:0;text-align:center;font-size:1.35rem;font-weight:800}
  h1 span{color:#3b82f6}
  .ver{display:block;text-align:center;margin:.35rem 0 1.25rem;font:600 11px ui-monospace,Menlo,Consolas,monospace;color:#60a5fa}
  label{display:block;margin:.85rem 0 .35rem;font-size:12px;font-weight:700;color:#9ca3af}
  input{width:100%;padding:.7rem .85rem;border-radius:10px;border:1px solid #26344f;background:#0b1220;color:#f3f4f6;font-size:16px}
  input:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.25)}
  button{width:100%;margin-top:1.25rem;padding:.8rem;border:0;border-radius:10px;font-size:15px;font-weight:800;cursor:pointer;
         color:#fff;background:linear-gradient(90deg,#1d4ed8,#4f46e5)}
  button:hover{filter:brightness(1.1)}
  .err{margin:0 0 .5rem;padding:.6rem .75rem;border-radius:10px;background:rgba(244,63,94,.12);border:1px solid rgba(244,63,94,.4);
       color:#fda4af;font-size:13px}
  .hint{margin:1rem 0 0;text-align:center;font-size:11px;color:#6b7280}
</style></head>
<body>
  <form class="card" method="post" action="/login" autocomplete="on">
    <div class="logo">💳</div>
    <h1>Controler<span>27</span></h1>
    <span class="ver">V2.00b PRO &middot; acesso ao servidor</span>
    ${message ? `<p class="err" role="alert">${esc(message)}</p>` : ''}
    <label for="u">Usuário</label>
    <input id="u" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus>
    <label for="p">Senha</label>
    <input id="p" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Entrar</button>
    <p class="hint">Depois deste acesso, o app pede o login do aplicativo.</p>
  </form>
</body></html>`;
}

function html(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end(body);
}

export default async function handler(req, res) {
  noStore(res);
  const cfg = env();
  const a = route(req);

  // ---------------------------------------------------------------- /api/me
  if (a === 'me') {
    const s = readSession(req, cfg);
    if (!s) return json(res, 401, { error: 'Não autorizado.' });
    return json(res, 200, { user: cfg.user, isOwner: true });
  }

  // ---------------------------------------------------------------- /logout
  if (a === 'logout') {
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return redirect(res, '/login');
  }

  // ---------------------------------------------------------------- /login
  if (a === 'login') {
    if (!cfg.password || !cfg.secret) {
      return html(res, 500, loginPage('Servidor sem APP_PASSWORD configurada na Vercel.'));
    }
    if (req.method === 'POST') {
      const b = await readForm(req);
      const u = String(b.username || '').trim().toLowerCase();
      const p = String(b.password || '');
      const okUser = safeEqual(u, cfg.user);
      const okPass = safeEqual(p, cfg.password);
      if (okUser && okPass) {
        res.setHeader('Set-Cookie', sessionCookie(newSessionValue(cfg), SESSION_DAYS * 86400));
        console.log('[c27log]', JSON.stringify({ t: Date.now(), user: cfg.user, e: 'server_login_ok' }));
        return redirect(res, '/', 303);
      }
      console.log('[c27log]', JSON.stringify({ t: Date.now(), e: 'server_login_fail' }));
      await sleep(900); // freia tentativas em série
      return html(res, 401, loginPage('Usuário ou senha incorretos.'));
    }
    if (readSession(req, cfg)) return redirect(res, '/');
    return html(res, 200, loginPage(''));
  }

  return json(res, 404, { error: 'Rota não encontrada.' });
}
