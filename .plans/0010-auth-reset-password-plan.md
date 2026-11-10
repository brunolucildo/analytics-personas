# Plano — 0010 Redefinir a senha (reset password)

- **Status:** concluída (R1 a R8 atendidos; gates verdes em 2026-11-09)
- **Slug:** 0010-auth-reset-password
- **Spec:** `.specs/0010-auth-reset-password.md`
- **Data:** 2026-11-09

## Contexto

0001 a 0009 estão na base: `EmailService` (provider `capture`), `@RateLimit` (política `reset-password` 10/10 min por IP já registrada), tabelas `users`/`auth_tokens`/`sessions`, `AuthGuard` global com `@Public()`, sign-in, sign-out e o forgot-password (gera o token `password_reset` de 1 h e o link `/auth/reset-password?token=`).

## Objetivo

`POST /api/v1/auth/reset-password` (204) e a página `/auth/reset-password`: troca a senha (Argon2id), consome o token, revoga todas as sessões, envia o e-mail de sucesso e leva ao sign-in com aviso. Não abre sessão.

## Não-objetivos

Pedir o link (0009), login automático, troca de senha logado, histórico/vazamento de senha, confirmar conta pelo reset.

## Requisitos

R1 a R8 da spec (`.specs/0010-auth-reset-password.md` §4).

## Decisões e premissas

- **Decisão:** a transação do R1 é a função SQL `auth_reset_password(p_token_hash, p_password_hash)` (RPC, ADR 0008): consome o token com `update ... where used_at is null and expires_at > now() returning` (uso único sob concorrência, R4), grava o hash, invalida os demais tokens `password_reset` do usuário e devolve `user_id`, `first_name` e `email` (ou nenhuma linha).
- **Decisão:** a **revogação das sessões fica dentro da mesma função SQL** (`update sessions set revoked_at = now() where user_id = ... and revoked_at is null`), e não numa chamada posterior ao `SessionService`: uma falha entre a troca da senha e a revogação deixaria uma sessão antiga viva, o que a spec proíbe (R5, "não deixar sessões antigas ativas"). É a mesma regra do `SessionService` (revogar = `revoked_at`), só que atômica.
- **Decisão:** a validação do DTO acontece antes de qualquer acesso ao banco (R2); o hash Argon2id é calculado antes de consumir o token (custo igual para token bom ou ruim).
- **Decisão:** o e-mail de sucesso sai depois do commit, por `EmailService.dispatch` (fire-and-forget); falha só no log sem PII (R6). Recusas (R2, R3) não enviam e-mail.
- **Decisão (e-mail):** o rodapé do layout do 0002 ("you can ignore this message") destoa do aviso de segurança; o layout não é alterado, e o corpo do e-mail diz explicitamente para não ignorar quando a troca não foi da pessoa.
- **Decisão (SPA):** o token do link é lido do search da rota, guardado em estado do componente e removido da URL com navegação `replace` (usa `history.replaceState`) assim que a página monta; recarregar mostra o estado de link inválido (decisão registrada na spec). O aviso do sign-in vem de `?reset=success` (`validateSearch` na rota de sign-in). Sucesso limpa o token de sessão local e o cache `["session"]`.
- **Premissa:** `<meta name="referrer" content="no-referrer">` em `apps/app/index.html` (mitiga vazamento por `Referer`, spec §9).
- Sem dependência nova. Sem ADR novo (reaproveita 0007, 0008 e 0009).

## Fatias verticais

1. **Banco + API (R1 a R7):** migration `20261109250000_add_auth_reset_password.sql`; porta, repositório Supabase, caso de uso `ResetPassword`, e-mail de sucesso e mailer, DTO, endpoint `@Public()` `@RateLimit('reset-password')`; unitários e integração (HTTP + função SQL + permissões).
2. **SPA (R8):** hook, validação, descritor de falha, página, rota, aviso no sign-in; remoção da sonda do `session-guard.test.tsx`; testes de componente.
3. **E2E:** `e2e/reset-password.spec.ts` (contas semeadas no banco, link pelo `/auth/forgot-password` e provider `capture`).
4. **Docs:** `.docs/ARCHITECTURE.md`, `DEVELOPMENT.md`, `QA.md`, `AGENTS.md`; spec e plano.

## Arquivos previstos

- `supabase/migrations/20261109250000_add_auth_reset_password.sql`
- `apps/api/src/modules/auth/...` (novos: `reset-password.ts`, `password-changed-email.ts`, mailer, DTO; aditivos: ports, errors, repositório, module, tokens, controller)
- `apps/api/test/auth-reset-password.int-spec.ts`, `apps/api/test/support/in-memory-password-reset.ts`
- `apps/app/src/features/auth/reset-password-*`, `use-reset-password.ts`, `sign-in-page.tsx`, `router.tsx`, `routes/session-guard.test.tsx`, `index.html`
- `e2e/reset-password.spec.ts`

## Testes

- Unitário: caso de uso, e-mail, mailer, repositório (RPC mockado), DTO, validação, página e aviso.
- Integração: R1 a R7 contra Supabase local e `capture`.
- E2E: R8 (fluxo completo, link reutilizado, link sem token).

## Riscos e rollback

- Corrida entre dois resets: `update ... where used_at is null` (a segunda espera e não acha linha).
- Rollback: `drop function public.auth_reset_password(text, text);` (comentado na migration; não restaura senhas).

## Critério de pronto

- [x] R1 a R8 verificados (testes e QA manual).
- [x] lint, check-types, build, test, test:integration, test:e2e verdes.
- [x] docs atualizados; commit e push feitos pela skill `commit-and-push`.

## Perguntas abertas

Nenhuma bloqueante.
