# Plano — 0005 Sessões, sessão única e proteção de rotas

- **Status:** concluída (R1–R10 atendidos; gates verdes em 2026-11-09)
- **Slug:** 0005-auth-sessions-and-route-guard
- **Spec:** `.specs/0005-auth-sessions-and-route-guard.md`
- **Data:** 2026-11-09

## Contexto

Com a 0004 existem `users`, `auth_tokens`, o módulo `auth` (camadas), a camada de dados `supabase-js` + RPC e o `api-client`. Nenhuma rota é protegida: a API inteira e `/app/*` são públicos. As specs 0006 e 0007 emitem sessão; 0008 revoga; todas dependem desta.

## Objetivo

Sessão por bearer JWT (`sub`, `sid`, `iat`, `exp`) com o `sid` conferido no banco a cada request, sessão única por usuário, API fechada por padrão (`@Public()` para exceções), `GET /api/v1/auth/session`, e no SPA: token em `localStorage`, `Authorization`, guard de `/app/*`, redirecionamento de quem já está logado para fora de `/auth/*` e home real.

## Não-objetivos

Emitir sessão em fluxo de usuário (0006/0007), sign-out (0008), páginas de auth, refresh token, cookie, lista de sessões, papéis, limpeza de sessões expiradas.

## Usuários e permissões

Qualquer pessoa com conta. Isolamento por usuário. `sessions` só é alcançável pela API (service role): RLS ligada, sem policies, `revoke all` de `anon`/`authenticated`; funções RPC com `execute` só para `service_role`.

## Fluxos e estados

- Feliz: token válido -> `GET /auth/session` -> home com o nome.
- Vazio: sem token -> `/auth/sign-in`, sem chamar a API.
- Carregando: `role="status"` enquanto a sessão é verificada.
- Erro: 401 -> remove o token e vai ao sign-in; rede/5xx -> "We couldn't verify your session." + `Try again` (não apaga o token).
- Revogada por outro login: próximo request cai em 401.

## Requisitos

| ID  | Requisito                                         | Prioridade | Critério de aceite (resumo)                                                                   |
| --- | ------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| R1  | Tabela `sessions` com sessão ativa única no banco | Must       | RLS sem policies, índice único parcial, `anon` sem acesso, RPC sem `execute` para `anon`      |
| R2  | `issue`, `validate`, `revoke`                     | Must       | `issue` devolve `{accessToken, expiresAt, user}`; a anterior é revogada na mesma transação    |
| R3  | `AUTH_JWT_SECRET` validada                        | Must       | >= 32 caracteres; ausente/curta: a API não sobe e cita a variável                             |
| R4  | API fechada por padrão                            | Must       | 401 `UNAUTHENTICATED` sem motivo distinguível; `@Public()` libera health e rotas abertas      |
| R5  | `GET /api/v1/auth/session`                        | Must       | 200 `{user}` sem campos internos; sem token 401                                               |
| R6  | Sessão única ponta a ponta                        | Must       | Token A depois B: A 401, B 200                                                                |
| R7  | SPA guarda e envia o token                        | Must       | `Authorization: Bearer`; `localStorage` falho não quebra; 401 limpa o token e vai ao sign-in  |
| R8  | `/app/*` exige sessão                             | Must       | Sem token / token inválido -> `/auth/sign-in`; válido -> home; loading anunciado              |
| R9  | Logado sai das páginas de auth                    | Must       | `sign-in`, `sign-up`, `forgot-password` -> `/app`; `confirm-account`, `reset-password` livres |
| R10 | Home real em `/app`                               | Must       | Um `h1` `Welcome, <firstName>` e "You are signed in."                                         |

## Contratos de dados

`sessions`: `id` (uuid = `sid`), `user_id` (FK, cascade), `created_at`, `expires_at` (criação + 7 dias), `revoked_at` (nulo = ativa); índice único parcial em `user_id where revoked_at is null`. JWT sem PII. Resposta de sessão `{accessToken, expiresAt, user:{id, firstName, lastName, email}}`. Chave do `localStorage`: `access_token`. Erro: `401 UNAUTHENTICATED` ("Authentication required.").

## Integrações

Postgres por `supabase-js` (service role) e RPC (ADR 0008). JWT HS256 com `jose`. Falha do banco na validação vira `DataAccessError` (500), nunca 401 (não confunde indisponibilidade com sessão inválida).

## Decisões e premissas

