# Rondo

Plataforma para criar e operar _experts_: agentes de IA especializados em funções de um clube de futebol, alimentados por fontes de dados conectadas e com respostas rastreáveis às fontes.

> Estado: fundação técnica pronta. Features de produto ainda não existem. A documentação canônica está em [`.docs/`](.docs/AGENTS.md).

## Estrutura

| Caminho                      | O que é                                             | Porta       |
| ---------------------------- | --------------------------------------------------- | ----------- |
| `apps/app`                   | Cliente de produto (React + Vite)                   | 5173        |
| `apps/api`                   | API (Nest.js)                                       | 3002        |
| `apps/docs`                  | Site de documentação (Next.js)                      | 3001        |
| `packages/ui`                | Design system (`@repo/ui`: Tailwind + shadcn)       | —           |
| `packages/typescript-config` | tsconfigs compartilhados                            | —           |
| `db/`                        | Migrations SQL e roles do Postgres local            | 5432        |
| `infra/`                     | Grafana LGTM (Loki, Tempo, Mimir) e OTel Collector  | 3000        |

## Começando

Requer Bun 1.4.4, Node.js >= 24 e Docker em execução (para a infra local).

```bash
bun install
cp .env.example .env     # DATABASE_URL e DATABASE_MIGRATOR_URL já apontam para o Postgres local
bun run infra:up         # Postgres + Grafana LGTM
bun run db:migrate       # aplica db/migrations (idempotente)
bun run dev
```

## Comandos

| Comando                                          | O que faz                               |
| ------------------------------------------------ | --------------------------------------- |
| `bun run dev [--filter=app\|api\|docs]`          | Sobe os apps em modo de desenvolvimento |
| `bun run lint` / `format` / `code:fix`           | OXLint, OXFmt e correção automática     |
| `bun run check-types`                            | `tsc --noEmit` em todos os workspaces   |
| `bun run build`                                  | Build de produção                       |
| `bun run test` / `test:integration` / `test:e2e` | Vitest, Supertest e Playwright          |
| `bun run infra:up` / `infra:down`                | Postgres local + Grafana LGTM           |
| `bun run infra:reset`                            | Apaga o volume do Postgres e sobe de novo |
| `bun run db:migrate`                             | Aplica as migrations de `db/migrations` |

Na primeira execução do E2E, rode `bunx playwright install`. Gates, checklist e baseline completos estão em [`.docs/QA.md`](.docs/QA.md).

## Documentação

Leia [`.docs/AGENTS.md`](.docs/AGENTS.md) primeiro. Specs em `.specs/`, planos em `.plans/` e decisões de arquitetura em `.adrs/`.
