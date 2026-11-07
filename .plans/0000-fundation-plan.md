# Plano — 0000 Fundação

- **Status:** concluída (todos os itens de "Critério de pronto" atendidos; commit `227e0ad`)
- **Slug:** 0000-foundation
- **Spec:** `.specs/0000-fundation.md`
- **Data:** 2026-11-06
- **Atualizado em:** 2026-11-07

## Contexto

O repositório é um bootstrap do `create-turbo`: `apps/web` e `apps/docs` em Next.js, `packages/ui` com stubs, ESLint + Prettier e lint quebrado no baseline. Não há API, banco, testes, observabilidade, `.env.example` nem ADRs. A spec `0000-foundation` fecha a estrutura-alvo e os gates antes de qualquer feature de produto.

## Objetivo

Entregar um monorepo instalável e verificável com `apps/app` (React + Vite), `apps/api` (Nest.js), `apps/docs` (Next.js), `@repo/ui` (Tailwind + shadcn), infraestrutura local (Supabase + Grafana LGTM), OXLint/OXFmt, testes Vitest/Supertest/Playwright, observabilidade OTel e documentação/ADRs atualizados.

## Não-objetivos

- Features de produto (experts, personas, demandas, conectores, ingestão, LLM, busca).
- Tabelas de domínio, RLS, migrations de produto.
- Login, sessão, upload ou storage.
- CI/CD, Vercel, Supabase remoto.
- Roteador ou telas adicionais em `apps/app`.
- Refatoração fora do necessário para a fundação.

## Usuários e permissões

Nesta fase não há usuário, clube ou dado pessoal. `GET /` é público e sem persistência. Nenhuma credencial de produção é usada; service role fica restrita ao servidor.

## Fluxos e estados

- **Feliz:** clone → `bun install` → `infra:up` → `db:migrate` → `dev` (app 5173, docs 3001, API 3002, Grafana 3000) → gates verdes.
- **Vazio:** sem migrations, `db:migrate` informa e sai 0; app sem chamadas de rede.
- **Carregando:** `infra:up` aguarda healthchecks (até 300s).
- **Erro:** Docker/Supabase/porta/env ausente falham com mensagem acionável; API não inicia sem env obrigatória.
- **Parcial:** se Supabase sobe e LGTM falha, `infra:up` sai 1 e preserva o que subiu.
- **Retry:** `infra:down`, `infra:up` e `db:migrate` são idempotentes.

## Requisitos

Os requisitos R1–R23 e critérios de aceite são os da spec `.specs/0000-fundation.md`; este plano os executa sem alterar intenção.

## Contratos de dados

Nenhuma entidade de domínio. `.env.example` documenta as variáveis; `.env` é ignorado. Segredos `SUPABASE_SERVICE_ROLE_KEY` só no servidor.

## Integrações

| Integração     | Configuração                                       | Falha                                                |
| -------------- | -------------------------------------------------- | ---------------------------------------------------- |
| Supabase local | `supabase/config.toml`, `supabase start`           | `infra:up` explica Docker/CLI ausente e sai != 0     |
| Grafana LGTM   | `docker-compose.yml` + `infra/**`                  | `--wait` com timeout; serviço que falhou é informado |
| OTel Collector | OTLP HTTP `localhost:4318`                         | Exportação em batch/timeout; `GET /` continua 200    |
| API ↔ cliente  | `VITE_API_URL` (declarada, sem chamada nesta fase) | Nenhuma chamada nesta fundação                       |

## Decisões e premissas

- Decisão: `apps/app` em Vite substitui `apps/web` (ADR 0001).
- Decisão: OXLint + OXFmt substituem ESLint + Prettier (ADR 0002).
- Decisão: `apps/docs` permanece Next.js, com página mínima.
- Decisão: Tailwind v4 CSS-first, tokens de `DESIGN.md` em `packages/ui/src/styles.css`; sem dark mode.
- Decisão: Nest com `@nestjs/cli` para build/watch e ConfigModule com validação manual de env.
- Premissa: versões estáveis compatíveis, travadas no `bun.lock`.
- Premissa: hooks de git não são testáveis neste diretório (sem `.git`); configuração entra e limitação é registrada.
- Premissa: Supabase CLI é instalada como devDependency (`supabase`) e executada via `bunx`.

## Abordagem

