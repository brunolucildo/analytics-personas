# QA

> **Público:** quem vai validar uma mudança antes de declará-la pronta.
> **Regra de ouro:** só reporte o que você executou e viu. Não existe "deve passar".

## 1. Estado atual

| Recurso                     | Estado                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| Lint (OXLint)               | Configurado; passa                                                 |
| Formatação (OXFmt)          | Configurada; idempotente                                           |
| Tipos                       | Configurado em `app`, `api`, `docs` e `@repo/ui`; passa            |
| Build                       | `apps/app/dist`, `apps/api/dist` e `apps/docs/.next`; passa        |
| Testes unitários            | Vitest em `app` e `api`; passam                                    |
| Testes de integração        | Vitest + Supertest em `api`, contra o Supabase local (exige `infra:up` e `db:migrate`); passa |
| Testes E2E                  | Playwright (`home`, `routing`, `sign-up`, `forgot-password`, `session`, `sign-out`); sobe app e API (`capture`) e exige o Supabase local; passa |
| Cobertura                   | `bun run test:coverage` gera `coverage/`; sem threshold            |
| Hooks de pre-commit         | Configurados (`lefthook.yml`); validados no commit raiz `227e0ad`  |
| CI                          | Não configurado                                                    |
| Acessibilidade automatizada | Não configurada                                                    |

### 1.1 Baseline verificado em 2026-11-07

| Gate                       | Resultado | Observação                                                                 |
| -------------------------- | --------- | -------------------------------------------------------------------------- |
| `bun run lint`             | Passa     | 4 tasks, 0 warnings, 0 erros                                               |
| `bun run check-types`      | Passa     | 4 tasks                                                                    |
| `bun run build`            | Passa     | `app`, `api` e `docs`                                                      |
| `bun run test`             | Passa     | Vitest em `app` e `api`                                                    |
| `bun run test:integration` | Passa     | 1 teste (Supertest em `GET /`)                                             |
| `bun run test:e2e`         | Passa     | 1 teste (Chromium); sobe o `apps/app` sozinho                              |
| `bun run test:coverage`    | Passa     | Gera `coverage/api` e `coverage/app`                                       |
| `bun run format` (2×)      | Passa     | Segunda execução sem diff                                                  |
| `bun run code:fix`         | Passa     | OXLint `--fix` + OXFmt                                                     |
| `bun run infra:up`         | Passa     | Supabase em 54321; Grafana, Loki, Tempo, Mimir e Collector `healthy`       |
| `bun run db:migrate`       | Passa     | Sem migrations: a CLI aplica `[]` e o script informa que não há pendências |
| `bun run infra:down` (2×)  | Passa     | Idempotente; nenhum container do projeto fica                              |

Observabilidade verificada: `GET /` gera um trace consultável no Tempo (por `trace_id`) e um log no Loki com o atributo `requestId`, sem headers, IP ou query string; com o Collector parado, `GET /` continua 200.

### 1.2 Verificação manual de UI em 2026-11-07

Rota `/` de `apps/app` no browser embutido do app (Chromium), servidor `vite` em dev.

| Verificação           | Resultado                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 375 / 768 / 1280 px   | Sem scroll horizontal (`scrollWidth` = largura da viewport); `h1` de 36px no mobile e 60px a partir de 768px                                                                         |
| Estrutura             | Um único `h1` "Hello World"; `lang="pt-BR"`; título "Analytics Personas"                                                                                                             |
| Alvo de toque         | `Button` com 158×44px (mínimo 44×44)                                                                                                                                                 |
| Teclado e foco        | `Tab` foca o botão; `:focus-visible` verdadeiro; anel de 2px (offset) + 4px `#5C8001`, visível em screenshot                                                                         |
| Contraste (calculado) | Texto do botão sobre `#FB6107`: 6,42:1; `h1` sobre o fundo: 19,44:1; anel de foco sobre o fundo: 4,54:1; fundo do botão sobre a página: 3,03:1 (limite de 3:1 para componente de UI) |
| Console               | Sem erro nem warning (apenas logs do Vite e do React DevTools)                                                                                                                       |
| Network               | 22 requisições, todas 200                                                                                                                                                            |

