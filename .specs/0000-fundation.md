# 0000 — Fundação

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** concluída (R1–R23 atendidos; commit `227e0ad` enviado a `main`)
- **Slug:** 0000-foundation
- **Data:** 2026-11-05
- **Atualizado em:** 2026-11-07
- **Owner:** Time de engenharia
- **Relacionados:** `.docs/ARCHITECTURE.md`, `.docs/DEVELOPMENT.md`, `.docs/QA.md`, `.docs/BUSINESS.md`, ADRs 0001 e 0002 (criados por esta spec)

## 1. Escopo

### Dentro do escopo

- Criar `apps/api` em Nest.js com endpoint HTTP mínimo.
- Criar `apps/app` em React + Vite + TypeScript e **remover `apps/web`** (Next.js), conforme decisão registrada.
- Manter `apps/docs` (Next.js) funcionando, sem conteúdo de demonstração.
- Configurar TailwindCSS e shadcn/ui em `packages/ui`, com `Button` compartilhado.
- Instalar e configurar o stack-alvo descrito em `.docs/ARCHITECTURE.md` §3.2:
  - TanStack Query, TanStack Table e TanStack Charts.
  - `date-fns`.
  - SDK do Supabase (`@supabase/supabase-js`), incluindo acesso a Auth, Storage e banco; somente instalação e configuração, sem fluxos.
  - Nest.js com configuração, validação e logger estruturado.
  - Vitest, Supertest e Playwright.
  - OpenTelemetry para traces, métricas e logs.
- Substituir ESLint + Prettier por OXLint + OXFmt, incluindo `lefthook` e `lint-staged`.
- Criar infraestrutura local:
  - Supabase local via Supabase CLI (`supabase start`).
  - Grafana LGTM (Grafana, Loki, Tempo, Mimir) e OpenTelemetry Collector via `docker-compose.yml`.
  - Scripts `infra:up`, `infra:down` e `db:migrate`.
- Criar `.env.example`, ajustar `.gitignore` e documentar variáveis.
- Configurar scripts, tasks do Turborepo, testes e gates de qualidade.
- Atualizar `.docs/` e criar os ADRs das decisões estruturais.

### Fora do escopo

- Implementar features de produto: experts, personas, demandas, entregas, conectores, ingestão, LLM e busca.
- Criar modelo de domínio, tabelas de negócio, RLS ou migrations de produto.
- Implementar fluxos de autenticação, autorização, sessão, upload ou storage.
- Integrar com Supabase remoto, Vercel, CI/CD ou qualquer ambiente de produção.
- Criar roteador no `apps/app`; esta fundação entrega apenas a rota `/`.
- Criar dashboards de produto no Grafana; apenas datasources, health e um dashboard mínimo de infraestrutura.
- Internacionalização, aplicativo mobile nativo, faturamento e análise em tempo real.
- Refatorar código fora do necessário para cumprir esta spec.
- Inicializar repositório git ou alterar o bloco `turborepo-agent-rules` do `AGENTS.md` da raiz.

## 2. Contexto

O repositório é hoje um bootstrap do Turborepo com dois apps Next.js (`apps/web` e `apps/docs`), páginas de demonstração, `packages/ui` com componentes stub e nenhuma API, banco, teste ou CI. O lint falha no baseline por causa do preset Babel não resolvido em `packages/ui`.

A decisão desta fundação é substituir o cliente Next.js (`apps/web`) por um app React + Vite (`apps/app`), manter o site de documentação em Next.js e criar a API Nest.js. O objetivo é ter uma base executável, com infraestrutura local, gates e observabilidade, antes de iniciar qualquer feature de produto.

## 3. Necessidade de negócio

| Item                     | Descrição                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Usuário/papel afetado    | Time de engenharia e produto que vai construir e validar as primeiras features.                   |
| Decisão ou ação que muda | Padronizar cliente, API, banco local, tooling, testes e observabilidade em uma base única.        |
| Resultado esperado       | Monorepo instalável, executável e validável, sem scaffold de demonstração nem dívida de baseline. |
| Métrica de sucesso       | `bun install`, `lint`, `check-types`, `build`, `test` e `infra:up` passam em um clone limpo.      |

## 4. Requisitos

