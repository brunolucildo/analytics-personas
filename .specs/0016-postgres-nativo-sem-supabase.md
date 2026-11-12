# 0016 — Postgres nativo no lugar do Supabase

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** pronta
- **Slug:** postgres-nativo-sem-supabase
- **Data:** 2026-11-12
- **Atualizado em:** 2026-11-12
- **Owner:** Solicitante (Owner do produto)
- **Relacionados:** specs `0004`–`0010` (auth), `0011` (observabilidade da API), `0013` (observabilidade do Postgres), `0015` (proteção de hash); ADRs `0007`, `0008`, `0011`, `0014`; novos ADRs `0015` (acesso a dados com `pg`) e `0016` (instrumentação do Postgres no pool); `.docs/ARCHITECTURE.md` §2–§7, `.docs/DEVELOPMENT.md` §5–§7, `.docs/QA.md` §1–§5. **Substitui como decisão vigente:** ADR `0008` e ADR `0011` (marcados como substituídos). **Não altera o contrato** das specs `0004`–`0010`, `0015`.

## 1. Escopo

### Dentro do escopo

- Adicionar um serviço `postgres` (`postgres:17-alpine`, porta **5432**, volume próprio, healthcheck) ao `docker-compose.yml`.
- Criar os roles `rondo_migrator` (dono do schema, DDL) e `rondo_app` (DML + `execute` nas funções), com bootstrap idempotente em `db/init/`.
- Trocar o acesso a dados da API de `@supabase/supabase-js` (PostgREST + RPC) para `pg` (node-postgres) com SQL parametrizado e Pool.
- Mover `supabase/migrations/*.sql` para `db/migrations/*.sql`, editando-as para remover RLS, policies, `anon`, `authenticated` e `service_role`, e conceder privilégios a `rondo_app`.
- Criar o runner de migrations (`bun run db:migrate`) com tabela `schema_migrations`, checksum, transação, ordem e advisory lock.
- Remover `supabase` (devDependency/CLI), `supabase/config.toml`, `supabase/.temp`, `.gitignore`, ignores de OXLint/OXFmt e `scripts/lib/supabase-env.ts`.
- Remover `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`; introduzir `DATABASE_URL` (runtime) e `DATABASE_MIGRATOR_URL` (migrations).
- Remover `apps/app/src/lib/supabase.ts`, a dependência `@supabase/supabase-js` do app e qualquer leitura de `VITE_SUPABASE_*`.
- Renomear os adaptadores `Supabase*` para `Postgres*`/`Pg*` e substituir `rpc()`/`.from()` por SQL parametrizado, mantendo ports, casos de uso, domínio e contrato HTTP intactos.
- Substituir `createInstrumentedFetch()` por um wrapper de telemetria sobre o Pool, preservando nomes de métrica, span e atributos, sem SQL, parâmetros, e-mail, `sid` ou IP.
- Repontar o receiver `postgresql` do OTel Collector para o serviço `postgres` do Compose, derivando host/porta/usuário/senha de `DATABASE_URL` no `infra:up`.
- Remover do dashboard e dos alertas tudo que pressupõe Supabase/PostgREST (`server_address=~".*supabase.*"`, regras `rondo-supabase-*`, painel "Dependências externas: Supabase").
- Reescrever os helpers de seed/limpeza de integration, E2E e teste de carga para usar `pg` + `DATABASE_URL`.
- Atualizar `README.md`, `.docs/*`, `.env.example` e as skills próprias que citam Supabase; criar os ADRs `0015` e `0016` e marcar `0008`/`0011` como substituídos; anotar a spec `0013`.
- Manter todos os gates verdes: `lint`, `check-types`, `build`, `test`, `test:integration`, `test:e2e`.

### Fora do escopo

- Alterar o contrato HTTP de auth, regras de senha, tokens, sessão única, rate limit, e-mail ou JWT (specs `0002`, `0003`, `0004`–`0010`, `0015`).
- Alterar o modelo de dados de domínio: colunas, constraints, índices, `on delete cascade`, trigger `set_updated_at`, assinatura/retorno das 6 funções SQL.
- Migrar dados do Supabase local: são dados de desenvolvimento/teste e serão descartados. **Não** tocar em nenhum projeto Supabase hospedado.
- ORM/query builder (`Drizzle`, `Kysely`, `Prisma`), PgBouncer, replicação, backup/PITR, deploy, CI e provedor de Postgres gerenciado.
- Reintroduzir `anon`/`authenticated`/`service_role`, RLS, PostgREST, Storage ou Realtime.
- Adicionar verificação de banco ao `GET /api/v1/health` e novas métricas de aplicação.
- Reescrever specs concluídas (`0000`–`0012`, `0014`, `0015`) como se nunca tivessem usado Supabase; elas ficam como registro histórico.
- Remover a skill de terceiro `supabase-postgres-best-practices` (é um guia de Postgres, não uma integração).
- Alterar `turbo.json`, o bloco `turborepo-agent-rules` do `AGENTS.md` da raiz ou artefatos gerados.

