# Controler27 PRO v2.00c — pacote revisado (Vercel + GitHub)

Este pacote mantém a aplicação original e seu formato de banco. As alterações desta revisão concentram-se em segurança, autenticação, validação do banco remoto e testes automatizados.

## Arquitetura

- `public/index.html`: interface e lógica do aplicativo.
- `api/`: autenticação, sessão, banco no GitHub e logs.
- `ferramentas/gerar-credencial.html`: gera a variável `APP_PROOF_HASH` localmente no navegador.
- `tests/`: testes automatizados do backend.
- `vercel.json`: publicação e cabeçalhos HTTP.

O arquivo `controler27_bd.json` permanece no repositório privado do GitHub. Ele deve ser um envelope criptografado AES-GCM-256 gerado pelo aplicativo.

## Configuração inicial na Vercel

Configure as variáveis de ambiente:

| Variável | Obrigatória | Valor |
|---|---:|---|
| `APP_PROOF_HASH` | Sim* | Hash gerado em `ferramentas/gerar-credencial.html` com a senha atual do banco |
| `GITHUB_TOKEN` | Sim | Fine-grained token com Contents: Read and write apenas no repositório privado do banco |
| `GITHUB_REPO` | Sim | `usuario/repositorio-privado` |
| `SESSION_SECRET` | Recomendável | Segredo aleatório forte, independente da senha do aplicativo |
| `GITHUB_BRANCH` | Não | `main` (padrão) |
| `DB_FILE_PATH` | Não | `controler27_bd.json` (padrão) |
| `ALLOW_LEGACY_PLAINTEXT_DB` | Não | Não configure normalmente. Use apenas durante a migração descrita abaixo |

*Em vez de `APP_PROOF_HASH`, o backend ainda aceita `APP_PASSWORD` por compatibilidade, mas essa alternativa guarda a senha diretamente nas variáveis da Vercel e é menos recomendada. Configure apenas uma das duas credenciais.

Use `SESSION_SECRET` aleatório e independente. Se ele não estiver definido, o backend mantém o comportamento legado de derivar o segredo da credencial, para não invalidar instalações existentes automaticamente.

## Publicação

1. Extraia o conteúdo da pasta `controler27-app` para a raiz do repositório conectado à Vercel.
2. Importe o repositório na Vercel com Framework Preset `Other`.
3. Use `public` como diretório de saída (já definido em `vercel.json`). Não é necessário comando de build.
4. Cadastre as variáveis de ambiente e publique.
5. Abra o endereço HTTPS da aplicação.

## Primeiro acesso em cada navegador/dispositivo

O perfil local de login é mantido no navegador. Na versão 2.00c, não é necessário usar **Configurar primeiro acesso** em cada dispositivo: informe o mesmo usuário e a mesma senha já utilizados. O aplicativo valida a senha no servidor e confirma que ela abre o banco criptografado antes de criar automaticamente o perfil local daquele navegador.

A senha local antiga de outro dispositivo pode ficar desatualizada depois de uma troca de senha. Após atualizar `APP_PROOF_HASH` na Vercel e fazer redeploy, a aplicação permite validar a nova senha no servidor e atualizar o hash local daquele navegador.

## Troca de senha — procedimento obrigatório

1. Faça um backup JSON completo e guarde-o fora do GitHub.
2. Faça a troca de senha dentro do aplicativo e aguarde a sincronização terminar.
3. Copie o novo `APP_PROOF_HASH` apresentado pelo aplicativo.
4. Atualize `APP_PROOF_HASH` nas variáveis da Vercel e faça redeploy.
5. Nos demais dispositivos, entre com a nova senha. O aplicativo atualizará o hash local após validação bem-sucedida no servidor.

A senha também deriva a chave AES do banco. Se a troca for interrompida ou a sincronização falhar, não apague caches nem backups. Preserve a senha anterior e o backup até confirmar que todos os dispositivos conseguem abrir o banco novo.

## Migração de um banco legado sem criptografia

Por padrão, o backend revisado **bloqueia leitura e gravação de banco remoto sem criptografia**. Se o arquivo atual no GitHub for um JSON antigo em texto puro, faça a migração controlada:

