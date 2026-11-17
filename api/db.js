// GET  /api/db  -> devolve o arquivo do banco (já criptografado pelo app) do repositório do GitHub
// POST /api/db  -> grava o banco no GitHub (com as mesmas travas do servidor antigo)
import { env, authConfigured, noStore, json, readJson, readSession, ghRead, ghWrite } from './_lib.js';

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
      try { JSON.parse(cur.text); } catch (_) {
        return json(res, 502, { error: 'O arquivo do banco no GitHub está ilegível.' });
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(cur.text); // devolve exatamente o que está gravado
    }

    // ---------------------------------------------------------------- GRAVAR
    if (req.method === 'POST' || req.method === 'PUT') {
      const incoming = await readJson(req);
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return json(res, 400, { error: 'Payload JSON inválido.' });
      }
      const incomingEncrypted = !!(incoming.enc && incoming.iv && incoming.data);
      const incomingPlain = Array.isArray(incoming.cards) || Array.isArray(incoming.transactions);
      if (!incomingEncrypted && !incomingPlain) {
        return json(res, 400, { error: 'Formato de banco não reconhecido.' });
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
            if (curObj.enc && !incomingEncrypted) {
              return json(res, 422, { error: 'Recusado: o banco é criptografado e a gravação veio sem criptografia.' });
            }
            // 2) versão mais antiga que a do servidor (outro dispositivo gravou antes)
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
    console.error('[db]', err && err.message);
    return json(res, 502, { error: 'Falha ao acessar o GitHub.', message: String(err && err.message || '').slice(0, 200) });
  }
}