| ID  | Requisito                                                                                                         | Prioridade | Critério de aceite                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Reestruturar os workspaces: criar `apps/app` (Vite) e `apps/api` (Nest), remover `apps/web` e manter `apps/docs`. | Must       | Given repositório atualizado, When `bun install` e `bun pm ls`, Then `app`, `api`, `docs`, `@repo/ui` e `@repo/typescript-config` estão linkados, `apps/app` usa Vite e `apps/docs` continua Next.js.                                                                                                                                                                              |
| R2  | Expor `GET /` na API com resposta JSON de hello world.                                                            | Must       | Given `bun run dev --filter=api`, When `GET http://localhost:3002/`, Then retorna 200, `content-type: application/json` e body exatamente `{"message":"Hello World"}`.                                                                                                                                                                                                             |
| R3  | Expor `/` no app com um único título de hello world.                                                              | Must       | Given `bun run dev --filter=app`, When abrir `http://localhost:5173/`, Then existe exatamente um `h1` com o texto `Hello World`, sem erro no console e sem chamada de rede falhando.                                                                                                                                                                                               |
| R4  | Migrar o lint de ESLint para OXLint em todos os workspaces.                                                       | Must       | Given dependências instaladas, When `bun run lint`, Then OXLint roda nos workspaces aplicáveis, sai com código 0 e não há `eslint`, `prettier` ou `@repo/eslint-config` em `package.json` ou arquivos de configuração.                                                                                                                                                             |
| R5  | Migrar a formatação de Prettier para OXFmt e expor `code:fix`.                                                    | Must       | Given um arquivo `.ts` fora do padrão, When `bun run format`, Then o OXFmt reescreve o arquivo e uma segunda execução não gera diff; When `bun run code:fix`, Then OXLint `--fix` e OXFmt rodam e saem com código 0.                                                                                                                                                               |
| R6  | Garantir checagem de tipos por comando canônico e alias.                                                          | Must       | Given dependências instaladas, When `bun run check-types` ou `bun run types:check`, Then `tsc --noEmit` roda em `app`, `docs`, `api` e `@repo/ui` e sai com código 0.                                                                                                                                                                                                              |
| R7  | Garantir build de produção dos três apps.                                                                         | Must       | Given dependências instaladas, When `bun run build`, Then `apps/app/dist`, `apps/docs/.next` e `apps/api/dist` são gerados e o comando sai com código 0.                                                                                                                                                                                                                           |
| R8  | Configurar testes unitários com Vitest.                                                                           | Must       | Given `bun run test`, Then Vitest executa pelo menos 1 teste em `apps/app` e 1 em `apps/api`, sem modo watch, e sai com código 0.                                                                                                                                                                                                                                                  |
| R9  | Configurar teste de integração da API com Supertest.                                                              | Must       | Given `bun run test:integration`, Then Supertest valida `GET /` com status 200, body JSON esperado e sai com código 0.                                                                                                                                                                                                                                                             |
| R10 | Configurar teste E2E com Playwright.                                                                              | Must       | Given `bunx playwright install` executado, When `bun run test:e2e`, Then o teste abre `http://localhost:5173`, encontra o `h1` `Hello World` e sai com código 0; o comando sobe o app automaticamente.                                                                                                                                                                             |
| R11 | Configurar TailwindCSS e shadcn/ui em `packages/ui`.                                                              | Must       | Given `packages/ui`, When `components.json` e os tokens Tailwind são usados, Then `@repo/ui/button` renderiza um botão estilizado e `bun run build`/`check-types` passam; não restam componentes demo com `alert` ou UTM, e o `Button` não exige mais `appName`.                                                                                                                   |
| R12 | Instalar e configurar as bibliotecas de dados do cliente.                                                         | Must       | Given `apps/app/package.json`, When inspecionar, Then `@tanstack/react-query`, `@tanstack/react-table`, `@tanstack/charts` (adapter `@tanstack/charts/react`) e `date-fns` estão declarados; o `QueryClientProvider` envolve a árvore e `bun run build` passa.                                                                                                                     |
| R13 | Subir Supabase local e aplicar migrations.                                                                        | Must       | Given Docker e Supabase CLI instalados, When `bun run infra:up`, Then `supabase start` sobe e `supabase status` mostra a API em `54321`; When `bun run db:migrate`, Then `supabase migration up --local` sai com 0 e informa quando não há migrations pendentes.                                                                                                                   |
| R14 | Subir Grafana LGTM via `docker-compose.yml` e comandar a infra.                                                   | Must       | Given Docker, When `bun run infra:up`, Then `docker compose ps` mostra `grafana`, `loki`, `tempo`, `mimir` e `otel-collector` saudáveis e `GET http://localhost:3000/api/health` retorna 200; When `bun run infra:down` duas vezes, Then ambos saem com 0 e nenhum container do projeto fica rodando.                                                                              |
| R15 | Instrumentar a API com OpenTelemetry e logs estruturados.                                                         | Must       | Given infra up e API rodando, When `GET /`, Then o collector recebe um span da rota e um log JSON com `requestId`, sem PII; When o collector está parado, Then `GET /` continua retornando 200.                                                                                                                                                                                    |
| R16 | Documentar e proteger variáveis de ambiente e segredos.                                                           | Must       | Given `.env.example`, When inspecionar, Then contém `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `API_PORT`, `VITE_API_URL` e `OTEL_EXPORTER_OTLP_ENDPOINT`; `.env` está no `.gitignore`; `SERVICE_ROLE` não aparece em `apps/app/dist`; a API falha rápido com mensagem clara se variável obrigatória faltar. |
| R17 | Padronizar scripts da raiz e tasks do Turborepo.                                                                  | Must       | Given `package.json` da raiz, When listar scripts, Then existem `lint`, `format`, `code:fix`, `check-types`, `types:check`, `dev`, `build`, `test`, `test:integration`, `test:e2e`, `test:coverage`, `infra:up`, `infra:down` e `db:migrate`; `turbo.json` declara as tasks de teste com dependências e outputs.                                                                   |
| R18 | Remover scaffold e dependências obsoletas.                                                                        | Must       | Given repositório, When inspecionar, Then `apps/web` e `packages/eslint-config` não existem; `apps/docs` builda com página mínima sem conteúdo demo; não há ESLint, Prettier ou configurações equivalentes em `package.json`/arquivos de config.                                                                                                                                   |
| R19 | Atualizar a documentação canônica.                                                                                | Must       | Given `.docs/`, When revisar, Then `ARCHITECTURE.md`, `DEVELOPMENT.md`, `QA.md`, `AGENTS.md` e `DESIGN_SYSTEM.md` descrevem `apps/app` Vite, `apps/api`, portas, comandos e tooling OXLint/OXFmt; não há referência vigente a `apps/web`, ESLint ou Prettier.                                                                                                                      |
| R20 | Registrar as decisões estruturais em ADRs.                                                                        | Must       | Given `.adrs/`, When listar, Then existem ADRs aceitos para a substituição do cliente Next.js por Vite e para a migração ESLint/Prettier para OXLint/OXFmt.                                                                                                                                                                                                                        |
| R21 | Configurar hooks de pre-commit.                                                                                   | Should     | Given um clone git, When `bunx lefthook install` e um commit de arquivo fora do padrão, Then o pre-commit executa `lint-staged` com OXLint `--fix` e OXFmt.                                                                                                                                                                                                                        |
| R22 | Expor cobertura de testes.                                                                                        | Should     | Given `bun run test:coverage`, Then Vitest executa com cobertura, gera `coverage/` e sai com código 0, sem exigir threshold nesta fase.                                                                                                                                                                                                                                            |
| R23 | Provisionar datasources e um dashboard mínimo no Grafana.                                                         | Could      | Given Grafana em `http://localhost:3000`, When abrir, Then os datasources Loki, Tempo e Mimir estão provisionados e um dashboard mínimo da API está disponível.                                                                                                                                                                                                                    |

