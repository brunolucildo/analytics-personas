# Plano — Postgres nativo no lugar do Supabase

- **Status:** pronto para implementar
- **Slug:** postgres-nativo-sem-supabase
- **Spec:** `.specs/0016-postgres-nativo-sem-supabase.md`
- **Data:** 2026-11-12

## Contexto

O banco local é o Supabase (CLI + ~10 containers). A API acessa o Postgres exclusivamente por `@supabase/supabase-js` com a service role: PostgREST para leituras/escritas simples e RPC para as 6 funções transacionais. A segurança depende de RLS sem policies, `revoke` de `anon`/`authenticated` e `execute` só para `service_role`. A observabilidade do banco depende de instrumentar o `fetch` do `supabase-js` e o dashboard/alertas têm uma seção e regras específicas de Supabase. O SPA carrega `src/lib/supabase.ts`, e infra, scripts, testes e docs citam Supabase em vários pontos.

O produto não usa identidade nem Storage/Realtime do Supabase; a identidade é própria (ADR `0007`). Toda a dependência existe por inércia da fundação.

## Objetivo

Substituir o Supabase local por Postgres nativo no mesmo Compose da observabilidade, com um único `DATABASE_URL` no runtime, migrations versionadas no repositório com runner próprio, API usando `pg` e SQL parametrizado, telemetria preservada sem SQL/PII e zero resíduo de Supabase em código, configs e docs.

## Não-objetivos

- Alterar contrato HTTP, regras de auth, tokens, sessão única, rate limit, e-mail ou JWT.
- Alterar colunas, constraints, índices, cascade, trigger ou assinatura das 6 funções SQL.
- Migrar dados do Supabase local; tocar em projeto Supabase hospedado.
- ORM/query builder, PgBouncer, replicação, backup/PITR, deploy, CI ou Postgres gerenciado.
- Reintroduzir `anon`/`authenticated`/`service_role`, RLS, PostgREST, Storage ou Realtime.
- Verificação de banco no `/health` ou novas métricas de aplicação.
- Reescrever specs concluídas ou remover a skill `supabase-postgres-best-practices`.
- Alterar `turbo.json`, o bloco `turborepo-agent-rules` ou artefatos gerados.

## Usuários e permissões

- **Engenharia (dev local):** sobe o ambiente com `bun install` + `bun run infra:up` + `bun run db:migrate` + `bun run dev`.
- **API Nest:** único componente que acessa o banco; usa `DATABASE_URL` (`rondo_app`, DML + `execute`).
- **Runner de migrations:** usa `DATABASE_MIGRATOR_URL` (`rondo_migrator`, dono do schema e DDL).
- **OTel Collector:** conecta como `rondo_app` com `pg_monitor` para views de estatística; nunca lê dados de tabela pela telemetria.
- **Testes/E2E/carga:** usam `DATABASE_URL`, semeiam e limpam por SQL.

## Fluxos e estados

- **Feliz:** infra:up (Postgres + LGTM `healthy`) → db:migrate (aplica N arquivos) → dev → auth completo → testes, dashboard e alertas verdes.
- **Vazio:** banco sem migrations: `db:migrate` aplica todas e informa quantas; `test:integration` falha com instrução de rodar `db:migrate`.
- **Carregando:** `infra:up` aguarda healthchecks até 300 s e mostra progresso.
- **Erro:** Docker off, porta 5432 ocupada, URL ausente/inválida, role sem privilégio, migration com erro/checksum divergente, banco fora: mensagem acionável, exit != 0 (CLI) ou envelope conhecido (API), sem ecoar senha/token/e-mail/SQL.
- **Parcial:** Postgres sobe e LGTM falha → exit != 0, mantém o que subiu. Migrations 1..N aplicadas e N+1 falha → rollback da N+1, exit != 0, retomada na próxima execução.
- **Retry/cancelamento:** `db:migrate` é idempotente e transacional; `infra:down` é idempotente; só `infra:reset` apaga volume, com aviso.

## Requisitos