## 2. Contexto

Hoje o banco é o Supabase local via CLI. A API fala com o Postgres **só** por `@supabase/supabase-js` com a service role (ADR `0008`): leituras e escritas simples vão pelo PostgREST (`/rest/v1/<tabela>`) e o que exige transação vive em 6 funções SQL chamadas por RPC. A segurança depende do modelo do Supabase: RLS ligada sem policies, `revoke all` de `anon`/`authenticated` e `execute` concedido só a `service_role`. A observabilidade do banco também depende disso: `createInstrumentedFetch()` instrumenta o `fetch` do `supabase-js` (ADR `0011`), o dashboard tem uma seção "Dependências externas: Supabase" e existem duas regras de alerta `rondo-supabase-*`.

Isso traz custo desnecessário: uma CLI extra e ~10 containers para um banco relacional, chaves e JWT de plataforma que o produto não usa (a identidade é própria, ADR `0007`), telemetria acoplada a um hop HTTP que ninguém precisa e uma superfície de segurança (PostgREST exposto) que só existe para justificar RLS/roles. O produto precisa de Postgres puro: conexão direta, um `DATABASE_URL` no runtime, migrations versionadas no repositório e o banco subindo no mesmo Compose da observabilidade.

A troca é grande porque o Supabase aparece em infra, API, SPA, scripts, testes, telemetria, dashboard, alertas e documentação. Deixar qualquer ponta para trás produz painel vazio, teste que não sobe ou doc mentindo — por isso a remoção é parte da entrega, não limpeza posterior.

## 3. Necessidade de negócio

| Item                     | Descrição |
| ------------------------ | --------- |
| Usuário/papel afetado    | Time de engenharia (dev local) e a API Nest, única que acessa o banco. |
| Decisão ou ação que muda | Subir o ambiente com `bun install` + `bun run infra:up` + `bun run db:migrate` + `bun run dev`, sem CLI do Supabase, sem chaves de plataforma e com um `DATABASE_URL`. |
| Resultado esperado       | Postgres nativo no Compose, migrations aplicadas pelo repositório, API com `pg`, testes e observabilidade verdes, zero referência a Supabase no código/config/docs. |
| Métrica de sucesso       | `rg -i supabase` nos caminhos de código/config/docs retorna vazio (fora do histórico); `bun run lint`, `check-types`, `build`, `test`, `test:integration` e `test:e2e` passam; `infra:up` sobe `postgres` e LGTM `healthy`; dashboard e alertas carregam sem consulta órfã. |

## 4. Requisitos

