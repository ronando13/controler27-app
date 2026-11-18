# Relatório de revisão técnica — Controler27 PRO v2.00c

## Escopo executado

Revisão estática do HTML principal, APIs Node.js, configuração da Vercel, documentação e fluxos de autenticação/criptografia. Foram adicionados testes automatizados do backend.

## Correções aplicadas

1. **Gravação sem criptografia:** `c27Seal()` agora falha fechado quando WebCrypto, chave ou salt não estão disponíveis. A geração de bytes aleatórios não usa mais `Math.random()` como fallback.
2. **Validação do banco remoto:** o backend exige envelope AES-GCM-256 válido nas gravações normais, verifica estrutura/base64 e rejeita campos extras que poderiam carregar dados em texto puro.
3. **Proteção contra downgrade:** banco criptografado não pode ser substituído por conteúdo sem criptografia.
4. **Migração legada controlada:** banco antigo em texto puro só pode ser lido/gravar durante a exceção temporária `ALLOW_LEGACY_PLAINTEXT_DB=true`. A documentação orienta remover a variável logo após a migração.
5. **Tamanho de requisição:** leitura do corpo limitada a 4 MiB, com resposta HTTP 413 quando excedido.
6. **Autenticação:** limitação progressiva de tentativas por IP em memória da instância, espera após falha e resposta HTTP 429.
7. **Troca de senha entre dispositivos:** se o hash local estiver desatualizado, o navegador tenta validar a senha no servidor e só então atualiza o hash local.
8. **Troca de senha mais segura:** o aplicativo confirma a gravação criptografada no servidor antes de declarar sucesso; tenta verificar o envelope remoto se a resposta da gravação não for conclusiva e restaura o estado local anterior se a gravação falhar.
9. **Validação de senha:** mínimo unificado de 8 caracteres, bloqueio das senhas padrão conhecidas e proibição de espaços no início/fim para evitar incompatibilidade com o login que normaliza espaços externos.
10. **XSS em renderização:** adicionada função de escape HTML e aplicada aos principais campos de dados financeiros e IDs usados em handlers HTML. O título e subtítulo de detalhes do cartão usam nós de texto para os campos livres.
11. **Service Worker:** removido o registro de `sw.js`, arquivo que não existia no pacote, evitando tentativa silenciosa de recurso ausente.
12. **Cabeçalhos:** adicionados cabeçalhos de segurança e política de permissões, preservando os existentes.
13. **Documentação:** reescritos os passos de deploy, troca de senha, migração legada e testes.

## Testes executados

- `node --check` em todos os módulos da API.
- `node --check` nos quatro blocos JavaScript inline do HTML.
- Validação JSON de `package.json` e `vercel.json`.
- `npm test`: 10 testes aprovados, 0 falhas.

Os testes cobrem comparação constante, prova de senha, assinatura de sessão, bloqueio de API sem autenticação, rejeição de banco sem criptografia, validação de envelope, limite de corpo, rate limiting, gravação de envelope criptografado e bloqueio de leitura de banco legado por padrão.

## Limitações que permanecem

- O rate limiting em memória é apenas uma camada complementar: funções serverless podem reiniciar ou escalar em múltiplas instâncias. Configure Vercel Firewall ou serviço externo para proteção distribuída.
- Não foi possível testar uma publicação real na conta Vercel/GitHub do usuário nem validar os segredos e permissões desses serviços.
- Não foi executado teste de interface em navegador real nem teste de carga/concor­rência multiusuário. A sincronização existente foi preservada; conflitos de dados precisam ser validados com dois dispositivos reais.
- A aplicação ainda carrega bibliotecas de terceiros por CDN.
- O escape foi aplicado aos principais campos livres identificados na revisão estática, mas uma auditoria dinâmica completa de todos os caminhos de renderização exigiria testes de navegador com payloads controlados.

## Recomendação de implantação

Antes do deploy, baixar um backup JSON completo e manter cópia externa. Se o banco atual já estiver criptografado, não ativar `ALLOW_LEGACY_PLAINTEXT_DB`. Se for um banco legado em texto puro, seguir exatamente o procedimento temporário do `LEIA-ME.md`.


## Complemento da versão 2.00c — provisionamento automático por navegador

Foi corrigido o fluxo de autenticação para navegadores sem cadastro local. Quando não existe usuário local armazenado, o login tenta validar a prova derivada da senha no servidor e, em seguida, valida a senha contra o envelope AES-GCM do banco remoto. Se ambas as verificações forem aprovadas (ou se o banco estiver realmente ausente, conforme fluxo de primeiro banco), cria o registro local e inicia a sessão. Em caso de credencial recusada, indisponibilidade, limite de tentativas ou senha incompatível com o envelope, não cria o registro local.

Limitação arquitetural mantida: o username é armazenado localmente por navegador; a autoridade compartilhada do login é a credencial única configurada na Vercel. A implementação permite usar o mesmo username e senha em navegadores diferentes, mas não cria um diretório de usuários centralizado. Testes automatizados e verificações estáticas não substituem teste real de deploy, navegador e sincronização entre dispositivos.