Não verificado: leitor de tela; estados hover, active, disabled e loading do `Button`; `prefers-reduced-motion` (o `Button` tem transição de 150ms e deslocamento no `active` sem variante `motion-reduce`); build de produção (`vite preview`) visualmente. A medição do `box-shadow` logo após o `Tab` mostra o anel quase transparente porque a transição de 150ms ainda corre; meça após ~1 s.

### 1.3 Verificação da spec 0001 em 2026-11-09

Executado na raiz, nesta ordem (todos com código de saída 0):

| Gate                       | Resultado | Observação                                                           |
| -------------------------- | --------- | -------------------------------------------------------------------- |
| `bun run lint`             | Passa     | 4 tasks, 0 warnings, 0 erros                                         |
| `bun run check-types`      | Passa     | 4 tasks                                                              |
| `bun run build`            | Passa     | `app`, `api` e `docs`                                                |
| `bun run test`             | Passa     | `app`: 8 testes; `api`: 8 testes                                     |
| `bun run test:integration` | Passa     | 11 testes (health, 404 fora do prefixo, envelope de erro, CORS)      |
| `bun run test:e2e`         | Passa     | 4 testes (Chromium): `/` → `/app` e 404 em `/x`, `/auth/x`, `/app/x` |
| `bun run test:coverage`    | Passa     | `app` e `api`                                                        |
| `bun run format` (2×)      | Passa     | Segunda execução sem diff novo                                       |

Verificação manual de UI (browser embutido, `/does-not-exist`, `/auth/does-not-exist`, `/` e `/app`): 375 / 768 / 1280 px sem scroll horizontal (`scrollWidth` = largura da viewport); `h1` de 36px no mobile e 60px a partir de 768px; um único `h1` por página; `lang="en-US"`; link "Go to the home page" com 175×44px, foco por `Tab` com `:focus-visible` verdadeiro e anel de 2px + 4px `#5C8001`; console sem erro; todas as requisições do Vite com 200.

Observabilidade (R9), com `bun run infra:up` (5 containers `healthy`) e a API compilada (`bun run start` em `apps/api`, `APP_URL` passada na linha de comando): `GET /api/v1/health?secret=abc` com `x-request-id: r1-spec0001-check` respondeu 200 `{"status":"ok"}`; o Loki devolveu o log `request completed` com `requestId`, `req_url` = `/api/v1/health` (sem a query string), método e status, sem headers nem IP; o Tempo devolveu o trace por `trace_id`. `GET /` respondeu 404 no envelope e o preflight de `http://localhost:5173` respondeu 204 com `Access-Control-Allow-Origin` (outra origem: nenhum header CORS). Com `docker compose stop otel-collector`, `GET /api/v1/health` seguiu 200 (2 chamadas); o Collector foi religado em seguida.

**Pré-requisito novo:** a API exige `APP_URL` (ver `.env.example`); `.env` antigos precisam dela para a API subir. Os testes usam `http://localhost:5173` em `apps/api/test/setup-env.ts`.

### 1.4 Verificação da spec 0003 em 2026-11-09

Executado na raiz, no worktree da spec (sem UI, sem Supabase e sem portas fixas: os testes de integração usam o servidor em processo do Supertest):

| Gate                       | Resultado | Observação                                                                                        |
| -------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| `bun run lint`             | Passa     | 4 tasks, 0 warnings, 0 erros                                                                      |
| `bun run check-types`      | Passa     | 4 tasks                                                                                           |
| `bun run build`            | Passa     | `app`, `api` e `docs`                                                                             |
| `bun run test`             | Passa     | `app`: 8 testes; `api`: 37 testes (armazenamento, políticas, chave, `TRUST_PROXY`)                |
| `bun run test:integration` | Passa     | 24 testes; `test/rate-limit.int-spec.ts` cobre 429, `Retry-After`, e-mail/IP, janela, proxy, logs |
| `bun run test:e2e`         | Não rodou | Sem UI nesta spec                                                                                 |

### 1.5 Verificação da spec 0002 em 2026-11-09

Executado no worktree da spec (código de saída 0): `bun run lint`, `bun run check-types`, `bun run build`, `bun run test` (`api`: 78 testes, `app`: 8) e `bun run test:integration` (16 testes, incluindo captura de e-mail, rota de teste 404 fora do `capture` e recusa de `capture` em produção). Nenhum teste usa rede externa. **Não verificado:** entrega real no Mailtrap e no Resend (sem credenciais); ver o checklist abaixo.