| ID  | Requisito | Prioridade | Critério de aceite |
| --- | --------- | ---------- | ------------------ |
| R1  | Postgres no Compose | Must | Given Docker em execução, When `bun run infra:up`, Then `docker compose ps` mostra `postgres` `healthy` com imagem `postgres:17-alpine`, mapeamento `5432:5432`, volume persistente e healthcheck `pg_isready`; os containers LGTM também ficam `healthy`. |
| R2  | Dois roles, sem roles do Supabase | Must | Given um volume novo, When inspecionar o banco, Then existem `rondo_migrator` (dono do schema) e `rondo_app`; **não** existem `anon`, `authenticated` nem `service_role`; Given conexão como `rondo_app`, When `CREATE TABLE`, `DROP TABLE` ou `ALTER TABLE`, Then falha com SQLSTATE `42501`; When `SELECT`/`INSERT`/`UPDATE`/`DELETE` em `users`, `auth_tokens`, `sessions`, Then funciona; When executar as 6 funções, Then funciona. |
| R3  | Uma variável de banco no runtime | Must | Given `.env.example`, Then contém `DATABASE_URL` e `DATABASE_MIGRATOR_URL` e nenhuma `SUPABASE_*`/`VITE_SUPABASE_*`; Given a API sem `DATABASE_URL`, When iniciar, Then falha com exit != 0 e mensagem citando `DATABASE_URL` e `.env.example`; Given `DATABASE_URL` com esquema diferente de `postgres:`/`postgresql:`, Then falha rápido e a mensagem não ecoa o valor; Given `db:migrate` sem `DATABASE_MIGRATOR_URL`, Then falha com mensagem acionável. |
| R4  | Runner de migrations próprio | Must | Given `db/migrations` com N arquivos, When `bun run db:migrate`, Then aplica em ordem lexicográfica, cada arquivo em uma transação, e registra `name`, `checksum` e `applied_at` em `schema_migrations`; When rodar de novo, Then não reaplica e sai com 0; Given arquivo já aplicado com checksum diferente, Then falha sem executar nada; Given erro no meio de um arquivo, Then faz rollback do arquivo, sai != 0 e não registra a linha; Given duas execuções simultâneas, Then `pg_advisory_lock` serializa e nenhuma migration roda duas vezes. |
| R5  | Migrations adaptadas ao Postgres nativo | Must | Given `bun run db:migrate` em banco vazio, Then existem `users`, `auth_tokens`, `sessions` com as mesmas colunas, checks, uniques, índices, `on delete cascade`, trigger `users_set_updated_at` e as 6 funções (`auth_sign_up`, `auth_issue_session`, `auth_confirm_account`, `auth_resend_confirmation`, `auth_request_password_reset`, `auth_reset_password`) com os mesmos parâmetros e retornos; nenhum arquivo contém `enable row level security`, `create policy`, `to anon`, `to authenticated` ou `to service_role`; toda tabela e função usada pela API tem privilégio para `rondo_app`; `alter default privileges` garante DML em tabelas futuras; cada arquivo mantém o comentário de rollback. |
| R6  | API com `pg` e SQL parametrizado | Must | Given `apps/api`, Then não há dependência nem import de `@supabase/supabase-js`; os repositórios em `infrastructure` usam um Pool `pg` e SQL com placeholders (`$1`, `$2`); nenhum valor de entrada é concatenado na string SQL; as ports de `domain`, os casos de uso de `application` e os request handlers de `interface` permanecem com as mesmas assinaturas. |
| R7  | Atomicidade e concorrência preservadas | Must | Given os testes de integração existentes, When rodam contra o Postgres novo, Then o comportamento não muda: cadastros simultâneos do mesmo e-mail produzem 1 vencedor e N `null`; uma sessão ativa por usuário; token de confirmação/reset consumido uma única vez; reset de senha revoga todas as sessões; `forgot-password` e `resend-confirmation` continuam anti-enumeração. |
| R8  | Erros de banco sem vazamento | Must | Given violação de unique/check ou token inexistente, Then o erro de domínio continua o mesmo (`EMAIL_ALREADY_REGISTERED`, `TOKEN_INVALID_OR_EXPIRED`…); Given falha de conexão ou SQLSTATE inesperado, Then `DataAccessError` com mensagem fixa (operação + SQLSTATE, **sem** valores) vira `500 INTERNAL_ERROR`, nunca `401`, `409` ou `503`; nenhum e-mail, senha, token, `sid`, SQL ou parâmetro aparece em resposta, log ou span. |
| R9  | Ciclo de vida e limites do Pool | Must | Given o boot da API, Then o Pool usa `DATABASE_URL`, `max=10`, `connectionTimeoutMillis=5000`, `idleTimeoutMillis=30000` e `application_name=rondo-api`; Given SIGTERM/SIGINT, Then o Pool é encerrado no desligamento gracioso e o processo sai com 0; Given banco indisponível, Then a requisição falha em até o timeout, sem pendurar o processo. |
| R10 | TLS por `DATABASE_URL` | Should | Given `DATABASE_URL` com `sslmode=require` ou `sslmode=verify-full`, When o Pool é criado, Then `ssl` é configurado (teste unitário do parser); Given ausência de `sslmode` ou `sslmode=disable`, Then conecta sem TLS. |
| R11 | Contrato de telemetria do banco preservado | Must | Given qualquer operação, Then é emitido 1 ponto em `db.client.operation.duration` e 1 span `<operation> <alvo>` com `db.system.name=postgresql`, `db.operation.name`, `db.collection.name` (tabela) ou `db.stored_procedure.name` (função); o alvo é declarado pelo repositório (nunca inferido do SQL) e nome fora de `[a-z_][a-z0-9_]{0,62}` vira `unknown`; `error.type` é o SQLSTATE ou `connection`; span `ERROR` e log `db_operation_failed` só em falha de infraestrutura (falha de conexão e classes `08`, `53`, `57`, `58`), nunca em violação de negócio (`23*`, `22*`); **nunca** há `db.statement`, texto de SQL, parâmetros, e-mail, `sid` ou IP em span, métrica ou log. |
| R12 | Receiver `postgresql` no Compose | Must | Given `bun run infra:up`, Then o Collector coleta o banco do serviço `postgres` (`endpoint: postgres:5432`, database `rondo`, usuário `rondo_app` com `pg_monitor`), com o host reescrito de `localhost` para `postgres` a partir de `DATABASE_URL`; não existe `POSTGRES_*` no `.env`; Given o banco fora, Then `postgresql_backends{job="rondo-postgres"}` desaparece e o alerta de banco fora dispara. |
| R13 | Dashboard e alertas sem Supabase | Must | Given `infra/grafana`, Then nenhum título, descrição, expressão ou comentário contém "Supabase"; nenhuma query usa `server_address=~".*supabase.*"`; não existe regra `rondo-supabase-*`; o painel de dependências externas cobre só o provedor de e-mail; os painéis de banco seguem usando `db.client.operation.duration`, `db_operation_failed` e `postgresql_*` com `job="rondo-postgres"`; `grafana-assets.spec.ts` passa e continua proibindo atributos de PII. |
| R14 | SPA sem cliente de banco | Must | Given `apps/app`, Then `src/lib/supabase.ts` não existe, `@supabase/supabase-js` saiu do `package.json` e nenhum arquivo lê `VITE_SUPABASE_*`; `bun run build` do app não contém chave, URL de banco nem o nome `supabase`; o app continua falando só com `VITE_API_URL`. |
| R15 | Scripts de infra e migrations | Must | Given `bun run infra:up`, Then sobe Postgres + LGTM, espera os healthchecks (até 300 s) e imprime a URL local do banco e a do Grafana; Given `bun run infra:down`, Then para os containers, preserva o volume e é idempotente; Given `bun run db:migrate`, Then usa o runner próprio, sem CLI externa nem `bunx supabase`; `scripts/lib/supabase-env.ts` não existe. |
| R16 | Seed e limpeza de testes via `pg` | Must | Given `bun run test:integration`, Then a `globalSetup` exige `DATABASE_URL`, verifica que `users` existe e falha com instrução acionável (`infra:up` + `db:migrate`) quando não; cada teste semeia e limpa por um helper `pg` compartilhado; Given `bun run test:e2e`, Then `seedConfirmedUser`, `seedUserWithPassword`, `seedUnconfirmedUser`, `issueAccessToken` e o `globalTeardown` usam SQL, sem PostgREST; Given `bun run load smoke`, Then o runner recusa banco não local, sobe a API com `DATABASE_URL`, apaga contas `k6-*` por SQL e não usa chave de plataforma. |
| R17 | Gates completos | Must | Given Docker com `infra:up` e `db:migrate`, Then `bun run lint`, `bun run check-types`, `bun run build`, `bun run test`, `bun run test:integration` e `bun run test:e2e` passam; nenhum teste foi removido, pulado, marcado `skip`/`todo` ou afrouxado para ficar verde. |
| R18 | Documentação e ADRs atualizados | Must | Given `README.md`, `.docs/AGENTS.md`, `.docs/ARCHITECTURE.md`, `.docs/DEVELOPMENT.md`, `.docs/QA.md` e `.docs/RULES.md`, Then descrevem Postgres nativo, `pg`, roles, `DATABASE_URL`/`DATABASE_MIGRATOR_URL`, runner próprio e o novo caminho de telemetria; ADR `0015` (acesso a dados) e ADR `0016` (instrumentação) existem; ADRs `0008` e `0011` têm cabeçalho "Substituído por"; a spec `0013` ganha nota de refinamento apontando a substituição. |
| R19 | Repositório sem resíduo de Supabase | Must | Given `apps/`, `packages/`, `e2e/`, `scripts/`, `infra/`, `docker-compose.yml`, `package.json`, `bun.lock`, `.env.example`, `.gitignore`, `.oxlintrc.json`, `.oxfmtrc.json`, `README.md`, `.docs/` e `.claude/skills/{commit-and-push,refactor-slices,code-review}`, When `rg -i supabase`, Then não há ocorrência; `.gitignore`, `.oxlintrc.json` e `.oxfmtrc.json` não têm entradas `supabase/.temp`; `bun.lock` não contém o pacote `supabase` nem `@supabase/supabase-js`. **Fora da busca:** `.specs/**`, `.adrs/**`, `skills-lock.json` e `.claude/skills/supabase-postgres-best-practices/**`. |
| R20 | Reset do banco local | Should | Given `bun run infra:reset`, Then faz `docker compose down -v` e sobe de novo; ao final, `users` não existe até rodar `db:migrate`, e o comando avisa que os dados locais foram apagados. |
| R21 | Teste de carga sem regressão | Could | Given `bun run load smoke` com Docker, Then o resumo é gerado em `load/results/`, as métricas chegam ao Mimir e o banco não vira gargalo (conexões abaixo do `max`). |