1. Reestruturar workspaces: criar `apps/app` e `apps/api`; remover `apps/web` e `packages/eslint-config`.
2. Substituir tooling por OXLint/OXFmt + lefthook/lint-staged; scripts da raiz e tasks do Turbo.
3. Configurar `packages/ui` com Tailwind/shadcn e `Button` real.
4. Instalar stack de dados no `apps/app` (Query/Table/Charts/date-fns/Supabase).
5. Configurar Vitest + Supertest + Playwright + cobertura.
6. Provisionar Supabase local, `docker-compose.yml`, provisioning Grafana e scripts `infra:*`/`db:migrate`.
7. Instrumentar a API com OTel, logger JSON e `requestId`.
8. Ajustar `apps/docs` para página mínima.
9. Atualizar `.docs`, criar ADRs 0001/0002 e executar gates.

## Arquivos previstos

- `package.json`, `turbo.json`, `.gitignore`, `.env.example`
- `apps/app/**`, `apps/api/**`, `apps/docs/**`
- `packages/ui/**`, `packages/typescript-config/**`
- `scripts/**`, `docker-compose.yml`, `infra/**`, `supabase/**`
- `e2e/**`, `playwright.config.ts`
- `.docs/**`, `.adrs/0001-*.md`, `.adrs/0002-*.md`, este plano

## Testes

- Unitário: Vitest em `apps/app` (render do `h1`) e `apps/api` (controller).
- Integração: Supertest em `apps/api` para `GET /`.
- E2E: Playwright abrindo `http://localhost:5173` e verificando `h1`.
- Manual: 375/768/1280, teclado/foco, console/network, contraste, infra e Grafana.

## Riscos e rollback

- Docker/Supabase CLI/browsers podem faltar: falha rápida e documentada; gates de código seguem independentes.
- Tailwind v4 em monorepo: `@source` explícito para `packages/ui`; validar build.
- OTel bloqueante: exportadores em batch com timeout; nunca aguardar export no request.
- Rollback: reverter os arquivos desta mudança; `apps/web` e `packages/eslint-config` são removidos conforme spec (decisão confirmada).

## Critério de pronto

- [x] R1–R20, R22 e R23 atendidos e verificados (evidências em `.docs/QA.md` §1.1).
- [x] R21 (hooks de pre-commit): `bun run hooks:install` executado e o pre-commit comprovado no commit raiz. A primeira tentativa foi barrada pelo `lint-staged` (lote só com arquivos ignorados pelo OXFmt); corrigido com `--no-error-on-unmatched-pattern` e o commit `227e0ad` passou pelos hooks.
- [x] `bun run lint`, `check-types`, `build`, `test`, `test:integration` passam.
- [x] `bun run test:e2e` passa (browsers do Playwright já instalados nesta máquina).
- [x] `infra:up`, `db:migrate`, `infra:down` executados (2× no `down`), com evidência.
- [x] `.docs` e ADRs atualizados; nenhum resquício de `apps/web`, ESLint ou Prettier fora dos ADRs e do histórico das specs.
- [x] Verificação manual de `.docs/QA.md` §5 executada para 375/768/1280, teclado, foco, contraste calculado, console e rede (evidência em `QA.md` §1.2). Não verificados: leitor de tela, hover/disabled/loading e `prefers-reduced-motion`.
- [x] Relatório final no formato de `.docs/RULES.md`.

## Reconciliação (2026-11-07)

O trabalho anterior (OpenCode) já havia entregue a maior parte do código. Esta execução mediu o baseline real e fechou o que faltava. Decisões do plano preservadas; mudanças e motivos:

| Mudança                                                                 | Motivo                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `.oxlintrc.json` e `.oxfmtrc.json` com `ignorePatterns`                 | Formatador varria 251 arquivos, incluindo skills de terceiros; escopo caiu para 81 (R4, R5) |
| `scripts/db-migrate.ts` chama sempre `supabase migration up --local`    | Antes pulava a CLI sem `.sql`; R13 pede a CLI com saída 0                                   |
| `[analytics]` desligado em `supabase/config.toml`                       | `vector` em loop no Windows (exige Docker em `tcp:2375`); logs vão para o LGTM (R13, R14)   |
| Log HTTP só com id, método, path e status; SDK OTel sem detectores      | Headers, IP, query e caminho local com usuário do SO iam para o Loki/Tempo (R15 "sem PII")  |
| Assets e README demo removidos de `apps/docs`; README da raiz reescrito | R18                                                                                         |
| `.docs/**` atualizados; ADRs 0001 e 0002 criados                        | R19, R20                                                                                    |
| Spec e plano renomeados para `0000-fundation*` (pelo solicitante)       | O campo `Slug` interno continua `0000-foundation`; nomes de arquivo mantidos como estão     |

## Perguntas abertas

| Pergunta                                            | Impacto | Bloqueante? | Quem decide        |
| --------------------------------------------------- | ------- | ----------- | ------------------ |
| Nenhuma bloqueante; premissas da spec §11 mantidas. | —       | Não         | Time de engenharia |
