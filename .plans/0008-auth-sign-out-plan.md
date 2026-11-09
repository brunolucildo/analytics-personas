# Plano — 0008 Encerrar sessão (sign-out)

- **Status:** concluída (R1–R5 atendidos; gates verdes em 2026-11-09)
- **Slug:** 0008-auth-sign-out
- **Spec:** `.specs/0008-auth-sign-out.md`
- **Data:** 2026-11-09

## Contexto

A 0005 entregou `SessionService.revoke`, o `AuthGuard` global (API fechada por padrão), o token no `localStorage`, o guard de `/app` e a home. Falta expor a revogação à pessoa logada.

## Objetivo

`POST /api/v1/auth/sign-out` (204, fechado por padrão) que revoga a sessão do token enviado, e botão `Sign out` na home que chama o endpoint e, com sucesso ou falha, remove o token, limpa o cache de consultas e vai a `/auth/sign-in`.

## Não-objetivos

Sair de todos os dispositivos, listar sessões, menu de usuário/perfil, expiração automática, confirmação antes de sair.

## Usuários e permissões

Qualquer pessoa com sessão válida. Revoga só a sessão do `sid` do request; sem sessão, 401 `UNAUTHENTICATED` pelo guard global.

## Fluxos e estados

- Feliz: botão -> `POST` 204 -> token removido, cache limpo -> `/auth/sign-in`.
- Carregando: botão desabilitado com indicador.
- Erro (rede, 5xx, 401): sem mensagem; a saída local acontece do mesmo jeito (R4).

## Requisitos

| ID  | Requisito                                          | Critério de aceite (resumo)                                                                     |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| R1  | `POST /api/v1/auth/sign-out` revoga a sessão atual | 204 sem corpo, `revoked_at` preenchido; o mesmo token em `GET /auth/session` -> 401             |
| R2  | Exige sessão                                       | Sem token/token inválido -> 401; sessão de outro usuário intacta                                |
| R3  | Botão `Sign out` na home                           | Mouse/Enter/Space; remove token, limpa cache, `/auth/sign-in`; 44x44; desabilita enquanto envia |
| R4  | Sair funciona mesmo com falha da API               | Rede/5xx/401 -> token removido e `/auth/sign-in`                                                |
| R5  | `/app` volta a ser privado                         | E2E: depois do sair, `/app` e "voltar" levam a `/auth/sign-in`                                  |

## Dados, integrações

Nenhuma migration: usa `sessions.revoked_at` via `SessionService.revoke` (idempotente). Sem dependência nova.

## Decisões e premissas

- Decisão: caso de uso `SignOut` em `application/` (envolve `SessionService.revoke`); o controller lê o `sid` de `@CurrentSession()`.
- Decisão: a limpeza local roda em `onSettled` da mutation (nível do hook), para disparar mesmo se o componente desmontar.
- Premissa (E2E): sem a 0007, o E2E semeia usuário e sessão por helper de teste (`e2e/support/session.ts`), como o `session.spec.ts` da 0005; o E2E "de ponta a ponta com login real" passa a usar login real quando a 0007 existir.
- Premissa: o destino `/auth/sign-in` cai na 404 do grupo `/auth` até a 0007; o E2E verifica só a URL.
- Premissa: sem rate limit no sign-out (rota autenticada; o token já limita o abuso).

## Abordagem (fatias verticais)

1. **API (R1, R2):** `SignOut`, rota no controller, provider no módulo; unitário e integração.
2. **SPA (R3, R4):** `useSignOut`, `SignOutButton`, home; testes de componente (mouse, teclado, falhas, desabilitado).
3. **E2E e docs (R5):** `e2e/sign-out.spec.ts`; `.docs/`; QA manual.

## Arquivos previstos

- `apps/api/src/modules/auth/application/sign-out.ts` (+ spec), `auth.module.ts`, `interface/auth.controller.ts`, `apps/api/test/auth-sign-out.int-spec.ts`
- `apps/app/src/features/auth/{use-sign-out.ts,sign-out-button.tsx,sign-out-button.test.tsx}`, `apps/app/src/routes/home-page.tsx`
- `e2e/sign-out.spec.ts`, `.docs/*`

## Riscos e rollback

- Falha de rede deixa a sessão ativa no servidor até expirar (aceito, R4). Rollback: remover a rota e o botão (sem migration).

## Critério de pronto

- [x] R1 a R5 verificados; gates verdes; docs; commit e push pela skill `commit-and-push`.

## Perguntas abertas

Nenhuma bloqueante.
