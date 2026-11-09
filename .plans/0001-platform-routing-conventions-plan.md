# Plano — 0001 Convenções de roteamento e idioma

- **Status:** concluída (R1–R9 atendidos; gates verdes em 2026-11-09)
- **Slug:** 0001-platform-routing-conventions
- **Spec:** `.specs/0001-platform-routing-conventions.md`
- **Data:** 2026-11-09

## Contexto

A API expõe só `GET /` (hello world) e o `apps/app` só a rota `/` (sem roteador). O épico de autenticação (`.plans/auth-breakdown.md`) precisa de um espaço de URLs estável (`/auth/*`, `/app/*`, `/api/v1/*`), de um envelope de erro único e do idioma en-US antes de qualquer fluxo de auth. `BUSINESS.md` §10, `DESIGN.md` e `DEVELOPMENT.md` §4 ainda mandam pt-BR; a decisão do solicitante substitui essas regras.

## Objetivo

API sob `/api/v1` com `GET /api/v1/health`, CORS por `APP_URL` e envelope de erro; SPA com roteador (TanStack Router), grupos `/auth` e `/app`, redirect de `/`, página 404; `lang="en-US"` e textos em inglês; docs e ADRs atualizados; gates verdes.

## Não-objetivos

Endpoints ou páginas de auth, guard/sessão, cliente HTTP do SPA, rate limit, e-mail, i18n, estratégia de `v2`. `/app` fica público até o 0005.

## Usuários e permissões

Sem usuário nem dado pessoal. `GET /api/v1/health` é público; `/app` é temporariamente público (spec 0001 §5).

## Fluxos e estados

Feliz: `GET /api/v1/health` 200; `/` redireciona para `/app`; preflight de `APP_URL` aceito. Erro: payload inválido 400 `VALIDATION_FAILED`; rota inexistente 404 `NOT_FOUND`; falha inesperada 500 `INTERNAL_ERROR`; `APP_URL` ausente/inválida derruba o boot com mensagem acionável.

## Requisitos

| ID  | Requisito                                      | Prioridade | Critério de aceite (resumo)                                                |
| --- | ---------------------------------------------- | ---------- | -------------------------------------------------------------------------- |
| R1  | Prefixo `/api/v1` e `GET /api/v1/health`       | Must       | 200 `{"status":"ok"}` + `x-request-id`; `GET /` → 404 no envelope          |
| R2  | Envelope de erro global                        | Must       | 400/404/500 com `code`, `message`, `details`; sem stack                    |
| R3  | CORS restrito a `APP_URL`; variável validada   | Must       | Preflight só aceito para a origem; boot falha sem `APP_URL` válida         |
| R4  | Roteador com grupos `/auth` e `/app` e layouts | Must       | Rota de teste em cada grupo renderiza no layout (`data-testid`)            |
| R5  | `/` → `/app`; 404                              | Must       | URL final `/app`; `h1` `Page not found` com link para `/`                  |
| R6  | `lang="en-US"` em `apps/app` e `apps/docs`     | Must       | Atributo e textos em inglês                                                |
| R7  | Documentação de convenções                     | Must       | `DEVELOPMENT.md` §13 + atualização de BUSINESS/ARCHITECTURE/QA/DESIGN/etc. |
| R8  | ADRs                                           | Must       | 0003 (roteador) e 0004 (convenções de URL e idioma)                        |
| R9  | Gates e observabilidade                        | Should     | Gates passam; trace/log de `GET /api/v1/health` com `requestId`            |

## Decisões e premissas