## 5. Fluxos e estados

- **Caminho feliz:** `bun install` → `.env` copiado de `.env.example` → `bun run infra:up` (Postgres `healthy`, LGTM `healthy`) → `bun run db:migrate` (aplica `db/migrations` e registra em `schema_migrations`) → `bun run dev` → sign-up, confirmação, sign-in, sessão, sign-out, forgot/reset funcionam; dashboard e alertas carregam; `test:integration` e `test:e2e` passam.
- **Vazio:** banco recém-criado, sem migrations: `db:migrate` aplica todas e informa quantas; `test:integration` falha com a instrução de rodar `db:migrate`, não com erro de SQL cru.
- **Carregando:** `infra:up` aguarda os healthchecks por até 300 s e mostra progresso; não retorna sucesso antes de `postgres` e LGTM estarem `healthy`.
- **Erro:** Docker desligado, porta **5432** ocupada, `DATABASE_URL`/`DATABASE_MIGRATOR_URL` ausente ou inválida, role sem privilégio, migration com erro ou checksum divergente, banco fora no meio de uma requisição — cada caso produz mensagem acionável e código de saída != 0 (CLI) ou envelope de erro conhecido (API). Nenhuma mensagem ecoa senha, token, e-mail ou SQL.
- **Sucesso parcial:** Postgres sobe e o LGTM falha → `infra:up` sai != 0, diz qual container falhou, mantém o que subiu e não derruba o banco. Migration 1..N aplicadas e a N+1 falha → as anteriores ficam registradas, a N+1 faz rollback, exit != 0; rodar de novo retoma da N+1.
- **Cancelamento/retry:** Ctrl+C durante `infra:up`/`db:migrate` não deixa migration registrada pela metade (transação); `db:migrate` é seguro para repetir; `infra:down` pode rodar mesmo com containers já parados; `infra:reset` é a única operação que apaga o volume e avisa antes.