**Pré-requisito novo:** a API exige `EMAIL_PROVIDER`, `EMAIL_FROM` e a credencial do provedor escolhido (ver `.env.example`); `.env` antigos precisam delas para a API subir. Os testes usam `EMAIL_PROVIDER=capture` em `apps/api/test/setup-env.ts`.

### 1.6 Verificação da spec 0004 em 2026-11-09

Executado no worktree da spec, na ordem abaixo (código de saída 0). Supabase local no ar com a migration aplicada; `test:e2e` rodou com `E2E_APP_PORT=5183 E2E_API_PORT=3012` porque a 5173 já havia um `vite` de outro processo (a configuração agora nunca reaproveita um servidor existente).

| Gate                       | Resultado | Observação                                                                                                                                                                    |
| -------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run lint`             | Passa     | 4 tasks, 0 warnings, 0 erros                                                                                                                                                  |
| `bun run check-types`      | Passa     | 4 tasks                                                                                                                                                                       |
| `bun run build`            | Passa     | `app`, `api` e `docs`; `service_role`, `auth_sign_up` e `argon2` não aparecem em `apps/app/dist`                                                                            |
| `bun run test`             | Passa     | `api`: 155 testes (19 arquivos); `app`: 36 testes (5 arquivos)                                                                                                              |
| `bun run test:integration` | Passa     | 58 testes: `auth-database` (12: RLS e RPC com `anon` e `authenticated`, concorrência, restrições), `auth-sign-up` (17: R2 a R7), mais os anteriores                              |
| `bun run test:e2e`         | Passa     | 8 testes (Chromium): home, 404, e `sign-up` (formulário, senhas diferentes sem chamar a API, cadastro com e-mail capturado, 409 no campo)                                     |

Banco (`psql` no container): RLS ligada em `users` e `auth_tokens`, 0 policies em `public`, índices `users_email_key`, `auth_tokens_token_hash_key` e `auth_tokens_user_id_type_idx`, `auth_sign_up` com `execute` só para `service_role`, sem grants de tabela para `anon`/`authenticated`. Os testes apagam o que criam; ao final, `select count(*) from public.users` = 0.

Verificação manual de UI (`/auth/sign-up`, Chromium via Playwright, vite em dev): 375 / 768 / 1280 px sem scroll horizontal (`scrollWidth` = largura da viewport, inclusive com os erros de validação abertos); um único `h1` (30px); `lang="en-US"`; ordem de Tab: nome, sobrenome, e-mail, senha, confirmação, botão, link `Sign in`; foco com anel de 2px + 4px `#5C8001`; alvos de toque: campos 44px, botão 48px, link `Sign in` 52×44px; console sem erro nem warning (o 409 aparece só como log de rede do browser). Contraste calculado: erro `#B91C1C` sobre `#FFFDF5` 6,35:1; texto secundário `#6B6B6B` 5,23:1; texto do botão 6,42:1; anel de foco 4,54:1. **Achado e corrigido:** o erro de campo mostrado no `blur` deslocava o botão e engolia o clique (o `click` caía no `form`); os erros de validação agora aparecem no envio. **Não verificado:** leitor de tela; hover/active; `prefers-reduced-motion` (o spinner tem `motion-reduce:animate-none`, sem teste); `vite preview`.

**Pré-requisitos novos:** `test:integration` e `test:e2e` exigem Docker, `bun run infra:up` e `bun run db:migrate` (sem o banco a `globalSetup` falha com a instrução). As chaves do Supabase vêm do ambiente ou de `supabase status -o env`. O E2E sobe uma API própria com `EMAIL_PROVIDER=capture` na 3002 e o app na 5173 (`E2E_APP_PORT` e `E2E_API_PORT` mudam as portas).

### 1.7 Verificação da spec 0005 em 2026-11-09

Executado no worktree da spec (código de saída 0), com o Supabase local no ar e a migration `20261109210000_create_sessions.sql` aplicada. O `test:e2e` rodou com `E2E_APP_PORT=5195 E2E_API_PORT=3025` porque a 5173 estava ocupada por outro processo.