- Decisão: TanStack Router, rotas **em código** (sem plugin de geração de rotas): menos tooling, e a árvore é pequena.
- Decisão: `configureApp(app)` exportada de `bootstrap.ts` aplica prefixo, CORS, pipes, filtro e log; permite os testes montarem o app com um controller de teste.
- Decisão: filtro global `@Catch()` produz o envelope; `ApiException` carrega `code`/`details`; `ValidationPipe` usa `exceptionFactory` para gerar `VALIDATION_FAILED` com `details: [{field, message}]`.
- Decisão: `APP_URL` obrigatória (sem default no código), exemplo em `.env.example`; o CORS usa a `origin` da URL e responde sem `Access-Control-Allow-Origin` a outras origens.
- Premissa: `apps/api/src/health/` (como `config/` e `observability/`), não em `modules/`, por ser infraestrutura e não domínio.
- Premissa: strings novas em en-US; strings pt-BR antigas só migram quando o arquivo é tocado (`environment.ts`, `main.tsx`).
- Premissa: o `.env` local do desenvolvedor não é alterado por mim; quem já tem `.env` precisa adicionar `APP_URL`.
- Dúvida: nenhuma bloqueante.

## Abordagem (fatias verticais)

1. **API: envelope de erro + prefixo + health** — teste de integração primeiro (health, 404 em `/`, validação, erro inesperado), depois `ApiException`, filtro, `HealthController`, `configureApp`.
2. **API: `APP_URL` + CORS** — testes unitários de `validateEnvironment` e integração do preflight; implementar.
3. **SPA: roteador** — testes (`/` → `/app`, 404, layouts); instalar `@tanstack/react-router`; criar `router.tsx`, layouts, home e 404; `App`/`main`.
4. **en-US** — `index.html`, `apps/docs`, textos.
5. **E2E** — migrar `home.spec.ts`, criar `routing.spec.ts`.
6. **Docs e ADRs** — `DEVELOPMENT.md` §13, demais docs, ADR 0003 e 0004, `.env.example`.
7. **Gates** — lint, tipos, build, testes, E2E, verificação manual de UI e de observabilidade.

## Arquivos previstos

- `apps/api/src/bootstrap.ts`, `config/environment.ts`, `app.module.ts`; novos `common/api-exception.ts`, `common/all-exceptions.filter.ts`, `health/health.controller.ts`; remoção de `app.controller.ts` e do spec.
- `apps/api/test/setup-env.ts`, `test/health.int-spec.ts` (substitui `app.int-spec.ts`), `test/api-conventions.int-spec.ts`.
- `apps/app/src/router.tsx`, `routes/*`, `App.tsx`, `main.tsx`, testes; `index.html`; `package.json` (dependência).
- `apps/docs/app/layout.tsx`, `page.tsx`.
- `e2e/home.spec.ts`, `e2e/routing.spec.ts`.
- `.env.example`; `.docs/*`; `.adrs/0003-*.md`, `0004-*.md`.

## Testes

- Unitário: `validateEnvironment` (`APP_URL`), `HealthController`, roteador e layouts (Vitest + Testing Library com `createMemoryHistory`).
- Integração: Supertest em `configureApp` (health, 404, validação, 500, CORS).
- E2E: `/` → `/app` com `Hello World`; `/nada` e `/auth/nada` → `Page not found`.
- Manual: 375/768/1280, teclado e foco no link do 404, console e rede; observabilidade com `infra:up`.

## Riscos e rollback

- Risco: trocar `GET /` quebra testes e docs → todas as referências migradas na mesma mudança.
- Risco: `.env` locais sem `APP_URL` impedem a API de subir → mensagem acionável e aviso no relatório.
- Rollback: `git revert` do commit; nenhuma migration nem dado envolvido.

## Critério de pronto

- [x] R1 a R9 atendidos (R9 verificado com `infra:up`, API compilada, Loki e Tempo; ver `.docs/QA.md` §1.3).
- [x] `bun run lint`, `check-types`, `build`, `test`, `test:integration`, `test:e2e` passam.
- [x] Docs, ADRs e `.env.example` atualizados; nenhum segredo commitado.

## Perguntas abertas

| Pergunta | Impacto | Bloqueante? | Quem decide |
| -------- | ------- | ----------- | ----------- |
| Nenhuma  | —       | Não         | —           |