## 5. Fluxos e estados

- **Caminho feliz:** clone limpo → `bun install` → `bun run infra:up` → `bun run db:migrate` → `bun run dev` → app em `5173`, docs em `3001`, API em `3002`, Grafana em `3000` → `bun run lint`, `check-types`, `build`, `test`, `test:integration` e `test:e2e` passam.
- **Vazio:** sem migrations pendentes, `db:migrate` informa que não há nada a aplicar e sai com 0; sem chamadas de API, o app renderiza apenas o hello world e não quebra.
- **Carregando:** `infra:up` aguarda os healthchecks de Supabase e dos containers LGTM por até 300 segundos; enquanto isso, exibe progresso e não retorna sucesso antes de os serviços estarem saudáveis.
- **Erro:** Docker desligado, porta ocupada, Supabase não inicializado ou variável de ambiente ausente produzem mensagem acionável e código de saída diferente de zero; a API não inicia sem as variáveis obrigatórias.
- **Sucesso parcial:** se o Supabase subir e o LGTM falhar, `infra:up` sai com erro, informa qual serviço falhou e mantém o que subiu; os gates de lint, tipos, build e testes continuam executáveis sem a infra.
- **Cancelamento/retry:** `infra:down` é idempotente e pode ser executado duas vezes; `infra:up` pode ser repetido após falha sem duplicar containers; `db:migrate` também é idempotente.
- **Permissões e dados:** não se aplicam nesta fase. Não há usuário, clube, dado pessoal, endpoint protegido ou isolamento multi-tenant. O endpoint `GET /` é público e sem persistência.

