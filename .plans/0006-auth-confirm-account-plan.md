# Plano — 0006 Confirmar conta por e-mail e reenviar confirmação

- **Status:** concluída (R1–R8 atendidos; gates verdes em 2026-11-09)
- **Slug:** 0006-auth-confirm-account
- **Spec:** `.specs/0006-auth-confirm-account.md`
- **Data:** 2026-11-09

## Contexto

0001 a 0005 e 0009 estão na base: `EmailService` (provider `capture`), `@RateLimit` (políticas `confirm-account` 10/10 min por IP e `resend-confirmation` 3/10 min por IP + e-mail já registradas), `users`/`auth_tokens`, `SessionService.issue`, `AuthGuard` global com `@Public()`, token do SPA em `access-token.ts`, `auth-redirect.ts` (a página `/auth/confirm-account` já é aberta mesmo com sessão) e `presentSession`. O sign-up (0004) já gera o link `/auth/confirm-account?token=…`, mas nada o consome.

## Objetivo

`POST /api/v1/auth/confirm-account` (confirma, abre a sessão, 200 com a resposta de sessão), `POST /api/v1/auth/resend-confirmation` (202 `{}` idêntico em qualquer caso) e as páginas `/auth/confirm-account` e `/auth/resend-confirmation`.

## Não-objetivos

Sign-in, e-mail de "nova sessão", sign-out, forgot/reset (0007 a 0010); mudar o texto do e-mail de confirmação; mudar o sign-up.

## Requisitos

R1 a R8 da spec (`.specs/0006-auth-confirm-account.md` §4).

## Decisões e premissas

- **Decisão:** duas funções SQL novas (migration aditiva `20261109230000_add_auth_confirm_account.sql`), chamadas por RPC com a service role (ADR 0008), `execute` só para `service_role`:
  - `auth_confirm_account(p_token_hash)` consome o token com um único `update ... where used_at is null and expires_at > now() and type = 'email_confirmation' returning user_id` e preenche `users.email_confirmed_at` (sem sobrescrever) na mesma transação. Sob concorrência o segundo `update` reavalia o `where` depois do commit do primeiro e não acha linha: uma resposta 200 e uma 400 (R3). Devolve o id do usuário ou `null`.
  - `auth_resend_confirmation(p_email, p_token_hash, p_token_expires_at)` trava o usuário (`for update`), só age se `email_confirmed_at is null`, invalida os tokens `email_confirmation` não usados e insere o novo; devolve o primeiro nome ou `null` (R5), como `auth_request_password_reset` (0009).
- **Decisão:** `ConfirmAccount` chama a função SQL e, só se ela devolveu o usuário, `SessionService.issue` (que revoga a sessão anterior, R4). A sessão nunca é criada sem o token ter sido consumido.
- **Decisão:** o hash do token entra por uma função injetada (`hashToken`, a mesma do gerador), assim a aplicação não importa infraestrutura.
- **Decisão:** o e-mail do reenvio reusa `ConfirmationMailer` (o template do 0004); sai depois do commit, em segundo plano (`dispatch`), e a falha só vai ao log.
- **Decisão:** um único erro de domínio `InvalidConfirmationTokenError` vira `400 TOKEN_INVALID_OR_EXPIRED` ("This link is invalid or has expired."), sem distinguir o motivo.
- **Decisão (SPA):** `useConfirmAccount` guarda o token de sessão no `onSuccess` do próprio hook (não no callback do `mutate`, que se perde quando o StrictMode desmonta e remonta); a chamada única vem de um `useRef`, que sobrevive a essa simulação.
- **Premissa:** a função SQL consome o token e confirma o e-mail numa transação; a sessão é aberta em seguida por `SessionService.issue` (como pede a spec §7.2). Se a abertura da sessão falhar (banco fora do ar), a conta já está confirmada e a pessoa entra pelo sign-in (0007); o link fica usado. Aceito: o inverso (sessão sem token consumido) é impossível.
- **Premissa:** `Back to sign in` aponta para `/auth/sign-in` (0007, ainda inexistente; cai na 404 do grupo `/auth` até lá). O E2E verifica só o `href` e a URL final.
- **Premissa:** o token na URL vem como string pelo `validateSearch`; um valor que não seja string é tratado como link sem token.
- Sem dependência nova. Sem ADR novo (reaproveita 0007, 0008 e 0009).

## Fatias verticais

1. **Banco + repositório (R1 a R3, R5):** migration; porta `ConfirmationRepository`; `SupabaseConfirmationRepository`; testes de integração das funções (RPC, permissões, concorrência).
2. **API (R1 a R6):** `ConfirmAccount`, `ResendConfirmation`, DTOs, endpoints com `@Public()` e `@RateLimit`; unitários com fakes; integração HTTP.
3. **SPA (R7, R8):** `useConfirmAccount`, página de confirmação, `useResendConfirmation`, página de reenvio, rotas; testes de componente (inclui StrictMode).
4. **E2E e docs:** Playwright (`confirm-account`); `QA.md`, `ARCHITECTURE.md`, `DEVELOPMENT.md`; spec e plano.

## Arquivos previstos

- `supabase/migrations/20261109230000_add_auth_confirm_account.sql`
- `apps/api/src/modules/auth/{domain,application,infrastructure,interface}/...` (novos), `auth.module.ts`, `auth.tokens.ts`, `interface/auth.controller.ts` (aditivos)
- `apps/api/test/auth-confirm-account.int-spec.ts`, `apps/api/test/support/in-memory-confirmation.ts`
- `apps/app/src/features/auth/{confirm-account,resend-confirmation}-*`, `apps/app/src/router.tsx` (rotas aditivas)
- `e2e/confirm-account.spec.ts`
- `.docs/QA.md`, `.docs/ARCHITECTURE.md`, `.docs/DEVELOPMENT.md`

## Testes

- Unitário: casos de uso, repositório (RPC mockado), DTOs, páginas (incluindo StrictMode e estados de erro).
- Integração: R1 a R6 contra o Supabase local e `capture`.
- E2E: cadastro, e-mail capturado, link, `/app`, link reutilizado, reenvio.

## Riscos e rollback

- Scanners de e-mail: confirmação só por `POST`, disparado pela página.
- Rollback: `drop function public.auth_confirm_account(text); drop function public.auth_resend_confirmation(text, text, timestamptz);` (comentado na migration).

## Critério de pronto

- [x] R1 a R8 verificados (testes e QA manual).
- [x] lint, check-types, build, test, test:integration, test:e2e verdes.
- [x] docs atualizados; commit e push feitos pela skill `commit-and-push`.

## Perguntas abertas

Nenhuma bloqueante.