| ID  | Requisito | Prioridade | Critério de aceite |
| --- | --------- | ---------- | ------------------ |
| R1  | Postgres no Compose | Must | `infra:up` deixa `postgres` (`postgres:17-alpine`, `5432:5432`, volume, `pg_isready`) e LGTM `healthy`. |
| R2  | Dois roles, sem roles do Supabase | Must | Existem `rondo_migrator` e `rondo_app`; não existem `anon`/`authenticated`/`service_role`; DDL como `rondo_app` falha com `42501`; DML e as 6 funções funcionam. |
| R3  | Uma variável de banco no runtime | Must | `.env.example` só tem `DATABASE_URL`/`DATABASE_MIGRATOR_URL`; API sem `DATABASE_URL` falha citando a variável; esquema inválido falha sem ecoar o valor. |
| R4  | Runner de migrations próprio | Must | Ordem lexicográfica, transação por arquivo, `schema_migrations(name, checksum, applied_at)`, idempotente, checksum divergente falha, advisory lock. |
| R5  | Migrations adaptadas | Must | Mesmo schema, trigger e 6 funções; sem RLS/policies/roles do Supabase; grants a `rondo_app` e default privileges; comentários de rollback preservados. |
| R6  | API com `pg` e SQL parametrizado | Must | Sem `@supabase/supabase-js`; repositórios usam Pool e `$1..$n`; ports/casos de uso/handlers com as mesmas assinaturas. |
| R7  | Atomicidade e concorrência preservadas | Must | Testes de integração existentes passam sem mudança de comportamento. |
| R8  | Erros de banco sem vazamento | Must | Violações de negócio mantêm erro de domínio; falha de infra/SQLSTATE inesperado vira `500 INTERNAL_ERROR` com mensagem fixa. |
| R9  | Ciclo de vida e limites do Pool | Must | `max=10`, `connectionTimeoutMillis=5000`, `idleTimeoutMillis=30000`, `application_name=rondo-api`; Pool fecha no shutdown. |
| R10 | TLS por `DATABASE_URL` | Should | `sslmode=require`/`verify-full` configura `ssl`; ausência/`disable` conecta sem TLS. |
| R11 | Contrato de telemetria preservado | Must | 1 ponto em `db.client.operation.duration` e 1 span `<operation> <alvo>` com atributos declarados pelo repositório; sem SQL/params/PII. |
| R12 | Receiver `postgresql` no Compose | Must | Collector usa `postgres:5432`, db `rondo`, usuário `rondo_app` com `pg_monitor`; host de `DATABASE_URL` reescrito para `postgres`. |
| R13 | Dashboard e alertas sem Supabase | Must | Nenhuma referência/consulta Supabase; painéis de banco seguem com `job="rondo-postgres"`; `grafana-assets.spec.ts` passa. |
| R14 | SPA sem cliente de banco | Must | `apps/app/src/lib/supabase.ts` não existe, dependência removida, sem `VITE_SUPABASE_*`; build não contém banco/Chave. |
| R15 | Scripts de infra e migrations | Must | `infra:up` sobe e espera; `infra:down` preserva volume; `db:migrate` usa runner próprio; `scripts/lib/supabase-env.ts` removido. |
| R16 | Seed e limpeza de testes via `pg` | Must | globalSetup exige banco migrado com instrução acionável; helper `pg` compartilhado; E2E e carga por SQL. |
| R17 | Gates completos | Must | lint, check-types, build, test, test:integration e test:e2e passam sem remover/pular/afrouxar testes. |
| R18 | Documentação e ADRs | Must | README e `.docs/*` descrevem o novo caminho; ADRs `0015`/`0016` criados; `0008`/`0011` substituídos; nota na spec `0013`. |
| R19 | Repositório sem resíduo | Must | `rg -i supabase` vazio nos caminhos de R19 (excluindo specs, ADRs, `skills-lock.json` e skill de Postgres); lockfile sem pacotes Supabase. |
| R20 | Reset do banco local | Should | `infra:reset` faz `down -v` + up, avisa que os dados foram apagados. |
| R21 | Teste de carga sem regressão | Could | `load smoke` gera resumo, métricas chegam ao Mimir e conexões ficam abaixo do `max`. |

## Contratos de dados

