# Rondo

Plataforma para criar e operar _experts_: agentes de IA especializados em funções de um clube de futebol, alimentados por fontes de dados conectadas e com respostas rastreáveis às fontes.

> Estado: fundação técnica pronta. Features de produto ainda não existem. A documentação canônica está em [`.docs/`](.docs/AGENTS.md).

## Estrutura

| Caminho                      | O que é                                            | Porta        |
| ---------------------------- | -------------------------------------------------- | ------------ |
| `apps/app`                   | Cliente de produto (React + Vite)                  | 5173         |
| `apps/api`                   | API (Nest.js)                                      | 3002         |
| `apps/docs`                  | Site de documentação (Next.js)                     | 3001         |
| `packages/ui`                | Design system (`@repo/ui`: Tailwind + shadcn)      | —            |
| `packages/typescript-config` | tsconfigs compartilhados                           | —            |
| `supabase/`, `infra/`        | Supabase local e Grafana LGTM (Loki, Tempo, Mimir) | 54321 / 3000 |

## Começando

Requer Bun 1.4.4, Node.js >= 24 e Docker em execução (para a infra local).

```bash
bun install
cp .env.example .env     # preencha as chaves com `bunx supabase status -o env`
bun run infra:up
bun run db:migrate
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
| `bun run infra:up` / `infra:down`                | Supabase local + Grafana LGTM           |

Na primeira execução do E2E, rode `bunx playwright install`. Gates, checklist e baseline completos estão em [`.docs/QA.md`](.docs/QA.md).

## Documentação

Leia [`.docs/AGENTS.md`](.docs/AGENTS.md) primeiro. Specs em `.specs/`, planos em `.plans/` e decisões de arquitetura em `.adrs/`.
