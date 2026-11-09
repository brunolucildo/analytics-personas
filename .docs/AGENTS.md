# AGENTS.md — Guia operacional do repositório

> **Público:** agentes de código e pessoas que vão atuar no projeto.
> **Fonte de verdade:** este diretório (`.docs/`). O `README.md` da raiz é um resumo curto de entrada.
> **Verificado contra o código em:** 2026-11-07.

## 1. O que é o projeto

**Analytics Personas** é uma plataforma para criar, configurar e operar _experts_: agentes de IA especializados em funções de um clube de futebol (Head Coach, Analista de Desempenho, Jurídico Esportivo, Fisiologista etc.). Os experts consomem dados de conectores externos (Notion, Google Drive, PDF, Markdown, Confluence, Jira, Linear, ClickUp, Google Docs, Google Sheets) para produzir análises sob demanda.

**Estado atual:** fundação técnica pronta (spec `0000-foundation`). O monorepo Turborepo tem um cliente React + Vite (`apps/app`), uma API Nest.js (`apps/api`), o site de docs em Next.js (`apps/docs`) e o design system (`packages/ui`), com Supabase local, observabilidade Grafana LGTM e testes unitário, de integração e E2E. O espaço de URLs (`/api/v1/*`, `/auth/*`, `/app/*`) e o idioma en-US estão definidos em `DEVELOPMENT.md` §13 (spec `0001`). **Ainda não existem** features de produto, modelo de dados, autenticação, ingestão de conectores, agentes nem CI. Não trate a arquitetura-alvo como se já estivesse implementada.

## 2. Leia antes de trabalhar

| Se você vai...                              | Leia                             |
| ------------------------------------------- | -------------------------------- |
| entender o produto e o vocabulário          | `BUSINESS.md`                    |
| tocar em estrutura, apps, pacotes ou stack  | `ARCHITECTURE.md`                |
| criar ou alterar UI                         | `DESIGN.md` + `DESIGN_SYSTEM.md` |
| escrever qualquer código                    | `DEVELOPMENT.md`                 |
| criar rota, endpoint ou texto de interface  | `DEVELOPMENT.md` §13             |
| validar uma entrega                         | `QA.md`                          |
| iniciar uma tarefa ou finalizar uma entrega | `RULES.md`                       |

## 3. Comandos reais

Execute na raiz. Requer **Bun 1.4.4** e **Node.js >= 24**. Docker e `.env` só são necessários para `infra:*`, `db:migrate` e para rodar a API de verdade (detalhes em `QA.md` §2).

| Objetivo                        | Comando                                      |
| ------------------------------- | -------------------------------------------- |
| instalar dependências           | `bun install`                                |
| subir todos os apps             | `bun run dev`                                |
| subir um app                    | `bun run dev --filter=app` / `api` / `docs`  |
| lint (OXLint)                   | `bun run lint`                               |
| formatar (OXFmt)                | `bun run format`                             |
| corrigir lint e formatar        | `bun run code:fix`                           |
| checar tipos                    | `bun run check-types` (alias: `types:check`) |
| build de produção               | `bun run build`                              |
| testes unitários                | `bun run test`                               |
| testes de integração            | `bun run test:integration`                   |
| testes E2E (sobe o app sozinho) | `bun run test:e2e`                           |
| cobertura                       | `bun run test:coverage`                      |
| subir / derrubar infra local    | `bun run infra:up` / `bun run infra:down`    |
| aplicar migrations locais       | `bun run db:migrate`                         |
| instalar hooks (requer git)     | `bun run hooks:install`                      |

Portas: `apps/app` → **5173**; `apps/docs` → **3001**; `apps/api` → **3002**; Grafana → **3000**. Lista completa em `ARCHITECTURE.md` §2.1.

**Não existem** (não invente): `bun codes:fix`, `bun run web`, scripts de ESLint ou Prettier. A primeira execução do E2E exige `bunx playwright install`.

**Baseline em 2026-11-07:** lint, tipos, build, testes (unitário, integração e E2E), `infra:up`, `db:migrate` e `infra:down` passam. Detalhes e evidências em `QA.md` §1.1.

## 4. Regras não negociáveis

1. **Não invente comandos, scripts, dependências ou skills.** Confira `package.json` e o catálogo de skills antes de afirmar que algo existe.
2. **Não afirme que executou** lint, tipos, testes ou build sem ter executado e visto o resultado.
3. **UI:** siga `DESIGN.md` e `DESIGN_SYSTEM.md`; garanta acessibilidade, foco visível e responsividade (mobile → desktop).
4. **Toda tarefa de desenvolvimento** tem plano em `./.plans/`; decisões estruturais também geram ADR em `./.adrs/` (ver `RULES.md`). Tarefas triviais usam plano curto, mas não pulam o registro.
5. **Não altere** `turbo.json` nem comandos do Turborepo sem ler os docs da versão instalada (`node_modules/turbo/docs/README.md`) e respeitar o bloco gerenciado do `AGENTS.md` da raiz.
6. **Segredos** nunca entram no repositório. Só variáveis `VITE_*` vão para o bundle do browser e são públicas; `SUPABASE_SERVICE_ROLE_KEY` fica só no servidor.
7. **Se o código divergir destes docs, o código vence.** Atualize o `.docs` na mesma mudança.
8. **Não edite artefatos gerados** (`.next/`, `.turbo/`, `dist/`, `coverage/`, `node_modules/`) nem o bloco `turborepo-agent-rules` do `AGENTS.md` da raiz.

## 5. Skills

Consulte o catálogo disponível antes de começar. O projeto tem seis skills próprias que definem o fluxo de trabalho:

| Skill             | Quando usar                                                         | O que produz                                       |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------- |
| `breakdown-specs` | prompt grande que junta várias capacidades (auth, CRUD, conectores) | mapa em `.plans/<epic>-breakdown.md` + N specs     |
| `create-spec`     | prompt, ideia ou ticket que precisa virar spec                      | `.specs/<slug>.md` executável                      |
| `refine-spec`     | spec existente vaga, incompleta ou contraditória                    | a mesma spec refinada + histórico de mudanças      |
| `feature-concept` | ideia que exige interrogatório profundo **e** plano de execução     | `.specs/<slug>.md` + `.plans/<slug>-plan.md`       |
| `implement-me`    | spec/plano pronto para virar código (`implement-me <slug>`)         | implementação + QA + ADR + commit/push + relatório |
| `commit-and-push` | fim de cada spec (chamada pelo `implement-me`) ou pedido do usuário | commit Conventional Commits com co-author + push   |

Fluxo padrão: `create-spec` (ou `feature-concept`) → `refine-spec` quando precisar de auditoria → `implement-me <slug>`, que **termina sempre com `commit-and-push`**. Use `create-spec` quando o objetivo for apenas a spec; use `feature-concept` quando também for necessário planejar a implementação. Quando o pedido junta mais de uma capacidade (ex.: sign-in, sign-up, confirm-account e forgot-password; ou um CRUD completo), comece por `breakdown-specs`: ela quebra o pedido em várias specs pequenas, cria cada uma com `create-spec` e entrega o mapa de ordem e dependências; depois rode `implement-me` em cada spec, uma por vez.

`commit-and-push` analisa todas as mudanças pendentes, escreve a mensagem em Conventional Commits (descrição em pt-BR; `type` e `scope` em inglês), adiciona `Co-Authored-By: Claude Code <noreply@anthropic.com>`, faz `git add -A`, commita e dá push. Só roda a pedido do usuário ou no último passo do `implement-me`; nunca faz force push, `--amend`, `--no-verify` nem `git init`. Sem `.git` ela para e registra a pendência. **Destino fixo:** o push só vai para `https://github.com/brunolucildo/<repositorio>` via `origin`; qualquer outra URL a faz parar, e sem `origin` o commit fica local e o push vira pendência. Identidade dos commits: configurada só neste repositório (`.git/config`) como `Bruno Lucildo da Silva <49033432+brunolucildo@users.noreply.github.com>`; a skill não altera `user.name`/`user.email`. Estado atual: `main` publicada em `origin` = `https://github.com/brunolucildo/analytics-personas.git` (commit raiz `227e0ad`), com hooks do lefthook instalados neste clone. O push exige login do Git Credential Manager na conta `brunolucildo`; em outro clone, rode `bun run hooks:install`.

**Onde as skills ficam:** `.claude/skills/<nome>/SKILL.md`, carregadas pelo Claude Code (invocação por `/<nome>`; a lista é lida ao iniciar a sessão). Esse é o único local; a antiga pasta `.agents/skills/` (convenção do OpenCode) foi removida. As skills de terceiros estão registradas em `skills-lock.json`, e `.claude/skills/` é ignorada pelo OXLint e pelo OXFmt para não reescrever código de terceiros.

Outras skills de referência:

- `frontend-design` e `web-design-guidelines` — obrigatórias para UI **se estiverem instaladas**.
- `next-best-practices` vale para `apps/docs` (único app Next.js); `vercel-react-best-practices`, `shadcn`, `tdd`, `playwright` e `supabase-postgres-best-practices` valem conforme o contexto.

Se uma skill de terceiro esperada não estiver disponível, **não bloqueie a tarefa**: siga os documentos deste diretório e registre a ausência no relatório final. As skills do projeto vivem em `.claude/skills/`; ao alterá-las, mantenha este guia e `RULES.md` coerentes.

## 6. Mapa deste diretório

- `BUSINESS.md` — problema, proposta de valor, conceitos, conectores, escopo e decisões abertas.
- `ARCHITECTURE.md` — estado atual, stack, portas, limites, estrutura-alvo e dívidas.
- `DESIGN.md` — direção visual, paleta, tipografia, motivos, movimento e acessibilidade.
- `DESIGN_SYSTEM.md` — shadcn/Tailwind, tokens, contrato de componentes e regras de UI.
- `DEVELOPMENT.md` — princípios, camadas, vertical slices, padrões de código e definição de pronto.
- `QA.md` — gates, baseline, checklist manual e evidências.
- `RULES.md` — fluxo obrigatório, templates de plano/ADR/relatório e limites de atuação.

## 7. Estrutura do repositório

```text
apps/app                    # cliente de produto (React + Vite) — porta 5173
apps/api                    # API (Nest.js) — porta 3002
apps/docs                   # site de documentação (Next.js 16) — porta 3001
packages/ui                 # design system compartilhado (@repo/ui)
packages/typescript-config  # tsconfig base compartilhado
supabase/                   # Supabase local (config.toml, migrations/)
infra/                      # configs de Grafana, Loki, Tempo, Mimir e OTel Collector
scripts/                    # infra:up, infra:down, db:migrate (Bun)
e2e/                        # testes Playwright
.claude/skills/             # skills carregadas pelo Claude Code
.docs/                      # documentação canônica do projeto
.specs/                     # specs executáveis (_template.md + <slug>.md)
.plans/                     # planos de implementação (<slug>-plan.md)
.adrs/                      # Architecture Decision Records (0001 a 0004)
```

`apps/docs` (site Next.js) **não é** o mesmo que `.docs/` (Markdown canônico).