## 6. Acceptance Criteria

- [ ] Given Docker, When `bun run infra:up`, Then `postgres` e LGTM ficam `healthy` e a porta 5432 responde. (R1, R15)
- [ ] Given o banco vazio, When `bun run db:migrate`, Then todas as migrations são aplicadas em ordem, `schema_migrations` tem uma linha por arquivo e a segunda execução não reaplica nada. (R4)
- [ ] Given o banco migrado, When conexão como `rondo_app`, Then DML e as 6 funções funcionam e DDL falha com `42501`; `anon`, `authenticated` e `service_role` não existem. (R2, R5)
- [ ] Given a API compilada, When inicia sem `DATABASE_URL`, Then falha rápido com mensagem acionável; com a URL válida, Then sobe e responde `GET /api/v1/health`. (R3, R9)
- [ ] Given os fluxos de auth, When `bun run test:integration`, Then sign-up concorrente, sessão única, confirmação, forgot/reset e anti-enumeração passam sem alteração de contrato. (R7, R16, R17)
- [ ] Given um span de sign-in no Tempo, Then existem `select users`, `rpc auth_sign_up`/`auth_issue_session` (ou o novo nome equivalente declarado) e nenhum `db.statement`, e-mail, `sid` ou IP. (R11)
- [ ] Given `bun run test:e2e`, Then seed e teardown usam SQL, os specs de auth passam e nenhum dado `e2e-*` sobra no banco. (R16, R17)
- [ ] Given `infra/grafana`, When carregar o dashboard e as regras, Then não há consulta órfã nem referência a Supabase e `grafana-assets.spec.ts` passa. (R12, R13)
- [ ] Given `apps/app`, When `bun run build`, Then o bundle não contém Supabase, URL de banco nem chave. (R14)
- [ ] Given os caminhos de R19, When `rg -i supabase`, Then não há resultado. (R19)
- [ ] Given `README.md` e `.docs/*`, Then descrevem o novo caminho e os ADRs `0015`/`0016` existem com `0008`/`0011` marcados como substituídos. (R18)

## 7. O que fazer

1. **Infra e variáveis**
   - Adicionar `postgres` ao `docker-compose.yml`: imagem `postgres:17-alpine`, `5432:5432`, `POSTGRES_DB=rondo`, `POSTGRES_USER=rondo_migrator`, senha de desenvolvimento fixa (`rondo`, não é segredo), volume `postgres-data`, healthcheck `pg_isready`, `docker-entrypoint-initdb.d` apontando para `db/init/`.
   - Criar `db/init/01-roles.sql` (idempotente): `rondo_app` com senha de desenvolvimento, `grant connect`, `grant pg_monitor to rondo_app`, `alter default privileges` para DML em tabelas futuras. O schema é do `rondo_migrator` (usuário do container).
   - Atualizar `.env.example`: `DATABASE_URL=postgres://rondo_app:rondo@localhost:5432/rondo` e `DATABASE_MIGRATOR_URL=postgres://rondo_migrator:rondo@localhost:5432/rondo`; remover as 6 variáveis de Supabase.
   - Remover de `.gitignore`, `.oxlintrc.json` e `.oxfmtrc.json` as entradas `supabase/.temp`/`supabase/.branches`.

2. **Migrations**
   - `git mv supabase/migrations db/migrations` e apagar `supabase/` (inclui `config.toml`).
   - Editar cada `.sql` no lugar (não há banco implantado, não criar migration de correção): remover `enable row level security`, policies, `revoke`/`grant` para `anon`/`authenticated`/`service_role`; conceder DML em `users`, `auth_tokens`, `sessions` e `execute` nas 6 funções a `rondo_app`. Preservar `set search_path = ''`, comentários de rollback e toda a lógica transacional.
   - Criar `scripts/db-migrate.ts`: valida `DATABASE_MIGRATOR_URL`, cria `schema_migrations` se não existir, adquire `pg_advisory_lock`, lê `db/migrations/*.sql` em ordem, compara checksums, aplica cada arquivo em transação e libera o lock. Imprime quantas aplicou e quais. Declarar `pg` como devDependency da raiz.
   - `scripts/lib/command.ts`: remover `supabaseCommand`, apontar `hasSqlMigrations` para `db/migrations`.