## 6. Acceptance Criteria

- [ ] Given o repositório atualizado, When `bun install` e `bun pm ls`, Then os workspaces `app`, `api`, `docs` e `@repo/ui` estão presentes, `apps/web` não existe e `apps/docs` continua em Next.js. (R1, R18)
- [ ] Given a API rodando na porta 3002, When `GET /`, Then a resposta é 200, `application/json` e `{"message":"Hello World"}`. (R2, R9)
- [ ] Given o app rodando na porta 5173, When abrir `/`, Then há um único `h1` `Hello World`, sem erro no console. (R3, R10)
- [ ] Given dependências instaladas, When `bun run lint`, Then OXLint passa sem erros ou warnings e não há ESLint/Prettier. (R4)
- [ ] Given um arquivo fora do padrão, When `bun run format` e depois `bun run code:fix`, Then o arquivo é formatado e ambos os comandos saem com 0. (R5)
- [ ] Given dependências instaladas, When `bun run check-types` ou `bun run types:check`, Then todos os workspaces passam. (R6)
- [ ] Given dependências instaladas, When `bun run build`, Then app, docs e API geram artefatos e o comando sai com 0. (R7)
- [ ] Given `bun run test`, `bun run test:integration` e `bun run test:e2e`, Then Vitest, Supertest e Playwright executam ao menos um teste cada e saem com 0. (R8, R9, R10)
- [ ] Given `packages/ui`, When `components.json` e Tailwind são usados, Then o `Button` compartilhado renderiza sem componentes demo e o build passa. (R11)
- [ ] Given `apps/app`, When inspecionar dependências e providers, Then TanStack Query/Table/Charts e date-fns estão configurados e o build passa. (R12)
- [ ] Given Docker e Supabase CLI, When `bun run infra:up` e `bun run db:migrate`, Then Supabase responde em 54321 e não há migrations pendentes. (R13)
- [ ] Given Docker, When `bun run infra:up`, Then Grafana responde em `http://localhost:3000/api/health` e os containers LGTM estão saudáveis; When `bun run infra:down`, Then tudo para. (R14)
- [ ] Given infra up e API rodando, When `GET /`, Then há trace e log JSON com `requestId`; com o collector parado, `GET /` continua 200. (R15)
- [ ] Given `.env.example`, When inspecionar, Then as variáveis estão documentadas, `.env` é ignorado e segredo de service role não aparece no bundle do app. (R16)
- [ ] Given `package.json` e `turbo.json`, When inspecionar, Then todos os scripts e tasks obrigatórios existem e executam. (R17)
- [ ] Given `.docs/` e `.adrs/`, When revisar, Then a documentação reflete a nova estrutura e os dois ADRs estão registrados. (R19, R20)
- [ ] Given um clone git, When configurar `lefthook` e commitar arquivo fora do padrão, Then o pre-commit executa OXLint `--fix` e OXFmt. (R21, Should)
- [ ] Given `bun run test:coverage`, Then a cobertura é gerada em `coverage/`. (R22, Should)

## 7. O que fazer