- `users`, `auth_tokens`, `sessions`: mesmas colunas, checks, uniques, índices, `on delete cascade` e trigger `users_set_updated_at`.
- `schema_migrations`: `name text primary key`, `checksum text not null`, `applied_at timestamptz not null default now()`.
- 6 funções SQL com assinaturas/retornos idênticos: `auth_sign_up`, `auth_issue_session`, `auth_confirm_account`, `auth_resend_confirmation`, `auth_request_password_reset`, `auth_reset_password`.
- PII (e-mail, hash de senha, hash de token, `sid`) nunca aparece em telemetria, log ou resposta de erro de infraestrutura.
- Credenciais de desenvolvimento `rondo`/`rondo` são públicas e só valem para o container local.

## Integrações

- **Docker Compose:** `postgres:17-alpine`, volume `postgres-data`, `db/init/*.sql` no entrypoint; Collector depende de `postgres` e recebe endpoint/credenciais por env.
- **API → Postgres:** Pool `pg`, timeout de conexão 5 s, query simples/transacional via funções SQL; falha de conexão vira `500` sem pendurar.
- **Runner → Postgres:** `pg_advisory_lock`, transação por arquivo, checksum; sem CLI externa.
- **Testes/E2E/carga → Postgres:** `pg` + `DATABASE_URL`; carga recusa host não local.
- **Grafana/Collector:** receiver `postgresql`, métricas `postgresql_*`, `db.client.operation.duration`, `db_operation_failed`.

## Decisões e premissas

- **Decisão:** driver `pg` com SQL puro e Pool (ADR `0015`).
- **Decisão:** migrations `.sql` + runner Bun próprio com `schema_migrations`, checksum, transação e advisory lock.
- **Decisão:** manter as 6 funções SQL chamadas por `SELECT`.
- **Decisão:** `rondo_migrator` (DDL) e `rondo_app` (DML + `execute`); sem RLS/roles de plataforma.
- **Decisão:** telemetria por wrapper próprio sobre o Pool, metadados explícitos, sem SQL/PII (ADR `0016`).
- **Premissa:** `max=10`, timeouts 5 s/30 s, `application_name=rondo-api`, sem env nova.
- **Premissa:** `infra:up` não roda migrations.
- **Premissa:** `pg_monitor` não dá acesso a dados de tabela.
- **Dúvida em aberto:** TLS em Postgres gerenciado (não bloqueante).

## Abordagem

1. **Infra e variáveis:** Compose com `postgres`, `db/init/01-roles.sql`, `.env.example`, ignores, `infra:up`/`down`/`reset`, `pg` na raiz.
2. **Migrations:** mover `supabase/migrations` → `db/migrations`, remover RLS/roles Supabase, conceder a `rondo_app`; implementar `scripts/db-migrate.ts` e ajustar `scripts/lib/command.ts`.
3. **API:** dependências, `environment.ts`, `auth.tokens.ts`, `auth.module.ts` com Pool e shutdown, 5 repositórios `postgres-*`, `data-access-error` e specs unitários.
4. **Telemetria:** reescrever `db-telemetry.ts` como wrapper do Pool, ajustar specs de telemetria e redaction.
5. **SPA:** remover cliente e dependência Supabase.
6. **Testes:** helper `pg`, global setup/env, `auth-database.int-spec.ts`, demais integrações, E2E, Playwright e carga.
7. **Observabilidade:** Collector, dashboard e alertas sem Supabase; `grafana-assets.spec.ts`.
8. **Docs e ADRs:** README, `.docs/*`, skills próprias, ADRs `0015`/`0016`, marcações em `0008`/`0011` e nota em `0013`.
9. **Fechamento:** gates completos, `rg -i supabase`, evidências em `QA.md`, `commit-and-push` e relatório.

## Arquivos previstos