3. **API**
   - `apps/api/package.json`: remover `@supabase/supabase-js`; adicionar `pg` e `@types/pg`.
   - `src/config/environment.ts`: trocar as 3 variáveis Supabase por `databaseUrl` obrigatória; validar esquema `postgres:`/`postgresql:`, host e database; parsear `sslmode` (R10). Atualizar `environment.spec.ts`.
   - `src/modules/auth/auth.tokens.ts`: renomear `SUPABASE_ADMIN_CLIENT` para `PG_POOL` (ou equivalente).
   - `src/modules/auth/auth.module.ts`: prover o Pool `pg` (fábrica com `DATABASE_URL`, timeouts, `application_name`, SSL, `max=10`) com `onModuleDestroy` fechando o Pool.
   - Renomear e reescrever os 5 adaptadores: `supabase-user.repository.ts` → `postgres-user.repository.ts` (`select auth_sign_up($1..$6)`), `supabase-session.repository.ts` → `postgres-session.repository.ts` (SELECT da função e JOINs explícitos em `sessions`/`users`), `supabase-credentials.repository.ts`, `supabase-confirmation.repository.ts`, `supabase-password-reset.repository.ts`. Atualizar os specs unitários junto (o que testa PostgREST deixa de existir; o que testa o contrato do port permanece).
   - `src/modules/auth/infrastructure/data-access-error.ts`: receber operação + SQLSTATE (ou `connection`) e manter mensagem fixa.
   - `src/observability/db-telemetry.ts`: substituir `createInstrumentedFetch`/`describeDbCall` por um wrapper de `query`/`connect` do Pool que exige metadados explícitos (`operation`, `collection`/`procedure`), mantendo métrica, span, atributos, `error.type` e o log `db_operation_failed` conforme R11. Atualizar/remover `db-telemetry.spec.ts` (o parser de path do PostgREST deixa de existir) e ajustar `span-redaction.spec.ts` (sem `project.supabase.co`).

4. **SPA**
   - Apagar `apps/app/src/lib/supabase.ts`, remover `@supabase/supabase-js` do `package.json` e qualquer tipo/env `VITE_SUPABASE_*`.

5. **Testes**
   - Criar helper de banco (ex.: `apps/api/test/support/database.ts`): Pool `pg` com `DATABASE_URL`, `assertMigrationsApplied`, `deleteUsersByEmail`, `uniqueEmail`, seed de usuário/token/sessão e leitura de tokens/sessões. Apagar `test/support/supabase.ts` e `scripts/lib/supabase-env.ts`.
   - `test/support/global-setup.ts` e `test/setup-env.ts`: exigir/definir `DATABASE_URL` (não mais `SUPABASE_*`); mensagem acionável quando o banco não estiver migrado.
   - Reescrever `test/auth-database.int-spec.ts` para o novo modelo: privilégios (R2), constraints/trigger/cascade e funções via SQL; remover `signRoleToken`/`restRequest`.
   - Atualizar os demais `*.int-spec.ts` (tipo `SupabaseClient` → Pool e helper) e `rate-limit.int-spec.ts`/`email.int-spec.ts` (ConfigService falso sem campos Supabase).
   - `e2e/support/*`: seed/teardown/`issueAccessToken` via SQL; `playwright.config.ts` deixa de chamar `ensureLocalSupabaseEnv`.
   - `scripts/load-test.ts`: remover leitura de `supabase status`/chaves; usar `DATABASE_URL`, recusar host não local (`localhost`, `127.0.0.1`, `postgres`), limpar `k6-*` por SQL e passar só `DATABASE_URL` para a API isolada. Ajustar o comentário em `load/k6/main.js`.

6. **Observabilidade**
   - `infra/otel/otel-collector-config.yaml`: `endpoint: ${env:POSTGRES_ENDPOINT}`, `username: ${env:POSTGRES_USER}`, `password: ${env:POSTGRES_PASSWORD}`, `databases: [rondo]`; comentário novo (sem Supabase).
   - `scripts/infra-up.ts`: derivar `POSTGRES_ENDPOINT`/`USER`/`PASSWORD` de `DATABASE_URL` (reescrevendo host local para `postgres`) e injetar no `docker compose up`; adicionar `postgres` ao `depends_on` do Collector. Manter o comportamento de falha parcial (Postgres sobe, LGTM falha → exit 1). Em `infra-down`, manter só o `docker compose down`.
   - `infra/grafana/dashboards/api-observability.json`: renomear seção/painéis "Supabase" para "Postgres/API → banco"; remover as queries com `server_address=~".*supabase.*"` e o painel de dependência Supabase; manter e-mail, `db.client.operation.duration`, `db_operation_failed` e `postgresql_*`.
   - `infra/grafana/provisioning/alerting/rondo-alerts.yaml`: remover `rondo-supabase-lento` e `rondo-supabase-erros` e as descrições que citam Supabase; manter o grupo `rondo-postgres` (operação lenta/falha, conexões, deadlock, cache, banco fora) funcionando com `job="rondo-postgres"`.
   - `src/observability/grafana-assets.spec.ts`: atualizar expectativas (sem `http_client_request_duration` para Supabase, sem regra Supabase, ainda cobrindo `db_operation_failed`, `postgresql_*` e PII).