1. Baixe uma cópia do arquivo atual do GitHub e guarde-a em local seguro.
2. Na Vercel, configure temporariamente `ALLOW_LEGACY_PLAINTEXT_DB=true` e faça redeploy.
3. Abra o aplicativo em HTTPS, conclua o primeiro acesso com a senha correta do banco e aguarde a sincronização automática. O aplicativo reconhece a resposta de migração e grava o envelope criptografado.
4. Confirme no GitHub que o arquivo agora contém `enc: "aes-gcm-256"`, `iv`, `ksalt` e `data`, sem os arrays financeiros em texto aberto.
5. Remova `ALLOW_LEGACY_PLAINTEXT_DB` das variáveis da Vercel e faça novo redeploy.
6. Teste login, leitura e gravação em outro dispositivo.

Não mantenha `ALLOW_LEGACY_PLAINTEXT_DB=true` após a migração. Essa variável abre uma exceção temporária para leitura e gravação do formato legado.

Se o arquivo já estiver criptografado, não configure essa variável.

## Segurança e limites desta revisão

- O aplicativo falha fechado se WebCrypto/AES-GCM não estiver disponível: não envia banco em texto puro como alternativa. Use HTTPS.
- O backend exige envelope AES-GCM-256 válido nas gravações normais e bloqueia downgrade para texto puro.
- O backend valida campos e tamanhos do envelope e limita o corpo lido pela API a 4 MiB.
- A autenticação aplica espera e limitação progressiva por IP em memória da instância. Como funções serverless podem reiniciar ou escalar para várias instâncias, isso é uma proteção complementar, não um rate limit distribuído. Para produção, habilite Vercel Firewall ou um serviço externo de rate limiting.
- Dados apresentados em templates dinâmicos receberam escape de HTML nos principais campos financeiros e identificadores usados em ações.
- O cabeçalho `X-Frame-Options: DENY`, `nosniff`, política de referrer e `Cache-Control: no-store` para APIs são mantidos.
- O aplicativo ainda depende de bibliotecas servidas por CDN. Uma indisponibilidade de CDN pode afetar gráficos, ícones ou exportação PDF.
- O banco continua sujeito ao limite de tamanho de payload da plataforma Vercel. Mantenha backups externos regulares.

## Testes locais

Requer Node.js 20 ou superior. Na raiz do projeto:

```bash
npm test
```

Os testes cobrem comparação constante, validação da prova de senha, assinatura de sessão, bloqueio de API sem autenticação, rejeição de gravação em texto puro, validação de envelope AES e limite do corpo da requisição.

## Checklist após publicar

- [ ] `/api/me` responde sem expor dados do banco.
- [ ] `/api/db` sem sessão retorna HTTP 401.
- [ ] Login correto cria cookie `HttpOnly`, `Secure` e `SameSite=Lax`.
- [ ] Banco remoto está em envelope AES-GCM-256.
- [ ] Criar/editar um lançamento gera commit no repositório privado.
- [ ] Outro navegador consegue abrir o mesmo banco com a senha correta.
- [ ] Troca de senha, atualização de `APP_PROOF_HASH` e login nos outros dispositivos foram testados.
- [ ] Backup JSON externo foi baixado e guardado.

## Observação sobre dados existentes

Esta revisão não altera IDs, coleções, parcelas ou estrutura interna dos registros financeiros. Mesmo assim, faça backup antes da publicação. A migração de um arquivo legado em texto puro exige o procedimento temporário acima; não habilite a exceção sem necessidade.


## Novidade da versão 2.00c — acesso em novos navegadores

O primeiro acesso em um navegador novo agora é automático: informe o mesmo usuário e a mesma senha já utilizados. O navegador valida a credencial no endpoint de autenticação da Vercel e confirma que a senha abre o envelope criptografado do banco remoto. Somente depois dessas verificações o cadastro local é criado. Não é necessário clicar em “Configurar primeiro acesso”.

O nome de usuário continua sendo um identificador local do login; a autenticação compartilhada no servidor é feita pela prova derivada da senha. Portanto, use exatamente o mesmo usuário e a mesma senha em todos os navegadores. Se o servidor recusar a senha ou ela não abrir o banco, o provisionamento automático é negado e os dados não são sobrescritos.
