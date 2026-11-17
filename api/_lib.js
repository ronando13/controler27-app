// Funções compartilhadas (arquivos que começam com "_" não viram rotas na Vercel).
import crypto from 'node:crypto';

export const COOKIE_NAME = 'c27_session';
export const SESSION_DAYS = 90;

export function env() {
  return {
    user: String(process.env.APP_USER || 'admin').trim().toLowerCase(),
    password: process.env.APP_PASSWORD || '',
    secret: process.env.SESSION_SECRET || process.env.APP_PASSWORD || '',
    ghToken: process.env.GITHUB_TOKEN || '',
    ghRepo: process.env.GITHUB_REPO || '',
    ghBranch: process.env.GITHUB_BRANCH || 'main',
    dbPath: process.env.DB_FILE_PATH || 'controler27_bd.json'
  };
}

// ------------------------------------------------------------------ respostas
export function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}
export function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}
export function redirect(res, location, status = 302) {
  res.statusCode = status;
  res.setHeader('Location', location);
  res.end();
}

// ------------------------------------------------------------------ corpo da requisição
export async function readRaw(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    if (typeof req.body === 'string') return req.body;
    return req.body; // já veio como objeto
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}
export async function readJson(req) {
  try {
    const raw = await readRaw(req);
    if (raw && typeof raw === 'object') return raw;
    return JSON.parse(String(raw || ''));
  } catch (_) { return null; }
}
export async function readForm(req) {
  try {
    const raw = await readRaw(req);
    if (raw && typeof raw === 'object') return raw;
    return Object.fromEntries(new URLSearchParams(String(raw || '')));
  } catch (_) { return {}; }
}

// ------------------------------------------------------------------ sessão (cookie assinado)
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}
function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}
export function newSessionValue(cfg) {
  const payload = Buffer.from(JSON.stringify({
    u: cfg.user,
    exp: Date.now() + SESSION_DAYS * 86400e3,
    n: crypto.randomBytes(6).toString('hex')
  })).toString('base64url');
  return `${payload}.${sign(payload, cfg.secret)}`;
}
export function sessionCookie(value, maxAgeSeconds) {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}
export function readSession(req, cfg) {
  if (!cfg.secret) return null;
  const raw = parseCookies(req.headers && req.headers.cookie)[COOKIE_NAME];
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!safeEqual(sig, sign(payload, cfg.secret))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!d.exp || Date.now() > d.exp) return null;
    if (d.u !== cfg.user) return null; // trocar APP_USER invalida as sessões antigas
    return d;
  } catch (_) { return null; }
}

// ------------------------------------------------------------------ GitHub (repositório só do banco)
const encPath = p => String(p).split('/').map(encodeURIComponent).join('/');
function ghHeaders(cfg, accept) {
  return {
    Authorization: `Bearer ${cfg.ghToken}`,
    Accept: accept || 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Controler27-Vercel'
  };
}
const fileUrl = cfg => `https://api.github.com/repos/${cfg.ghRepo}/contents/${encPath(cfg.dbPath)}`;
const timeout = () => AbortSignal.timeout(10000);

// Lê o arquivo do banco. Retorna { notFound:true } ou { sha, text }.
export async function ghRead(cfg) {
  const url = `${fileUrl(cfg)}?ref=${encodeURIComponent(cfg.ghBranch)}`;
  const r = await fetch(url, { headers: ghHeaders(cfg), signal: timeout() });
  if (r.status === 404) {
    // O GitHub também responde 404 quando o token não enxerga o repositório.
    // Confirma que o repositório existe antes de dizer que "o banco ainda não existe".
    const repo = await fetch(`https://api.github.com/repos/${cfg.ghRepo}`, { headers: ghHeaders(cfg), signal: timeout() });
    if (!repo.ok) throw new Error(`Repositório do banco inacessível (HTTP ${repo.status}). Confira GITHUB_REPO e o token.`);
    return { notFound: true };
  }
  if (!r.ok) throw new Error(`GitHub GET ${r.status}`);
  const meta = await r.json();
  if (Array.isArray(meta) || meta.type !== 'file') throw new Error('DB_FILE_PATH não aponta para um arquivo.');
  let text;
  if (meta.encoding === 'base64' && meta.content) {
    text = Buffer.from(meta.content, 'base64').toString('utf8');
  } else {
    // arquivos acima de 1 MB não vêm no JSON: busca o conteúdo bruto
    const raw = await fetch(url, { headers: ghHeaders(cfg, 'application/vnd.github.raw+json'), signal: timeout() });
    if (!raw.ok) throw new Error(`GitHub GET raw ${raw.status}`);
    text = await raw.text();
  }
  return { sha: meta.sha, text };
}

// Grava com controle de versão (sha). Retorna { conflict:true } se o arquivo mudou no meio do caminho.
export async function ghWrite(cfg, text, sha) {
  const body = {
    message: 'chore(db): atualiza ' + cfg.dbPath + ' (Controler27)',
    content: Buffer.from(text, 'utf8').toString('base64'),
    branch: cfg.ghBranch
  };
  if (sha) body.sha = sha;
  const r = await fetch(fileUrl(cfg), {
    method: 'PUT',
    headers: { ...ghHeaders(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: timeout()
  });
  if (r.status === 409 || r.status === 422) return { conflict: true };
  if (!r.ok) throw new Error(`GitHub PUT ${r.status}`);
  const j = await r.json();
  return { sha: j && j.content && j.content.sha };
}