7. **Documentação e decisões**
   - Criar `.adrs/0015-postgres-nativo-com-pg.md` (substitui `0008`) e `.adrs/0016-instrumentacao-do-postgres-no-pool.md` (substitui `0011`); adicionar cabeçalho "Substituído por" em `0008` e `0011`; nota de refinamento em `.specs/0013`.
   - Atualizar `README.md` (estrutura, comandos, getting started), `.docs/AGENTS.md` (§1, §3, §4.6, §7), `.docs/ARCHITECTURE.md` (§1, §2, §2.1, §3.1, §4, §4.1, §4.2, §4.4, §4.6, §4.7, §5, §6, §7), `.docs/DEVELOPMENT.md` (§5, §6, §7, testes), `.docs/QA.md` (§1, §2, §3, §4, §5, evidências e pré-requisitos), `.docs/RULES.md` (tabela de skills) e as skills próprias `commit-and-push`, `refactor-slices` e `code-review`.
   - Atualizar `.env.example` com comentários do novo fluxo (roles, portas, por que `rondo`/`rondo` são credenciais de desenvolvimento).

8. **Fechamento**
   - Rodar os gates de R17 com Docker, `infra:up` e `db:migrate`; rodar `rg -i supabase` com as exclusões de R19; registrar evidências em `QA.md`; commitar com `commit-and-push`.

## 8. O que não fazer

- Não manter `@supabase/supabase-js`, `supabase` CLI, `supabase/` nem shims de compatibilidade “só por enquanto”.
- Não criar `anon`, `authenticated`, `service_role`, policies ou RLS; não conceder DDL a `rondo_app`.
- Não concatenar valores em SQL; não usar `select *` em código novo; não logar SQL, parâmetros ou valores de domínio.
- Não colocar `DATABASE_URL`, `DATABASE_MIGRATOR_URL` ou qualquer credencial em variável `VITE_*`, no bundle ou em log.
- Não apagar dados de um Supabase hospedado nem rodar `docker compose down -v` sem aviso explícito.
- Não instalar CLI de migrations (`node-pg-migrate`, `dbmate`, `drizzle-kit`) nem ORM: o runner é do repositório.
- Não alterar o contrato HTTP, o schema de domínio, as assinaturas das funções SQL ou as regras de auth para “aproveitar a migração”.
- Não afrouxar, pular ou remover testes para passar; não alterar `turbo.json` nem o bloco gerenciado do `AGENTS.md`.
- Não remover a skill `supabase-postgres-best-practices` (conteúdo de Postgres) nem reescrever specs concluídas.
- Não adicionar verificação de banco ao `/health` nem novas métricas de aplicação.

## 9. Riscos e dependências

| Tipo | Descrição | Mitigação |
| ---- | --------- | --------- |
| Risco | Porta **5432** já ocupada por um Postgres instalado na máquina. | `infra:up` falha com mensagem clara e instrução para parar o serviço ou ajustar a porta e o `DATABASE_URL`; documentar em `QA.md`. |
| Risco | `.env` de desenvolvimento aponta hoje para um Supabase **hospedado**; confundir os dois pode levar a tentar “limpar” a nuvem. | A spec só descarta dados locais; `infra:reset` só toca no volume Docker; a doc diz explicitamente para não usar credencial hospedada. |
| Risco | Regressão silenciosa em concorrência (sessão única, token de uso único) ao trocar RPC por SQL direto. | Manter as funções SQL e rodar os testes de integração existentes; nenhum teste de concorrência pode ser removido (R7, R17). |
| Risco | Vazamento de PII na telemetria ao instrumentar `pg` (SQL/params). | Wrapper próprio com metadados explícitos e proibição de `db.statement`; teste de sentinela em `auth-observability.int-spec.ts` e proibição no `grafana-assets.spec.ts`. |
| Risco | Migrations editadas no lugar erram grants e a API quebra só em runtime. | Teste de integração de privilégios (R2) como gate; `alter default privileges` para tabelas futuras. |
| Risco | Checksum/ordem de migrations divergirem entre máquinas e worktrees (histórico de `MigrationMissingLocalError`). | Runner recusa checksum divergente, usa advisory lock e imprime o arquivo aplicado; `infra:reset` disponível. |
| Risco | Dashboard/alerta órfão derruba o `grafana-assets.spec.ts` ou fica vazio na interface. | R13 + atualização do spec de assets no mesmo commit; validar o dashboard na interface. |
| Dependência | Docker em execução para `infra:*`, `test:integration`, `test:e2e` e carga. | Mantido como pré-requisito atual; mensagens acionáveis. |
| Dependência | `pg`/`@types/pg` (novos) e `postgres:17-alpine`. | Instalar só em `apps/api` + raiz (dev), justificar no relatório e atualizar `ARCHITECTURE.md` §3.1. |
| Dependência | `DATABASE_MIGRATOR_URL` só existe em máquinas que rodam migrations. | A API não a exige no boot; `db:migrate` falha com instrução se faltar. |

