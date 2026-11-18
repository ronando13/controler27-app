// GET  /api/db  -> devolve o arquivo do banco (já criptografado pelo app) do repositório do GitHub
// POST /api/db  -> grava o banco no GitHub (com as mesmas travas do servidor antigo)
import { env, authConfigured, noStore, json, readJson, readSession, ghRead, ghWrite } from './_lib.js';

function isEncryptedEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.enc !== 'aes-gcm-256' || value.v !== 2) return false;
  const allowed = new Set(['v', 'enc', 'ksalt', 'iv', 'data', 'updatedAt']);
  if (Object.keys(value).some(key => !allowed.has(key))) return false;
  if (typeof value.ksalt !== 'string' || typeof value.iv !== 'string' || typeof value.data !== 'string') return false;
  if (![value.ksalt, value.iv, value.data].every(x => /^[A-Za-z0-9+/]+={0,2}$/.test(x))) return false;
  try {
    const salt = Buffer.from(value.ksalt, 'base64');
    const iv = Buffer.from(value.iv, 'base64');
    const data = Buffer.from(value.data, 'base64');
    return salt.length >= 16 && salt.length <= 64 && iv.length === 12 && data.length >= 16 && data.length <= 4 * 1024 * 1024 &&
      salt.toString('base64') === value.ksalt && iv.toString('base64') === value.iv && data.toString('base64') === value.data;
  } catch (_) { return false; }
}

export default async function handler(req, res) {
  noStore(res);
  const cfg = env();

  if (!authConfigured(cfg)) {
    return json(res, 500, { error: 'Servidor sem APP_PROOF_HASH (ou APP_PASSWORD) configurado na Vercel.' });
  }
  if (!readSession(req, cfg)) {
    return json(res, 401, { error: 'Não autorizado. Faça login novamente.' });
  }
  if (!cfg.ghToken || !cfg.ghRepo) {
    return json(res, 500, { error: 'GitHub não configurado (GITHUB_TOKEN, GITHUB_REPO).' });
  }

  try {
    // ---------------------------------------------------------------- LER
    if (req.method === 'GET') {
      const cur = await ghRead(cfg);
      if (cur.notFound) return json(res, 404, { error: 'O banco ainda não existe.' });
      let stored;
      try { stored = JSON.parse(cur.text); } catch (_) {
        return json(res, 502, { error: 'O arquivo do banco no GitHub está ilegível.' });
      }
      if (!isEncryptedEnvelope(stored)) {
        if (process.env.ALLOW_LEGACY_PLAINTEXT_DB !== 'true') {
          return json(res, 422, { error: 'O banco remoto não está criptografado. A leitura foi bloqueada para proteger os dados. Faça a migração controlada do banco antes de liberar o acesso.' });
        }
        res.setHeader('X-C27-Legacy-Plaintext', '1');
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(cur.text); // devolve exatamente o que está gravado
    }

    // ---------------------------------------------------------------- GRAVAR
    if (req.method === 'POST' || req.method === 'PUT') {
      let incoming;
      try { incoming = await readJson(req); } catch (err) {
        if (err?.message === 'BODY_TOO_LARGE') return json(res, 413, { error: 'Banco excede o limite seguro de 4 MB por gravação.' });
        throw err;
      }
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return json(res, 400, { error: 'Payload JSON inválido.' });
      }
      const incomingEncrypted = isEncryptedEnvelope(incoming);
      const incomingPlain = Array.isArray(incoming.cards) || Array.isArray(incoming.transactions);
      if (!incomingEncrypted && !(incomingPlain && process.env.ALLOW_LEGACY_PLAINTEXT_DB === 'true')) {
        return json(res, 422, { error: 'Gravação bloqueada: o banco precisa estar criptografado com AES-GCM-256.' });
      }

      const text = JSON.stringify(incoming, null, 2);
      const newSize = Buffer.byteLength(text);
      const allowShrink = String(req.headers['x-c27-allow-shrink'] || '') === '1';

      for (let attempt = 0; attempt < 3; attempt++) {
        const cur = await ghRead(cfg);
        let sha;
        if (!cur.notFound) {
          sha = cur.sha;
          let curObj = null;
          try { curObj = JSON.parse(cur.text); } catch (_) { /* arquivo atual estragado: deixa sobrescrever */ }
          if (curObj && typeof curObj === 'object') {
            // 1) nunca trocar um banco criptografado por texto puro
            if (isEncryptedEnvelope(curObj) && !incomingEncrypted) {
              return json(res, 422, { error: 'Recusado: o banco é criptografado e a gravação veio sem criptografia.' });
            }
            // 2) versão mais antiga que a do servidor (outro dispositivo gravou antes)
            if (!isEncryptedEnvelope(curObj) && process.env.ALLOW_LEGACY_PLAINTEXT_DB !== 'true') {
              return json(res, 422, { error: 'O banco atual está em formato legado sem criptografia. Migração controlada necessária.' });
            }
            const curTs = Number(curObj.updatedAt) || 0;
            const newTs = Number(incoming.updatedAt) || 0;
            if (curTs && newTs < curTs) {
              return json(res, 412, { error: 'Há uma versão mais recente no servidor.', serverUpdatedAt: curTs });
            }
            // 3) trava contra queda brusca (a menos que o app tenha confirmado)
            const curSize = Buffer.byteLength(cur.text);
            if (!allowShrink && curSize > 4096 && newSize < curSize * 0.5) {
              return json(res, 409, { error: 'Gravação recusada: apagaria mais da metade do banco.' });
            }
          }
        }
        const w = await ghWrite(cfg, text, sha);
        if (!w.conflict) return json(res, 200, { ok: true, updatedAt: Number(incoming.updatedAt) || 0 });
        // o arquivo mudou entre a leitura e a gravação: lê de novo e reavalia as travas
      }
      return json(res, 503, { error: 'Conflito de gravação no GitHub. Tente novamente.' });
    }

    res.setHeader('Allow', 'GET, POST, PUT');
    return json(res, 405, { error: `Método ${req.method} não permitido.` });
  } catch (err) {
    if (err?.message === 'BODY_TOO_LARGE') return json(res, 413, { error: 'Banco excede o limite seguro de 4 MB por gravação.' });
    console.error('[db]', err && err.message);
    return json(res, 502, { error: 'Falha ao acessar o GitHub.', message: String(err && err.message || '').slice(0, 200) });
  }
}