- Decisão: JWT HS256 (`jose`), segredo único `AUTH_JWT_SECRET`; ADR `XXXX-0005-modelo-de-sessao-jwt-com-sid-no-banco`.
- Decisão: `auth_issue_session` (RPC) trava a linha do usuário (`for no key update`), revoga as ativas e insere a nova numa transação; o índice único parcial é a garantia final. Devolve os dados do usuário para montar a resposta sem segunda consulta.
- Decisão: `validate` lê `sessions` junto com o usuário (uma leitura por request) e o guard anexa a sessão ao request; `GET /auth/session` não consulta o banco de novo.
- Decisão: `@Public()` vive em `src/common/public.decorator.ts` (usado por `health`, `email` e `auth`; módulos não se importam).
- Decisão (SPA): o guard de `/app` é a combinação de `beforeLoad` (sem token: redireciona sem chamar a API) e do `AppLayout` (consulta `GET /auth/session` e controla carregando/erro/401); o token entra na chave da query para que um novo login nunca reaproveite cache de outra sessão.
- Decisão (SPA): o token é lido de `localStorage` com `try/catch` e cai para memória quando o storage falha.
- Premissa: `issue` não verifica `email_confirmed_at`; quem chama (0006/0007) responde por isso.
- Premissa: só 401 com `code` `UNAUTHENTICATED` limpa o token no `api-client` (um 401 de credencial inválida do sign-in, 0007, usa outro código).
- Premissa: `GET /auth/session` devolve só `{user}` (sem `accessToken`), conforme R5.
- Premissa: `/test-support/emails` fica `@Public()` (já é 404 fora de `capture`).

## Abordagem (fatias verticais)

1. **Banco (R1):** migration `20261109210000_create_sessions.sql` (tabela, índice parcial, RLS, `auth_issue_session`); teste de integração com `anon`/`authenticated`/`service_role`.
2. **API (R2–R6):** `AUTH_JWT_SECRET`; domínio/ports de sessão; `SessionService`; repositório Supabase; assinador `jose`; `AuthGuard` global + `@Public()`; `GET /auth/session`; migra probes e rotas abertas; unitários e integração (sessão única, concorrência, 401 sem motivo).
3. **SPA (R7–R10):** módulo de token, `api-client` (`get`, `Authorization`, 401), query da sessão, guard de `/app`, redirecionamento de `/auth/*`, home real; testes de componente e de função pura.
4. **E2E e docs:** helpers de semeadura, E2E (sem token, token inválido, token válido, logado fora do sign-up, sessão única), ADR, `ARCHITECTURE.md`, `DEVELOPMENT.md`, `QA.md`, `.env.example`.

## Arquivos previstos

- `supabase/migrations/20261109210000_create_sessions.sql`
- `apps/api/src/modules/auth/**` (domínio, aplicação, infraestrutura, interface), `apps/api/src/common/public.decorator.ts`, `apps/api/src/config/environment.ts`, `health.controller.ts`, `test-support-emails.controller.ts`
- `apps/api/test/**` (sessões, setup-env, probes)
- `apps/app/src/lib/{access-token,api-client,query-client}.ts`, `apps/app/src/features/auth/**`, `apps/app/src/routes/**`, `apps/app/src/router.tsx`, `apps/app/src/main.tsx`
- `e2e/**`, `playwright.config.ts`
- `.adrs/XXXX-0005-*.md`, `.docs/*`, `.env.example`

## Testes

- Unitário: serviço de sessão (fakes), assinador, guard, regras; token do SPA, `api-client`, função de redirecionamento, layouts.
- Integração: banco (R1), serviço com Supabase real (R2), API (R3–R6).
- E2E: R8 (sem token, inválido, válido), R9 (logado em `/auth/sign-up`), R10, sessão única.
- Manual: 375/768/1280, teclado, foco, estado de carregamento anunciado.

## Riscos e rollback

- Uma leitura por request; índice por `id`.
- Token em `localStorage` (XSS) aceito pelo solicitante; registrado no ADR.
- Rollback da migration: SQL no comentário (`drop function`, `drop table sessions`).

## Critério de pronto

- [x] R1 a R10 verificados.
- [x] `lint`, `check-types`, `build`, `test`, `test:integration`, `test:e2e` verdes.
- [x] ADR provisório, `.docs`, spec e plano atualizados; commit e push pela skill `commit-and-push`.

## Perguntas abertas

Nenhuma bloqueante.
