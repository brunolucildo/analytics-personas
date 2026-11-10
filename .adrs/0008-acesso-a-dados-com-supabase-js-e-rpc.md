# 0008 — Acesso a dados com `supabase-js` (service role) e funções SQL por RPC

- **Status:** aceito
- **Data:** 2026-11-09

## Contexto

A API precisa gravar e ler `users` e `auth_tokens` com transação (por exemplo, criar o usuário e o token de confirmação juntos; mais tarde, abrir sessão e consumir token). O `@supabase/supabase-js` já está no repositório (SPA), o Supabase local está no ar e a API já recebe `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Tabelas do schema `public` são alcançáveis pelo PostgREST com a chave `anon`, e funções chamadas por RPC também. A recomendação do assistente era conexão direta ao Postgres (`pg`); o **solicitante decidiu** usar `supabase-js` com funções SQL (registrado na spec `0004` §11).

## Decisão

Os repositórios em `infrastructure` usam `@supabase/supabase-js` com a **service role** (só no servidor, `persistSession: false`). Leituras e escritas simples vão pelas tabelas; o que exige transação ou atomicidade vive em **funções SQL chamadas por RPC** (`auth_sign_up` na spec `0004`), definidas nas migrations. Segurança: RLS ligada e **sem policies** nas tabelas, `revoke all` de `anon`/`authenticated`, e `execute` das funções revogado de `public`, `anon` e `authenticated` e concedido só a `service_role`. Erros do banco viram `DataAccessError` com mensagem fixa (só operação e código), porque as mensagens do Postgres podem repetir valores (e-mail).

## Alternativas consideradas

| Alternativa                                      | Prós                                                                        | Contras                                                                                                         | Por que não                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Conexão direta ao Postgres (`pg`) com transações | Transação no TypeScript, regra num lugar só, sem expor funções ao PostgREST | Dependência nova, pool e SSL para configurar, segunda forma de falar com o banco ao lado do cliente do Supabase | Decisão do solicitante pelo `supabase-js` + RPC |
| `supabase-js` sem funções (várias chamadas)      | Só TypeScript                                                               | Sem transação: usuário sem token, ou token órfão, em caso de falha entre as chamadas                            | Quebra a atomicidade exigida                    |
| ORM (Prisma, Drizzle)                            | Tipos e migrations                                                          | Dependência pesada; duplica as migrations do Supabase                                                           | Fora do escopo e da stack                       |

## Consequências

- Positivas: nenhuma dependência nova de acesso a dados; atomicidade e resolução de corrida no banco (`on conflict do nothing` no índice único); a regra de domínio (validação, normalização) continua no TypeScript.
- Negativas: regra espalhada entre TypeScript e SQL (mitigada: o SQL só tem o atômico necessário, com teste de integração por função); funções no schema `public` ficam visíveis ao PostgREST (mitigada pelo `revoke`, verificado por teste com `anon` e `authenticated`); `supabase-js` não tem tipos de função gerados, então o contrato do RPC é validado no repositório; testes de integração dependem do Supabase local.
- Impacto: toda migration com função precisa do `revoke ... from public, anon, authenticated` e do `grant execute ... to service_role`; integração exige `bun run infra:up` e `bun run db:migrate` (a `globalSetup` lê as chaves de `supabase status`). Repositórios têm um fake em memória (`apps/api/test/support/in-memory-auth.ts`) para o teste unitário. Documentado em `DEVELOPMENT.md` §6 e `ARCHITECTURE.md` §4.6.
