# Controler27 PRO v2.00b — Vercel + banco no GitHub (login único)

## Como funciona

| Peça | Onde fica |
|---|---|
| Aplicativo (`public/index.html` + funções `/api`) | **Repositório do app** → conectado à Vercel |
| Banco (`controler27_bd.json`) | **Repositório de dados** (privado) → só o arquivo do banco, sem ligação com a Vercel |
| Acesso | **Um único login: o do aplicativo** (usuário + senha) |

**Como o login único protege o banco**
1. O app (HTML) é público, como o seu FinControl. Ele não contém senha nem hash nenhum.
2. Quando você entra, o app valida a senha no navegador e envia ao servidor só uma **prova derivada** dela (PBKDF2, 150 mil iterações). A senha em si nunca sai do navegador.
3. Se a prova confere, o servidor entrega um cookie (90 dias) que libera `/api/db`. Sem o cookie, ninguém lê nem grava o banco.
4. O arquivo no GitHub já é gravado **criptografado** (AES-256, com a senha do app como chave).

> **Importante:** como não há mais um login separado no servidor, a segurança passa a depender da **força da senha**. Use uma frase longa (14+ caracteres). O login não bloqueia por número de tentativas, só tem uma pausa a cada erro.

---

## Passo a passo

### 1. Repositório de dados
1. No GitHub, crie um repositório **privado** (ex.: `controler27-dados`) marcando **Add a README** (precisa ter ao menos um commit).
2. Envie para a raiz dele o seu banco atual com o nome **`controler27_bd.json`** (o arquivo que o servidor antigo mantém na pasta dele).
   - Sem esse arquivo, o app começa vazio. Se não achar o arquivo, use *Importar* com um backup completo (JSON) depois de entrar.

### 2. Token do GitHub
1. GitHub → *Settings* → *Developer settings* → *Fine-grained tokens* → *Generate new token*.
2. *Repository access*: **Only select repositories** → somente o repositório de dados.
3. *Permissions* → *Contents*: **Read and write**.
4. Copie o token (aparece uma vez). Ele **expira**: anote a data e renove antes.

### 3. Credencial do servidor (a senha do app, em forma de hash)
1. No seu computador, abra o arquivo **`ferramentas/gerar-credencial.html`** (funciona offline).
2. Digite a **senha do aplicativo** e clique em *Gerar*. Copie o valor: é o `APP_PROOF_HASH`.
   - A senha não fica guardada na Vercel, só esse hash. Ele sozinho **não** dá acesso.
   - Alternativa mais simples: em vez do hash, cadastrar a própria senha em `APP_PASSWORD`. Funciona igual, mas a senha passa a ficar na Vercel. Use **só uma** das duas.

### 4. Repositório do app
1. Crie outro repositório no GitHub (ex.: `controler27-app`) e envie para a **raiz** o conteúdo desta pasta (`api/`, `public/`, `ferramentas/`, `package.json`, `vercel.json`, `.gitignore`).

### 5. Vercel
1. *Add New → Project* → importe o repositório do app.
2. *Framework Preset*: **Other**. Deixe *Build Command* e *Output Directory* vazios (o `vercel.json` já define).
3. Em *Environment Variables*, cadastre:

| Variável | Valor | Obrigatória |
|---|---|---|
| `APP_PROOF_HASH` | valor gerado no passo 3 (ou use `APP_PASSWORD`) | Sim |
| `GITHUB_TOKEN` | token do passo 2 | Sim |
| `GITHUB_REPO` | `seu-usuario/controler27-dados` | Sim |
| `SESSION_SECRET` | texto longo e aleatório (assina a sessão) | Recomendada |
| `GITHUB_BRANCH` | `main` (padrão) | Não |
| `DB_FILE_PATH` | `controler27_bd.json` (padrão) | Não |

4. *Deploy*.

### 6. Primeiro acesso (uma vez em cada navegador/dispositivo)
O usuário inicial que vinha embutido no HTML foi removido (o HTML agora é público). Por isso, em cada navegador:
1. Abra o endereço da Vercel e clique em **Configurar primeiro acesso**.
2. Informe nome, usuário e a **senha do banco** (a mesma de sempre).
3. O app confere no servidor se essa senha abre o banco existente. Se abrir, o usuário é criado e você entra com ele.

Depois disso, o dia a dia é um login só.

---

## Trocar a senha do app
Ao trocar a senha dentro do app, aparece uma janela com o **novo `APP_PROOF_HASH`**. Copie, atualize a variável na Vercel e faça *Redeploy*.
Se você esquecer, o servidor passa a recusar os **próximos** logins e o app avisa que os dados ficam só no dispositivo. Corrigir a variável resolve.

## Checklist de teste
- [ ] Abrir o endereço mostra o login do app (sem dados).
- [ ] Primeiro acesso com senha errada é recusado.
- [ ] Depois de entrar, os dados aparecem iguais aos da v1.27.
- [ ] Criar/editar um lançamento → surge um **commit novo** no repositório de dados.
- [ ] Outro dispositivo mostra o mesmo dado.
- [ ] Sem entrar, abrir `seu-site/api/db` retorna **401** (não mostra o banco).
- [ ] *Sair* volta ao login. Em *Sobre*, a versão é **v2.00b**.

---

## O que mudou em relação ao servidor antigo

| v1.27 (servidor Node) | v2.00b (Vercel + GitHub) |
|---|---|
| Login no servidor + login no app | **Login único** (o do app) |
| Usuário inicial embutido no HTML | Removido: "Configurar primeiro acesso" uma vez por navegador |
| Pasta `backup_automatico` | **Histórico de commits** do arquivo no GitHub |
| Restauração automática do banco | **Não existe.** Restaure pelo histórico: arquivo no GitHub → *History* → commit bom → *Revert* |
| `controler27_log.txt` | Logs da Vercel (projeto → *Logs*, filtre por `c27log`); duram pouco |
| Pasta `Controler27_local` e `.bat` | Removida |
| Página "Outras páginas da pasta" | Link removido |

Tudo o que roda no navegador continua igual: cálculos, faturas, reembolsos, gráficos, PDF/CSV, backup completo em JSON, cópias automáticas no navegador, modo seguro, auditoria e a trava contra queda brusca.

## Limites e boas práticas
- **Um usuário de servidor** (o dono). Vários usuários com bancos separados não foram implementados.
- **Tamanho do banco:** a Vercel aceita gravações de até ~4,5 MB.
- **Sessão do servidor:** cookie de 90 dias, renovado a cada login. Para derrubar todas, troque `SESSION_SECRET`.
- **Gravações simultâneas:** o servidor recusa versão mais antiga que a do GitHub; o app relê, mescla e reenvia sozinho.
- **Senha esquecida:** o banco **não pode ser recuperado** (a criptografia é feita no navegador). Guarde a senha em um gerenciador de senhas.
- Baixe um **backup completo (JSON)** a cada 14 dias e guarde fora do GitHub.