- `docker-compose.yml`, `db/init/01-roles.sql`, `.env.example`, `.gitignore`, `.oxlintrc.json`, `.oxfmtrc.json` — infra e higiene.
- `scripts/infra-up.ts`, `scripts/infra-down.ts`, `scripts/db-migrate.ts`, `scripts/lib/command.ts`, `package.json` — scripts e runner.
- `db/migrations/*.sql` — schema e funções adaptados.
- `apps/api/package.json`, `src/config/environment.ts` + spec, `src/modules/auth/auth.tokens.ts`, `auth.module.ts` — configuração e DI.
- `apps/api/src/modules/auth/infrastructure/postgres-*.repository.ts`, `data-access-error.ts` + specs — acesso a dados.
- `apps/api/src/observability/db-telemetry.ts` + specs, `span-redaction.spec.ts`, `grafana-assets.spec.ts` — telemetria.
- `apps/app/src/lib/supabase.ts` (remover), `apps/app/package.json` — SPA.
- `apps/api/test/support/database.ts`, `global-setup.ts`, `setup-env.ts`, `*.int-spec.ts`, `e2e/support/*`, `playwright.config.ts`, `scripts/load-test.ts`, `load/k6/main.js` — testes.
- `infra/otel/otel-collector-config.yaml`, `infra/grafana/**` — observabilidade.
- `README.md`, `.docs/*.md`, `.adrs/0015-*`, `.adrs/0016-*`, `.adrs/0008-*`, `.adrs/0011-*`, `.specs/0013-*`, `.claude/skills/{commit-and-push,refactor-slices,code-review}` — docs e decisões.

## Testes

- **Unitário:** `environment.spec.ts` (DATABASE_URL, esquema, SSL, mensagens), `db-telemetry.spec.ts` (metadados explícitos, proibição de SQL/PII, `error.type`), repositórios `postgres-*` (SQL/port), `grafana-assets.spec.ts`, `span-redaction.spec.ts`.
- **Integração:** todos os `*.int-spec.ts` existentes, com seed/limpeza por `pg`; `auth-database.int-spec.ts` cobre privilégios, constraints, trigger, cascade e funções.
- **E2E:** specs de auth existentes, com seed/teardown SQL.
- **Manual:** `infra:up`, `db:migrate` 2×, sign-up/confirmação/sign-in/sessão/sign-out/forgot/reset, dashboard e alertas no Grafana, `infra:reset`.

## Riscos e rollback

- **Porta 5432 ocupada:** mensagem clara em `infra:up` e nota em `QA.md`.
- **`.env` aponta para Supabase hospedado:** só descartar volume Docker local; documentar.
- **Regressão de concorrência:** funções SQL preservadas e testes existentes como gate.
- **PII na telemetria:** metadados explícitos, sem `db.statement`, sentinelas nos testes.
- **Grants errados:** teste de privilégios + `alter default privileges`.
- **Checksum/ordem divergentes:** runner recusa divergência, advisory lock, `infra:reset`.
- **Dashboard/alerta órfão:** atualizar assets no mesmo commit e validar na interface.
- **Rollback:** reverter o commit; o volume `postgres-data` pode ser apagado com `infra:reset` (dados locais descartáveis). Nenhum dado hospedado é tocado.

## Critério de pronto

- [ ] `postgres` e LGTM `healthy`; `db:migrate` aplica e é idempotente.
- [ ] `rondo_app` tem DML/execute e não tem DDL; roles do Supabase ausentes.
- [ ] API sobe só com `DATABASE_URL` e falha rápido sem ela; Pool fecha no shutdown.
- [ ] Telemetria mantém métrica/span/atributos e não vaza SQL/PII.
- [ ] SPA, testes, E2E, carga, dashboard e alertas sem Supabase.
- [ ] `rg -i supabase` vazio nos caminhos de R19; `bun.lock` sem pacotes Supabase.
- [ ] Gates de R17 verdes; evidências em `QA.md`; ADRs `0015`/`0016` e docs atualizados.
- [ ] `commit-and-push` executado e relatório entregue.

## Perguntas abertas

| Pergunta | Impacto | Bloqueante? | Quem decide |
| -------- | ------- | ----------- | ----------- |
| TLS para Postgres gerenciado em produção | Ajuste futuro de deploy | Não | Owner |
| Pool/PgBouncer por ambiente e backup/PITR | Fora do escopo local | Não | Owner |
| Verificação de banco no `/health` | Fora do escopo desta spec | Não | Owner |
