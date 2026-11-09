# Plano — 0007 Login com e-mail e senha (sign-in)

- **Status:** concluída (R1–R9 atendidos; gates verdes em 2026-11-09)
- **Slug:** 0007-auth-sign-in
- **Spec:** `.specs/0007-auth-sign-in.md`
- **Data:** 2026-11-09

## Contexto

0001 a 0006, 0008 e 0009 estão na base: `EmailService` (provider `capture`), `@RateLimit` (política `sign-in` 10/10 min por IP + e-mail já registrada), `users`/`sessions`, `SessionService.issue` (revoga a sessão anterior), `AuthGuard` global com `@Public()`, token no SPA (`access-token`), guard de `/app`, `AuthLayout` (quem tem sessão sai das páginas `/auth/*`), página de reenvio e sign-out.

## Objetivo

`POST /api/v1/auth/sign-in` (200 com a resposta de sessão do 0005), e-mail de nova sessão a cada login e a página `/auth/sign-in`.

## Não-objetivos

Bloqueio de conta, captcha, MFA, login social, "lembrar de mim", listar sessões, IP/dispositivo no e-mail, aviso à sessão derrubada.

## Requisitos

R1 a R9 da spec (ver `.specs/0007-auth-sign-in.md` §4).

## Decisões e premissas

- **Decisão:** `SignIn` (application) usa duas portas novas em `domain/sign-in-ports.ts`: `CredentialsRepository.findByEmail` (leitura simples da tabela `users`, ADR 0008: não precisa de função SQL) e `PasswordVerifier.verify(plain, hash | null)`. Com `null` (usuário inexistente) o verificador gasta o mesmo tempo, confrontando a senha com um hash Argon2id "fantasma" gerado uma vez, e devolve `false` (R2). A porta é separada de `PasswordHasher` para não quebrar fakes existentes.
- **Decisão:** ordem de decisão: verifica o hash sempre -> inválido (inexistente ou senha errada) = `InvalidCredentialsError` (401); senha certa e conta não confirmada = `EmailNotConfirmedError` (403); senão `SessionService.issue` (revoga a anterior) e só então despacha o e-mail (R3, R4, R5).
- **Decisão:** o e-mail de nova sessão sai por `EmailService.dispatch` (fire-and-forget) depois do commit da sessão; falha só no log, sem PII (R6). Corpo: primeiro nome, data e hora UTC, sessão anterior encerrada, link `${APP_URL}/auth/forgot-password`; sem IP, dispositivo, token ou senha.
- **Decisão:** a senha do DTO é validada só como texto não vazio com no máximo 128 caracteres (limite contra custo de hash com entrada gigante); senha curta vai para a verificação e dá 401, igual a qualquer senha errada.
- **Decisão:** o SPA guarda o token no `onSuccess` do próprio hook (como no 0006) e alimenta o cache de `["session", token]`, evitando um flash de "verificando sessão" em `/app`.
- **Premissa (E2E):** o logout manual do R9 usa o botão `Sign out` do 0008 (a spec previa limpar o token; o botão faz o mesmo para o browser e ainda revoga no servidor). O segundo login derruba a sessão do primeiro contexto como no cenário de duas máquinas. A conta do fluxo é semeada com hash real e o link de confirmação vem da página de reenvio, porque os outros specs já consomem as 5 chamadas por hora de `POST /auth/sign-up` da execução.
- **Premissa:** a sonda de rota `sign-in` em `session-guard.test.tsx` sai (a página real passa a existir).
- Sem migration, sem dependência nova. Sem ADR novo (reaproveita 0007 e 0009: modelo de sessão e acesso a dados).

## Fatias verticais

1. **API (R1 a R7):** portas, `SignIn`, repositório Supabase, verificador Argon2, e-mail e mailer, DTO, endpoint com `@Public()` e `@RateLimit('sign-in')`; unitários com fakes; integração HTTP contra Supabase local.
2. **SPA (R8):** validação, descrição de falhas, `useSignIn`, página, rota `/auth/sign-in`; testes de componente; remoção da sonda.
3. **E2E e docs (R9):** Playwright (fluxo completo e duas máquinas); `QA.md`, `ARCHITECTURE.md`, `DEVELOPMENT.md`; spec e plano.

## Arquivos previstos

- `apps/api/src/modules/auth/{domain,application,infrastructure,interface}/...` (novos), `auth.module.ts`, `auth.tokens.ts` (aditivos)
- `apps/api/test/auth-sign-in.int-spec.ts`, `apps/api/test/support/` (fakes)
- `apps/app/src/features/auth/sign-in-*`, `use-sign-in.ts`, `describe-sign-in-failure.ts`, `apps/app/src/router.tsx` (rota aditiva), `routes/session-guard.test.tsx` (remove sonda)
- `e2e/sign-in.spec.ts`, `e2e/support/`
- `.docs/QA.md`, `.docs/ARCHITECTURE.md`, `.docs/DEVELOPMENT.md`

## Testes

- Unitário: caso de uso, verificador, repositório (cliente mockado), e-mail, mailer, DTO, página, descrição de falhas.
- Integração: R1 a R7 contra Supabase local e `capture`.
- E2E: fluxo completo (R9) e sessão única entre dois contextos.

## Riscos e rollback

- Tempo de resposta: usuário inexistente também paga a verificação Argon2 (R2); a diferença residual é a consulta ao banco.
- Rollback: sem migration; basta remover o endpoint, a página e a rota.

## Critério de pronto

- [x] R1 a R9 verificados (testes e QA manual).
- [x] lint, check-types, build, test, test:integration, test:e2e verdes.
- [x] docs atualizados; commit e push feitos pela skill `commit-and-push`.

## Perguntas abertas

Nenhuma bloqueante.
