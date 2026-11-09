# Plano — 0004 Cadastro de conta (sign-up)

- **Status:** concluída (R1–R9 atendidos; gates verdes em 2026-11-09)
- **Slug:** 0004-auth-sign-up
- **Spec:** `.specs/0004-auth-sign-up.md`
- **Data:** 2026-11-09

## Contexto

A plataforma não tem usuários nem banco de domínio (`supabase/migrations/` só tem `.gitkeep`). As specs 0001 (prefixo, envelope, roteador), 0002 (`EmailService`, provider `capture`) e 0003 (`@RateLimit`) já estão na base. Esta spec é o esqueleto ambulante do épico de autenticação: UI, API em camadas, banco e e-mail.

## Objetivo

`POST /api/v1/auth/sign-up` e a página `/auth/sign-up`: cria um usuário não confirmado (Argon2id), gera o token de confirmação (24 h, só o hash no banco), despacha o e-mail com o link e devolve `201 {email}`; e-mail repetido devolve 409.

## Não-objetivos

Confirmar conta, reenviar confirmação, sessão/JWT, sign-in, forgot/reset de senha, login social, papéis, clube/workspace, captcha, verificação de senha vazada.

## Usuários e permissões

Rota pública. Papel único (usuário). Isolamento por usuário. `users` e `auth_tokens` só são alcançáveis pela conexão da API (service role); `anon` e `authenticated` não têm grant, RLS ligada e sem policies.

## Fluxos e estados

- Feliz: formulário → `POST` → 201 → tela "Check your email" com o endereço.
- Erro: 400 por campo; 409 no campo e-mail com link `Sign in`; 429 mensagem geral com o tempo de espera; rede/5xx mensagem geral, campos preservados.
- Sucesso parcial: falha no provedor de e-mail não falha o cadastro (R6).
- Corrida: dois cadastros simultâneos do mesmo e-mail: um 201, outro 409.

## Requisitos

| ID  | Requisito                                               | Prioridade | Critério de aceite (resumo)                                                                   |
| --- | ------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| R1  | Migration de `users`/`auth_tokens` sem acesso público   | Must       | Índices únicos; RLS ligada, sem policies; `anon`/`authenticated` sem leitura, escrita nem RPC |
| R2  | `POST /api/v1/auth/sign-up` cria usuário não confirmado | Must       | 201 `{email}`; `email_confirmed_at` nulo; hash `$argon2id$`                                   |
| R3  | Validação de entrada                                    | Must       | 400 `VALIDATION_FAILED` com `details` por campo; campos extras rejeitados                     |
| R4  | E-mail repetido recebe 409                              | Must       | 409 `EMAIL_ALREADY_REGISTERED`; concorrência sem 500                                          |
| R5  | Token e e-mail de confirmação                           | Must       | `auth_tokens` 24 h, só hash; e-mail com link cujo token hasheado é o `token_hash`             |
| R6  | Falha no e-mail não falha o cadastro                    | Must       | 201; usuário e token existem; erro registrado sem PII                                         |
| R7  | Limite de requisições                                   | Must       | 6ª requisição do IP na hora: 429                                                              |
| R8  | Página `/auth/sign-up`                                  | Must       | Campos, validação por campo, estados, 409/429/rede, "Check your email"                        |
| R9  | Camada de dados e cliente HTTP reutilizáveis            | Should     | Módulo `auth` em camadas; `lib/api-client.ts`; `features/auth/`                               |

## Contratos de dados

- `users`: `id uuid`, `first_name`, `last_name`, `email` (normalizado, único), `password_hash`, `email_confirmed_at`, `created_at`, `updated_at`.
- `auth_tokens`: `id`, `user_id` (FK cascade), `type` (`email_confirmation` | `password_reset`), `token_hash` (SHA-256 hex, único), `expires_at`, `used_at`, `created_at`.
- RPC `auth_sign_up(...)` devolve o `uuid` do usuário criado ou `null` quando o e-mail já existe. Só `service_role` executa.
- PII: nome, sobrenome e e-mail, retidos enquanto a conta existir; senha só como hash; nada disso vai para log.

## Integrações

- Postgres via `@supabase/supabase-js` (service role, só no servidor) e funções SQL por RPC (decisão do solicitante, spec §11).
- E-mail só pelo `EmailService.dispatch`, depois do commit.