1. Ler `node_modules/turbo/docs/README.md` da versão instalada antes de alterar `turbo.json`.
2. Criar `apps/app` com Vite, React, TypeScript e a página mínima `/`; remover `apps/web`.
3. Criar `apps/api` com Nest.js, configuração de ambiente, validação de DTO e endpoint `GET /`.
4. Remover `packages/eslint-config`, ESLint, Prettier e configurações associadas; instalar OXLint, OXFmt, `lefthook` e `lint-staged`.
5. Configurar TailwindCSS e shadcn/ui em `packages/ui`; substituir os stubs conflitantes (`Button` com `alert`, `Card` com UTM) por primitivos compatíveis com o contrato.
6. Instalar e configurar TanStack Query, TanStack Table, TanStack Charts, `date-fns` e o SDK do Supabase nos workspaces consumidores.
7. Configurar Vitest, Supertest e Playwright; adicionar um teste mínimo por camada.
8. Inicializar o Supabase local (`supabase init`), criar `.env.example` e configurar `db:migrate` com `supabase migration up --local`.
9. Criar `docker-compose.yml` e configurações de provisionamento para Grafana, Loki, Tempo, Mimir e OpenTelemetry Collector.
10. Instrumentar a API com OpenTelemetry, logger JSON, `requestId` e exportação OTLP.
11. Atualizar scripts da raiz, tasks do `turbo.json`, `.gitignore` e a documentação canônica.
12. Criar os ADRs 0001 e 0002 e executar todos os gates de `QA.md`.
13. Ajustar `apps/docs` para uma página mínima sem conteúdo demo e sem dependência de componentes removidos.

## 8. O que não fazer

- Não implementar experts, personas, demandas, entregas, conectores, ingestão, LLM ou busca.
- Não criar tabelas, RLS, policies ou migrations de domínio.
- Não implementar login, sessão, autorização, upload ou storage.
- Não configurar CI/CD, Vercel, Supabase remoto ou ambiente de produção.
- Não criar roteador, estado global adicional ou telas no `apps/app`.
- Não manter `apps/web`, ESLint, Prettier ou `packages/eslint-config` como fallback.
- Não criar `apps/api/src/modules/shared` preventivamente; a primeira fatia define o que é compartilhado.
- Não commitar `.env`, chaves, tokens ou credenciais.
- Não editar `.next/`, `.turbo/`, `node_modules/`, lockfile manualmente ou o bloco `turborepo-agent-rules` do `AGENTS.md` da raiz.
- Não adicionar dependências fora do stack-alvo sem justificativa de problema, alternativa e custo.
- Não mascarar falha de lint, tipo ou teste com `eslint-disable`, `@ts-ignore`, `any` ou teste vazio.
- Não alterar o escopo de produto desta spec.

## 9. Riscos e dependências

| Tipo        | Descrição                                                                           | Mitigação                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Dependência | Docker precisa estar instalado e em execução para Supabase local e LGTM.            | `infra:up` falha rápido com mensagem clara; documentar pré-requisitos em `QA.md`.                                 |
| Dependência | Supabase CLI precisa estar instalada e compatível com o `config.toml`.              | Registrar a versão usada e validar `supabase status` no gate manual.                                              |
| Dependência | Playwright exige download de browsers.                                              | Documentar `bunx playwright install` e validar o teste E2E após o download.                                       |
| Risco       | Conflito de portas entre Grafana (3000), docs (3001), API (3002) e app (5173).      | Fixar portas na spec, permitir override por ambiente e validar `bun run dev` com a infra ligada.                  |
| Risco       | OXFmt ainda é experimental e OXLint não cobre todo o ecossistema ESLint.            | Manter `tsc --noEmit` como gate e registrar a limitação no ADR; não reintroduzir ESLint como fallback silencioso. |
| Risco       | Configuração de shadcn/ui em monorepo com Tailwind pode divergir do padrão.         | Seguir o guia oficial de monorepo, validar build de app e docs e manter o contrato de exports de `@repo/ui`.      |
| Risco       | Remover `apps/web` é destrutivo e afeta documentação e referências.                 | Decisão confirmada; registrar ADR e atualizar `.docs/` na mesma mudança.                                          |
| Risco       | Instalar o stack-alvo completo aumenta tempo de instalação e superfície.            | Instalar apenas o stack aprovado, travar versões no lockfile e justificar cada dependência no relatório final.    |
| Risco       | O ambiente atual não é um repositório git, então hooks não podem ser testados aqui. | Configurar `lefthook`/`lint-staged` e validar em um clone git; registrar a limitação no relatório.                |
| Risco       | Falha de observabilidade pode derrubar a API se o exportador for bloqueante.        | Exportação OTLP com timeout e retry limitado; collector fora do ar não impede `GET /`.                            |

## 10. Resultado

Como validar que a spec foi atendida:

- **Comandos:** `bun install`; `bun run lint`; `bun run check-types`; `bun run build`; `bun run test`; `bun run test:integration`; `bun run test:e2e`; `bun run infra:up`; `bun run db:migrate`; `bun run infra:down`.
- **Evidência esperada:** saída com código 0 dos gates; `apps/app/dist`, `apps/docs/.next` e `apps/api/dist` gerados; `coverage/` quando `test:coverage` for executado; `docker compose ps` com containers saudáveis.
- **Comportamento observável:** `Hello World` em `http://localhost:5173/`; `{"message":"Hello World"}` em `http://localhost:3002/`; Grafana em `http://localhost:3000`; docs em `http://localhost:3001`.
- **Verificação de observabilidade:** trace da rota `GET /` no Tempo e log JSON com `requestId` no Loki; `GET /` continua 200 com o collector parado.

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                   | Impacto                                                         | Bloqueante? | Quem decide        |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------- | ------------------ |
| Premissa: `apps/docs` permanece em Next.js e não é migrado para Vite.               | Mantém o site de documentação fora do escopo de migração.       | Não         | Time de engenharia |
| Premissa: o `apps/app` não terá roteador nesta fundação.                            | Evita dependência não prevista no stack-alvo; a rota `/` basta. | Não         | Time de engenharia |
| Premissa: autenticação, RLS e storage serão implementados em specs futuras.         | Não há dados de usuário ou clube nesta fase.                    | Não         | Produto            |
| Premissa: `db:migrate` é local (`supabase migration up --local`); remoto fica fora. | Evita credenciais de produção na fundação.                      | Não         | Time de engenharia |
| Premissa: versões seguem a última estável compatível e ficam travadas no lockfile.  | Evita pinar versões frágeis na spec.                            | Não         | Time de engenharia |
| Premissa: hooks de git só podem ser validados em um clone com `.git`.               | A configuração entra, mas a execução real fica condicionada.    | Não         | Time de engenharia |
| Quem aprova formalmente a spec e os ADRs?                                           | Define o responsável por aceitar desvios de escopo.             | Não         | Time de engenharia |

## 12. Refinamento

| Data       | O que mudou                                                                                                                                                                                                                                                                                                                                         | Motivo                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 2026-11-05 | Spec reescrita no template, com requisitos R1–R23, critérios Given/When/Then, fluxos, riscos e perguntas abertas.                                                                                                                                                                                                                                   | Estrutura incompleta e critérios de aceite não verificáveis.                                   |
| 2026-11-05 | Cliente definido como `apps/app` (React + Vite), substituindo `apps/web`; `apps/docs` permanece em Next.js.                                                                                                                                                                                                                                         | Conflito entre a spec original e `.docs/ARCHITECTURE.md`; decisão confirmada pelo solicitante. |
| 2026-11-05 | ESLint + Prettier substituídos por OXLint + OXFmt, com `lefthook` e `lint-staged`.                                                                                                                                                                                                                                                                  | Alinhamento com o stack-alvo e correção da falha de lint do baseline.                          |
| 2026-11-05 | Escopo de bibliotecas fechado no stack-alvo completo de `.docs/ARCHITECTURE.md` §3.2.                                                                                                                                                                                                                                                               | “Todas as bibliotecas” era ambíguo e permitia escopo aberto.                                   |
| 2026-11-05 | Supabase local via CLI; `docker-compose.yml` restrito ao Grafana LGTM; `db:migrate` usa `supabase migration up --local`.                                                                                                                                                                                                                            | Evitar conflito entre Compose e o fluxo oficial do Supabase CLI.                               |
| 2026-11-05 | `lint`, `check-types` e `format` mantidos como canônicos; `code:fix` e `types:check` adicionados como aliases.                                                                                                                                                                                                                                      | Preservar os gates existentes sem ignorar os comandos pedidos na spec.                         |
| 2026-11-07 | Status passou para "concluída" após o commit raiz `227e0ad` e a comprovação dos hooks (R21); o repositório git foi iniciado a pedido do solicitante, fora do escopo original. Antes disso o status era "em implementação". Requisitos e critérios **não** foram alterados. Detalhes da execução em `.plans/0000-fundation-plan.md` (Reconciliação). | Execução de `implement-me`; R21 e a verificação manual de UI ficam pendentes.                  |
