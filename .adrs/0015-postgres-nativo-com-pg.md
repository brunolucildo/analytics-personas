# 0015 — Postgres nativo com `pg`, migrations próprias e dois roles

- **Status:** aceito
- **Data:** 2026-11-12
- **Substitui:** [0008](0008-acesso-a-dados-com-supabase-js-e-rpc.md)

## Contexto

O ADR 0008 fixou o acesso a dados por `@supabase/supabase-js` com a service role: leituras e escritas simples pelo PostgREST e as 6 funções transacionais por RPC. A segurança dependia do modelo do Supabase (RLS ligada sem policies, `revoke` de `anon`/`authenticated`, `execute` só para `service_role`). Em troca, o ambiente local pedia a CLI do Supabase e cerca de dez containers, chaves e JWT de plataforma que o produto não usa (a identidade é própria, ADR 0007) e uma superfície HTTP (PostgREST) que só existia para justificar a RLS. O produto precisa de um Postgres comum: conexão direta, uma variável de banco no runtime, migrations versionadas no repositório e o banco no mesmo Compose da observabilidade.

## Decisão

- **Banco:** serviço `postgres` (`postgres:17-alpine`, porta 5432, volume `postgres-data`, healthcheck `pg_isready`) no `docker-compose.yml`, ao lado do LGTM.
- **Acesso:** a API usa `pg` (node-postgres) com um `Pool` e SQL parametrizado (`$1..$n`), sem ORM nem query builder. Os repositórios `Postgres*` em `infrastructure` implementam as mesmas ports; domínio, casos de uso, handlers e contrato HTTP não mudam. Pool fixo: `max=10`, `connectionTimeoutMillis=5000`, `idleTimeoutMillis=30000`, `application_name=rondo-api`; é encerrado no desligamento.
- **Atomicidade:** as 6 funções SQL (`auth_sign_up`, `auth_issue_session`, `auth_confirm_account`, `auth_resend_confirmation`, `auth_request_password_reset`, `auth_reset_password`) continuam no banco e são chamadas por `select`. Travas, `on conflict` e consumo único de token ficam onde sempre estiveram.
- **Roles:** `rondo_migrator` (dono do schema, DDL, usuário do container) e `rondo_app` (DML nas tabelas, `execute` nas funções e `pg_monitor` para o Collector). Sem RLS, sem policies e sem `anon`/`authenticated`/`service_role`. `alter default privileges` dá DML ao `rondo_app` em tabelas futuras.
- **Variáveis:** `DATABASE_URL` (runtime, `rondo_app`) e `DATABASE_MIGRATOR_URL` (só migrations, `rondo_migrator`). A API não carrega credencial com DDL. `sslmode=require`/`verify-ca`/`verify-full` na URL liga TLS; ausente ou `disable` conecta sem TLS.
- **Migrations:** arquivos `.sql` em `db/migrations` e um runner próprio (`bun run db:migrate`): ordem lexicográfica, uma transação por arquivo, `schema_migrations(name, checksum, applied_at)`, recusa checksum divergente e `pg_advisory_lock` contra execuções simultâneas. Nenhuma CLI externa.
- **Erros:** violações de negócio (`23*`, `22*`) mantêm o erro de domínio; falha de conexão ou SQLSTATE inesperado vira `DataAccessError` com mensagem fixa (operação + SQLSTATE, sem valores) e `500 INTERNAL_ERROR`.
- **Credenciais locais:** `rondo`/`rondo` são públicas e valem só para o container local.

## Alternativas consideradas

| Alternativa                                         | Prós                                         | Contras                                                                        | Por que não                                                     |
| --------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Manter Supabase local (decisão do ADR 0008)         | Nada a migrar                                | CLI e ~10 containers, chaves e JWT de plataforma, PostgREST exposto sem uso    | Custo sem benefício: o produto só usa Postgres                  |
| Drizzle, Kysely ou Prisma                           | Tipos e query builder, migrations integradas | Dependência pesada, segunda fonte de verdade ao lado das funções SQL           | SQL puro é suficiente para 5 repositórios; fora do escopo       |
| CLI de migrations (`node-pg-migrate`, `dbmate`)     | Pronto, com rollback                         | Dependência e binário extra para o que são ~150 linhas de runner               | O runner do repositório cobre ordem, checksum, transação e lock |
| Mover a lógica das funções SQL para o TypeScript    | Regra num lugar só                           | Transação e travas passam para o app; reabre os testes de concorrência         | Quebra a atomicidade já validada                                |
| Um único role com DDL e DML                         | Menos configuração                           | A API ficaria com permissão de alterar o schema                                | Princípio do menor privilégio                                   |

## Consequências

- Positivas: um container de banco e nenhuma CLI; uma variável no runtime; sem chaves de plataforma; migrations e privilégios revisáveis no repositório; a API sem credencial de DDL; PostgREST deixa de existir.
- Negativas: a API gerencia o Pool (limites, timeouts, shutdown); a segurança agora depende de `grant`/`revoke` corretos em vez de RLS, coberta por teste de privilégios; dados do Supabase local são descartados (sem migração de dados); `infra:reset` é a forma de recriar o volume.
- Impacto: `bun run infra:up` + `bun run db:migrate` + `bun run dev`; integração e E2E semeiam e limpam por SQL com `DATABASE_URL`; `.env.example` só tem as duas URLs; `ARCHITECTURE.md` §3.1 e §4.6, `DEVELOPMENT.md` §5–§7 e `QA.md` descrevem o novo caminho. Abre perguntas para o Owner, fora do escopo local: TLS em Postgres gerenciado, PgBouncer/limites por ambiente e backup/PITR.