## Decisões e premissas

- **Decisão (solicitante):** `supabase-js` + RPC para o que exige transação; ADR provisório `XXXX-0004-acesso-a-dados-com-supabase-js-e-rpc`.
- **Decisão:** auth próprio na API; ADR provisório `XXXX-0004-auth-proprio-na-api`.
- **Decisão:** a criação do usuário e do token é uma única função SQL (`auth_sign_up`), com `insert ... on conflict (email) do nothing`: a corrida é resolvida pelo índice único, sem exceção e sem 500.
- **Decisão:** `argon2` (node-argon2, prebuilds) em `apps/api`; parâmetros padrão da biblioteca com Argon2id.
- **Decisão:** validação na borda com DTO (`class-validator`); constantes e normalização no `domain`; o caso de uso recebe valores já normalizados.
- **Decisão:** sem biblioteca de formulário no SPA (cinco campos, validação por função pura); `Input` e `Label` entram em `@repo/ui`.
- **Premissa:** a integração roda contra o Supabase local; as chaves vêm de `supabase status -o env` quando não estão no ambiente (`globalSetup` do vitest de integração).
- **Premissa (seams de teste, sem pessoa disponível para confirmar):** fronteira HTTP da API (Supertest), contrato das funções e tabelas no banco real, regras puras do `domain`, a página do SPA (Testing Library) e o fluxo completo (Playwright).

## Abordagem (fatias verticais)

1. **Banco (R1):** migration (tabelas, índices, RLS, revokes, `auth_sign_up`, `set_updated_at`); teste de integração com `anon` e `authenticated`.
2. **API (R2–R7, R9):** domain (regras), application (`SignUp`), infrastructure (repositório Supabase, Argon2id, tokens, mailer), interface (controller, DTO); unitários com fakes e integração com o banco real e o `capture`.
3. **SPA (R8, R9):** `lib/api-client.ts`, `@repo/ui` `Input`/`Label`, `features/auth` (página, mutation, validação), rota `/auth/sign-up`; testes de componente.
4. **E2E e documentação:** Playwright com a API em `capture`; ADRs; `QA.md`, `ARCHITECTURE.md`, `DEVELOPMENT.md`.

## Arquivos previstos

- `supabase/migrations/20261109200000_create_users_and_auth_tokens.sql`
- `apps/api/src/modules/auth/**`, `apps/api/src/app.module.ts` (import aditivo)
- `apps/api/test/auth-sign-up.int-spec.ts`, `apps/api/test/support/*`, `apps/api/vitest.integration.config.mts`
- `apps/app/src/lib/api-client.ts`, `apps/app/src/features/auth/**`, `apps/app/src/router.tsx` (rota aditiva)
- `packages/ui/src/input.tsx`, `packages/ui/src/label.tsx`
- `e2e/sign-up.spec.ts`, `playwright.config.ts`
- `.adrs/XXXX-0004-*.md`, `.docs/QA.md`, `.docs/ARCHITECTURE.md`, `.docs/DEVELOPMENT.md`

## Testes

- Unitário: regras do `domain`, DTO, caso de uso com fakes, adaptador de e-mail, `api-client`, formulário.
- Integração: R1 a R7 contra o Supabase local e o provider `capture`.
- E2E: R8 (senhas diferentes sem chamar a API; cadastro completo e mensagem capturada; 409).
- Manual: 375/768/1280, teclado, foco, contraste, console.

## Riscos e rollback

- Regra espalhada entre TypeScript e SQL: SQL só tem o atômico necessário.
- `test:integration` passa a exigir Docker e Supabase local com migrations aplicadas.
- Enumeração de e-mail pelo 409 (decisão do solicitante), mitigada pelo limite do 0003.
- Rollback da migration: `drop function ...; drop table public.auth_tokens; drop table public.users;` (documentado no próprio arquivo da migration).

## Critério de pronto

- [x] R1 a R9 verificados (testes e QA manual).
- [x] `lint`, `check-types`, `build`, `test`, `test:integration`, `test:e2e` verdes.
- [x] ADRs provisórios, `.docs` e spec atualizados; commit e push feitos pela skill `commit-and-push`.

## Perguntas abertas

Nenhuma bloqueante.