## 10. Resultado

Como validar que a spec foi atendida:

- **Comando/verificação:** `bun install`; `bun run infra:up`; `bun run db:migrate`; `bun run db:migrate` de novo (idempotência); `bun run lint`; `bun run check-types`; `bun run build`; `bun run test`; `bun run test:integration`; `bun run test:e2e`; `rg -i supabase` nos caminhos de R19 com as exclusões; `docker compose ps`; consulta a `schema_migrations`.
- **Evidência esperada:** saída 0 nos gates; `postgres` e LGTM `healthy`; uma linha por migration em `schema_migrations`; `\dp`/`information_schema.role_table_grants` mostrando `rondo_app` com DML e sem DDL; `rg` vazio; dashboard e alertas carregando sem erro no Grafana; `bun.lock` sem `supabase`.
- **Comportamento observável:** do zero ao sign-in em `/app` sem nenhuma chave de plataforma, com apenas `DATABASE_URL` no runtime; span de banco com tabela/função e sem SQL/PII; `docker compose down` preserva os dados e `infra:reset` os apaga com aviso; nenhum container, variável, script ou doc menciona Supabase.

## 11. Perguntas abertas e premissas

| Pergunta/Premissa | Impacto | Bloqueante? | Quem decide |
| ----------------- | ------- | ----------- | ----------- |
| **Decisão (2026-11-12):** driver `pg` (node-postgres) com SQL puro. | Define repositórios e o formato das queries. | Não (resolvida) | Solicitante |
| **Decisão (2026-11-12):** migrations em `.sql` + runner próprio em Bun com `schema_migrations`, checksum, transação e advisory lock. | Substitui a CLI do Supabase sem dependência nova. | Não (resolvida) | Solicitante |
| **Decisão (2026-11-12):** manter as 6 funções SQL e chamá-las por `SELECT`. | Preserva atomicidade, travas e os testes de concorrência. | Não (resolvida) | Solicitante |
| **Decisão (2026-11-12):** dois roles, `rondo_migrator` (DDL) e `rondo_app` (DML + execute); sem RLS nem roles do Supabase. | Modelo de segurança do banco. | Não (resolvida) | Solicitante |
| **Decisão (2026-11-12):** dados locais descartados; nenhuma migração de dados. | Sem script de dump/restore. | Não (resolvida) | Solicitante |
| **Decisão (2026-11-12):** `DATABASE_URL` (runtime) + `DATABASE_MIGRATOR_URL` (migrations). | A API não carrega credencial com DDL. | Não (resolvida) | Solicitante |
| **Decisão (2026-11-12):** telemetria com wrapper próprio sobre o Pool, mantendo nomes/labels e proibindo SQL/PII; observabilidade entra nesta spec. | Mantém a spec `0013` e o dashboard coerentes. | Não (resolvida) | Solicitante |
| **Decisão (2026-11-12):** Collector deriva credenciais de `DATABASE_URL`; seed/limpeza dos testes com helper `pg`; `postgres:17-alpine` na porta 5432. | Scripts, testes e Compose. | Não (resolvida) | Solicitante |
| **Premissa:** credenciais de desenvolvimento `rondo`/`rondo` no container e no `.env.example` não são segredo. | Simplicidade local; produção usa a URL real. | Não | Engenharia |
| **Premissa:** Pool fixo em `max=10`, com timeouts de 5 s/30 s, sem variável nova. | Nenhuma env além das duas URLs. | Não | Engenharia |
| **Premissa:** `infra:up` não roda migrations; `db:migrate` continua um passo separado. | Mantém o fluxo atual e a falha explícita. | Não | Engenharia |
| **Premissa:** `pg_monitor` concedido a `rondo_app` só dá acesso a views de estatística, nunca a dados de tabela. | Permite o receiver com uma única URL. | Não | Engenharia |
| TLS em produção (R10, Should): usar `sslmode=require`/`verify-full` quando houver Postgres gerenciado? | Sem isso, deploy futuro exige ajuste. | Não | Owner |
| Pool/PgBouncer por ambiente (`max`, timeouts) e backup/PITR. | Fora do escopo local. | Não | Owner |
| Adicionar verificação de banco ao `GET /health`? | Fora do escopo; decisão futura. | Não | Owner |

## 12. Refinamento

| Data       | O que mudou | Motivo |
| ---------- | ----------- | ------ |
| 2026-11-12 | Criação da spec com as decisões de driver, migrations, funções SQL, roles, URLs, observabilidade e seed de testes fechadas na entrevista. | Pedido de remover o Supabase em favor de Postgres nativo com `DATABASE_URL` e Postgres via Docker. |
