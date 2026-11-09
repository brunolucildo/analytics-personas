# Plano — 0009 Esqueci a senha (solicitar redefinição)

- **Status:** concluída (R1–R7 atendidos; gates verdes em 2026-11-09)
- **Slug:** 0009-auth-forgot-password
- **Spec:** `.specs/0009-auth-forgot-password.md`
- **Data:** 2026-11-09

## Contexto

0001 a 0004 estão na base: `EmailService`, `@RateLimit` (política `forgot-password` 3/10 min por IP + e-mail já registrada), tabelas `users`/`auth_tokens`, módulo `auth` em camadas, `api-client` e a página de sign-up. A 0005 (sessões/guard) roda em paralelo e não é dependência: não há `@Public()` nem guard (rotas são públicas por padrão hoje).

## Objetivo

`POST /api/v1/auth/forgot-password` (202 `{}` idêntico em qualquer caso) e a página `/auth/forgot-password`. Só conta confirmada recebe token `password_reset` (1 h, hash) e e-mail com o link.

## Não-objetivos

Página de reset, troca de senha, e-mail de sucesso, revogação de sessões (0010); reenvio de confirmação (0006); sign-in (0007).

## Requisitos

R1 a R7 da spec (ver `.specs/0009-auth-forgot-password.md` §4).

## Decisões e premissas

- **Decisão:** a parte atômica (achar usuário confirmado, invalidar tokens de reset anteriores, inserir o novo) é a função SQL `auth_request_password_reset(p_email, p_token_hash, p_token_expires_at)`, chamada por RPC (ADR 0008). Ela trava a linha do usuário com `for update`, então dois pedidos simultâneos nunca deixam dois tokens válidos (R4). Devolve o primeiro nome (ação feita) ou `null` (sem ação).
- **Decisão:** o e-mail sai depois do commit, por `EmailService.dispatch` (fire-and-forget), como no 0004; falha só no log (R5).
- **Decisão:** a resposta não depende do ramo: o controller sempre devolve `202 {}`.
- **Decisão:** arquivos novos separados (`password-reset-ports.ts`, `request-password-reset.ts`, repositório, mailer, DTO), com mudanças aditivas mínimas nos arquivos compartilhados com a 0005 (`auth.module.ts`, `auth.tokens.ts`, `auth.controller.ts`, `router.tsx`).
- **Premissa:** o redirecionamento de quem já está logado para `/app` (R7) é regra da 0005; esta spec não usa sessão.
- **Premissa:** `Back to sign in` aponta para `/auth/sign-in` (rota da 0007, ainda inexistente; o 404 atual é aceito até lá). O E2E verifica só o `href`.
- **Premissa:** sem `@Public()` (guard é da 0005): a rota já é pública.
- Sem dependência nova. Sem ADR novo (reaproveita 0007 e 0008).

## Fatias verticais

1. **Banco + repositório (R2 a R4):** migration `20261109220000_add_auth_request_password_reset.sql`; `PasswordResetRepository` Supabase; teste de integração da função (RPC) e das permissões.
2. **API (R1 a R6):** domain port, caso de uso `RequestPasswordReset`, e-mail de reset, mailer, DTO, endpoint com `@RateLimit('forgot-password')`; unitários com fakes; integração HTTP (comparação de resposta, token, e-mail, falha do provedor, limite).
3. **SPA (R7):** `useForgotPassword`, página, rota `/auth/forgot-password`; testes de componente.
4. **E2E e docs:** Playwright; `QA.md`, `ARCHITECTURE.md`, `DEVELOPMENT.md`; spec e plano.

## Arquivos previstos

- `supabase/migrations/20261109220000_add_auth_request_password_reset.sql`
- `apps/api/src/modules/auth/{domain,application,infrastructure,interface}/...` (novos), `auth.module.ts`, `auth.tokens.ts` (aditivos)
- `apps/api/test/auth-forgot-password.int-spec.ts`, `apps/api/test/support/in-memory-password-reset.ts`
- `apps/app/src/features/auth/forgot-password-*`, `apps/app/src/router.tsx` (rota aditiva)
- `e2e/forgot-password.spec.ts`
- `.docs/QA.md`, `.docs/ARCHITECTURE.md`, `.docs/DEVELOPMENT.md`

## Testes

- Unitário: caso de uso, e-mail, mailer, repositório (RPC mockado), DTO, página.
- Integração: R1 a R6 contra Supabase local e `capture`.
- E2E: pedido -> mensagem genérica -> e-mail capturado só para conta confirmada.

## Riscos e rollback

- Enumeração por tempo: diferença residual de uma consulta ao banco aceita (spec §9).
- Rollback: `drop function public.auth_request_password_reset(text, text, timestamptz);` (comentado na migration).

## Critério de pronto

- [x] R1 a R7 verificados (testes e QA manual).
- [x] lint, check-types, build, test, test:integration, test:e2e verdes.
- [x] docs atualizados; commit e push feitos pela skill `commit-and-push`.

## Perguntas abertas

Nenhuma bloqueante.