| Gate                       | Resultado | Observação                                                                                                                                                                                                                       |
| -------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run lint`             | Passa     | 4 tasks, 0 warnings, 0 erros                                                                                                                                                                                                     |
| `bun run check-types`      | Passa     | 4 tasks                                                                                                                                                                                                                          |
| `bun run build`            | Passa     | `app`, `api` e `docs`; `service_role`, `auth_issue_session` e `AUTH_JWT_SECRET` não aparecem em `apps/app/dist`                                                                                                                  |
| `bun run test`             | Passa     | `api`: 214 testes (23 arquivos: serviço de sessão, assinador JWT, guard, repositório, ambiente); `app`: 89 testes (9 arquivos: token, `api-client`, `query-client`, redirecionamento, guard de `/app` e de `/auth/*`)            |
| `bun run test:integration` | Passa     | 96 testes (8 arquivos): `auth-sessions-database` (10: RLS e RPC com `anon`/`authenticated`, índice único parcial, concorrência), `auth-sessions` (R2 a R6: 401 sem motivo distinguível, sessão única, A 401 e B 200, ordem dos guards) |
| `bun run test:e2e`         | Passa     | 22 testes (Chromium): API fechada, `/app` sem token, com token inválido e com token semeado, `/auth/sign-up` logado, carregando anunciado, retry, sessão única                                                                  |

Banco: `sessions` com RLS ligada, 0 policies, índice `sessions_user_id_active_key` (parcial), `auth_issue_session` com `execute` só para `service_role` (`anon` e `authenticated` recebem erro pela API REST; conferido por `psql`: RLS ligada, 0 policies, `has_function_privilege` falso para `anon` e `authenticated` e verdadeiro para `service_role`). Ao final, `count(*)` de `public.sessions` e de `public.users` = 0 (os testes apagam o que criam). `AUTH_JWT_SECRET` ausente ou com 31 caracteres: `node dist/main.js` termina com erro citando a variável e sem ecoar o valor.

Verificação manual de UI (`/app` carregando, erro e home, Chromium via Playwright, vite em dev): 375 / 768 / 1280 px sem scroll horizontal (`scrollWidth` = largura da viewport); um único `h1` em cada estado (home 36px no mobile e 60px a partir de 768px); `lang="en-US"`; o estado de carregamento tem `role="status"` e o texto "Verifying your session…"; botão `Try again` com 97×44px, foco por `Tab` com `:focus-visible` verdadeiro e anel de 2px + 4px `#5C8001`. Contraste calculado: `h1` e texto de carregamento sobre o fundo 19,44:1; texto secundário `#6B6B6B` 5,23:1. Console sem erro nem warning, exceto o `ERR_CONNECTION_REFUSED` provocado de propósito no teste de falha de rede. **Não verificado:** leitor de tela (o `role="status"` foi checado só pela árvore de acessibilidade do Playwright); hover/active; `prefers-reduced-motion` (o spinner tem `motion-reduce:animate-none`, sem teste); `vite preview`.

**Pré-requisito novo:** a API exige `AUTH_JWT_SECRET` (>= 32 caracteres; ver `.env.example`); `.env` antigos precisam dela para a API subir. Os testes usam um valor fictício em `apps/api/test/setup-env.ts` e o E2E, em `playwright.config.ts`.

### 1.9 Verificação da spec 0009 em 2026-11-09

Executado no worktree da spec, em paralelo com a spec 0005 (outro worktree, mesmo Supabase local), com o lock de infraestrutura da orquestração. `test:e2e` rodou com `E2E_APP_PORT=5193 E2E_API_PORT=3022` porque a 5173 estava ocupada por outro processo. **`bun run db:migrate` falhou neste worktree** com `MigrationMissingLocalError` (o banco compartilhado já tinha a migration `20261109210000` da 0005, que não existe aqui); a migration `20261109220000` foi aplicada com `psql` no container (`docker exec ... psql -f`) e registrada em `supabase_migrations.schema_migrations`. Depois da integração das branches, `db:migrate` volta a funcionar.

| Gate                       | Resultado | Observação                                                                                                                                                                         |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run lint`             | Passa     | 4 tasks, 0 warnings, 0 erros                                                                                                                                                       |
| `bun run check-types`      | Passa     | 4 tasks                                                                                                                                                                            |
| `bun run build`            | Passa     | `app`, `api` e `docs`; `service_role` e `auth_request_password_reset` não aparecem em `apps/app/dist`                                                                         |
| `bun run test`             | Passa     | `api`: 174 testes (24 arquivos); `app`: 62 testes (8 arquivos)                                                                                                                    |
| `bun run test:integration` | Passa     | 79 testes; `auth-forgot-password` (21): R1 (status, corpo e cabeçalhos idênticos para conta confirmada, não confirmada e inexistente), R2 a R6, tempo de resposta com provedor lento, permissões da função |
| `bun run test:e2e`         | Passa     | 11 testes (Chromium): home, 404, `sign-up` e `forgot-password` (formulário, e-mail inválido sem chamar a API, mensagem igual para os três casos e e-mail capturado só da conta confirmada) |

Verificação manual de UI (`/auth/forgot-password`, Chromium via Playwright, vite em dev, `POST` interceptado com 202): 375 / 768 / 1280 px sem scroll horizontal (`scrollWidth` = largura da viewport, também com o erro de validação e com a mensagem de sucesso); um único `h1` (30px); `lang="en-US"`; ordem de Tab: e-mail, botão, link `Back to sign in`, todos com `:focus-visible` verdadeiro; alvos de toque: campo 44px, botão 48px, link 110×44px; console sem erro nem warning. O anel de foco usa as mesmas classes de `Input`, `Button` e do link da página de sign-up (medido na 0004); não foi medido de novo. **Não verificado:** leitor de tela (o `role="status"` é renderizado junto com a mensagem, não antes); contraste (mesmos tokens da 0004); Mailtrap real (só o provider `capture`).

## 2. Pré-requisitos

| Item                   | Como obter                                                                  |
| ---------------------- | --------------------------------------------------------------------------- |
| Bun 1.4.4 e Node >= 24 | Instalação local                                                            |
| Docker em execução     | Necessário para `infra:up`, `db:migrate`, `test:integration` e `test:e2e`; lint, tipos, build e `test` não dependem dele |
| Supabase CLI           | `devDependency` (`supabase`); roda via `bunx supabase`                      |
| Browsers do Playwright | `bunx playwright install` (uma vez)                                         |
| `.env` na raiz         | Copie `.env.example` e preencha as chaves com `bunx supabase status -o env` |

A API **não sobe** sem `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` (falha com exit 1 e mensagem acionável). Os testes definem valores fictícios em `apps/api/test/setup-env.ts`.

## 3. Gates obrigatórios

Execute na raiz do repositório, na ordem abaixo:

| #   | Comando                    | O que valida                                | Critério                                                        |
| --- | -------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| 1   | `bun install`              | Dependências e lockfile                     | Sem erro; executar se `package.json`/`bun.lock` mudou           |
| 2   | `bun run lint`             | OXLint nos workspaces (`--deny-warnings`)   | Zero erro e zero warning                                        |
| 3   | `bun run check-types`      | `tsc --noEmit` (e `next typegen` em `docs`) | Zero erro de tipo (`types:check` é alias)                       |
| 4   | `bun run build`            | Build de produção dos três apps             | Concluído; dispensa justificada só para docs/config sem impacto |
| 5   | `bun run test`             | Vitest (unitário) em `app` e `api`          | Todos passam; sem modo watch                                    |
| 6   | `bun run test:integration` | Supertest contra a API e o Supabase local   | Todos passam                                                    |
| 7   | `bun run test:e2e`         | Playwright (app 5173 + API 3002 em `capture`) | Todos passam                                                    |
| 8   | Verificação manual         | Ver seção 5                                 | Checklist aplicável à mudança                                   |

Outros comandos:

| Comando                 | Efeito                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `bun run test:coverage` | Vitest com cobertura em `coverage/` (sem threshold nesta fase)                        |
| `bun run format`        | OXFmt escreve nos arquivos; escopo limitado por `.oxfmtrc.json`                       |
| `bun run code:fix`      | `oxlint --fix` e `oxfmt --write`                                                      |
| `bun run infra:up`      | `supabase start` + `docker compose up -d --wait` (até 300 s); sai != 0 se algo falhar |
| `bun run infra:down`    | `supabase stop` + `docker compose down`; idempotente                                  |
| `bun run db:migrate`    | `supabase migration up --local`; idempotente                                          |
| `bun run hooks:install` | `lefthook install` (grava `.git/hooks`; rode uma vez em cada clone)                   |

`bun run lint` cobre apenas os workspaces. `scripts/` e `e2e/` na raiz passam por `bun run code:fix` e por lint-staged, mas não pelo `lint` do Turbo.

### 3.1 Se um gate falhar

1. Leia a mensagem completa; não mascare com `@ts-ignore`, `any` ou desativação de regra.
2. Corrija a causa.
3. Rode novamente o gate que falhou.
4. Se o erro for pré-existente e fora do escopo, registre no relatório com evidência; não o esconda.

## 4. Subir o ambiente

```bash
bun install
cp .env.example .env        # preencha as chaves com `bunx supabase status -o env`
bun run infra:up
bun run db:migrate
bun run dev
```

| Serviço                    | URL                                           | Porta |
| -------------------------- | --------------------------------------------- | ----- |
| `apps/app` (produto)       | http://localhost:5173                         | 5173  |
| `apps/docs` (site de docs) | http://localhost:3001                         | 3001  |
| `apps/api`                 | http://localhost:3002                         | 3002  |
| Grafana                    | http://localhost:3000 (admin/admin, só local) | 3000  |
| Supabase API / Studio      | http://127.0.0.1:54321 / :54323               | 54321 |

Para subir um app isolado: `bun run dev --filter=app`, `--filter=api` ou `--filter=docs`.

`apps/docs` é o site Next.js; `.docs/` é a documentação Markdown canônica. Não confunda.

## 5. Checklist manual

Aplique apenas o que a mudança afeta, mas registre o que foi verificado.

### 5.1 Geral

- [ ] A aplicação sobe sem erro no terminal.
- [ ] Console do browser sem erro ou warning novo.
- [ ] Nenhuma chamada de rede falhando (aba Network).
- [ ] Links internos e externos não retornam 404.
- [ ] Textos em en-US e sem `lorem ipsum`/placeholder de template.
- [ ] A mudança não expõe token, chave ou dado pessoal; `service_role` não aparece em `apps/app/dist`.

### 5.2 UI e responsividade

- [ ] 375px (mobile), 768px (tablet) e 1280px (desktop).
- [ ] Sem scroll horizontal inesperado.
- [ ] Conteúdo não cortado, sobreposto ou ilegível.
- [ ] Estados de hover, focus, active, disabled, loading e erro revisados.
- [ ] Áreas de toque com pelo menos 44×44px.

### 5.3 Acessibilidade

- [ ] Navegação completa por teclado (Tab/Shift+Tab/Enter/Space/Esc).
- [ ] Foco visível e em ordem lógica.
- [ ] Todo input tem label; erros são descritos em texto.
- [ ] Contraste de texto e ícones validado (mínimo AA).
- [ ] Imagens com `alt`; decorativas com `alt=""`.
- [ ] Um único `h1` por página e headings em ordem.
- [ ] `prefers-reduced-motion` respeitado.
- [ ] Leitor de tela anuncia nome, estado e erro dos controles principais.

### 5.4 Dados, integrações e observabilidade

- [ ] Estado vazio, carregando e erro implementados.
- [ ] E-mail (Mailtrap), quando a mudança envia mensagem: no `.env` local, `EMAIL_PROVIDER=mailtrap`, `MAILTRAP_API_TOKEN` e `MAILTRAP_INBOX_ID` (Mailtrap > Email Sandbox > Inboxes > a caixa > API); suba a API (`bun run dev --filter=api`), dispare o fluxo (ou, para o teste isolado, um script que chame `EmailService.send`) e confirme que a mensagem aparece na caixa do Mailtrap com remetente igual a `EMAIL_FROM`, HTML e texto corretos. Com um token inválido o log deve trazer `email_delivery_failed` com `errorCode` `PROVIDER_UNAUTHORIZED`, sem a chave. O plano gratuito do Mailtrap tem limite de envios: prefira `capture` no dia a dia.
- [ ] Timeout e falha de integração tratados.
- [ ] Nenhuma chamada externa em loop ou sem limite.
- [ ] Permissões verificadas (um usuário não acessa dado de outro clube).
- [ ] Migration/rollback documentados.
- [ ] Com `infra:up` e a API rodando, `GET /api/v1/health` gera trace no Tempo e log no Loki com `requestId` e sem PII.
- [ ] Com o Collector parado (`docker compose stop otel-collector`), a API continua respondendo.

## 6. Dívidas de QA conhecidas

| #   | Problema                                                                          | Impacto                                                 |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | Sem CI                                                                            | Gates dependem de execução manual                       |
| 2   | Hooks só validados no commit raiz, sem teste automatizado                         | `lefthook`/`lint-staged` não comprovados                |
| 3   | `lint` do Turbo não cobre `scripts/` e `e2e/`                                     | Erros nesses arquivos passam no gate                    |
| 4   | Sem verificação de acessibilidade automatizada                                    | Regressões de a11y só aparecem na revisão manual        |
| 5   | Leitor de tela, hover/disabled/loading e `prefers-reduced-motion` não verificados | Cobertura parcial de a11y (ver §1.2)                    |
| 6   | `Button` usa `text-sm` (14px) e transições sem variante `motion-reduce`           | Fora de `DESIGN.md` §3 e §6 para o rótulo e o movimento |
| 7   | Cobertura sem threshold; `lib/supabase.ts` com 0%                                 | Código sem teste não é sinalizado                       |
| 8   | Imagens LGTM em `:latest`                                                         | Reprodutibilidade da infra local                        |

## 7. Template de evidência

Copie para o relatório final da tarefa:

```markdown
## QA executado

| Verificação | Comando                    | Resultado       |
| ----------- | -------------------------- | --------------- |
| Lint        | `bun run lint`             | Passou / Falhou |
| Tipos       | `bun run check-types`      | Passou / Falhou |
| Build       | `bun run build`            | Passou / Falhou |
| Unitários   | `bun run test`             | Passou / Falhou |
| Integração  | `bun run test:integration` | Passou / Falhou |
| E2E         | `bun run test:e2e`         | Passou / Falhou |
| Manual      | 375 / 768 / 1280           | OK / Pendência  |

### Verificações manuais

- [ ] Teclado e foco
- [ ] Contraste
- [ ] Console/Network
- [ ] en-US e conteúdo final

### Não verificado

- Motivo e risco.
```

## 8. Template de bug

```markdown
**Título:** [área] comportamento observado
**Ambiente:** app, navegador, viewport, commit

**Passos:**

1.
2.

**Esperado:**
**Obtido:**
**Evidência:** print/log/URL
**Impacto:** bloqueante / alto / médio / baixo
```

### 1.10 Verificação da spec 0008 em 2026-11-09

Executado no worktree da spec, em paralelo com a spec 0006 (outro worktree, mesmo Supabase local), com o lock de infraestrutura da orquestração. `test:e2e` rodou com `E2E_APP_PORT=5220 E2E_API_PORT=3050`. Sem a 0007, o E2E semeia o usuário e emite a sessão por helper (`e2e/support/session.ts`), como o `session.spec.ts`. Nenhuma migration nova.

| Gate | Resultado | Observação |
| --- | --- | --- |
| `bun run lint` | Passa | 4 tasks, 0 warnings, 0 erros |
| `bun run check-types` | Passa | 4 tasks |
| `bun run build` | Passa | `app`, `api` e `docs` |
| `bun run test` | Passa | `api`: 236 testes (29 arquivos, inclui `SignOut`); `app`: 124 testes (13 arquivos, inclui o botão: mouse, Enter, Space, desabilitado enquanto envia, rede/5xx/401) |
| `bun run test:integration` | Passa | 123 testes (10 arquivos); `auth-sign-out` (6): 204 sem corpo, `revoked_at`, token 401 em `GET /auth/session`, segundo sign-out 401, sem token/token inválido 401, outro usuário intacto |
| `bun run test:e2e` | Passa | 30 testes (Chromium); `sign-out` (5): botão, token removido, token 401 na API, `/app` privado, "voltar", teclado, API inalcançável, área de toque >= 44x44 |

Verificação manual de UI (home em `/app`, Chromium via Playwright, vite em dev, API interceptada): 375 / 768 / 1280 px sem scroll horizontal (`scrollWidth` = largura da viewport); um único `h1`; botão `Sign out` com 112x44 px; `Tab` leva o foco ao botão (`:focus-visible` verdadeiro; o anel usa as classes do `Button` do `@repo/ui`, medidas nas specs anteriores); texto `#0A0A0A` sobre `#FFFDF5`; console sem erro nem warning. **Não verificado:** leitor de tela; hover/active; `prefers-reduced-motion` (o spinner tem `motion-reduce:animate-none`, sem teste); `vite preview`; anel de foco medido de novo nesta spec.
