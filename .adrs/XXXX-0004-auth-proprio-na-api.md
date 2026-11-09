# XXXX — Autenticação própria na API (Nest + Postgres)

- **Status:** aceito
- **Data:** 2026-11-09

> Número provisório: o orquestrador renumera ao integrar (spec `0004`).

## Contexto

O produto precisa de cadastro, confirmação de e-mail, sessão e recuperação de senha. O repositório já tem Supabase local, mas a API Nest é o único ponto que fala com o banco com privilégio (ADR do épico e `DEVELOPMENT.md` §5 e §6), o cliente é uma SPA (ADR 0001) e a identidade vai definir o isolamento por usuário. É preciso decidir quem é dono da identidade e como guardar credenciais.

## Decisão

A identidade é **própria da API**: tabelas `users` e `auth_tokens` no Postgres (schema `public`, RLS ligada e sem policies), senhas com **Argon2id** (`argon2`, parâmetros padrão da biblioteca), tokens de link opacos e aleatórios guardados só como hash SHA-256, sessão por bearer JWT (specs `0005` e seguintes). O Supabase Auth (GoTrue) não é usado.

## Alternativas consideradas

| Alternativa                                     | Prós                                                                 | Contras                                                                                                                                              | Por que não                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Supabase Auth (GoTrue)                          | Pronto: cadastro, confirmação, reset, JWT; menos código de segurança | Usuários ficam em `auth.users`, fora do nosso modelo; e-mails e telas de fluxo presas ao GoTrue; sessão única por usuário e regras próprias difíceis | O épico exige sessão única, e-mails próprios (`EmailService`) e identidade no domínio |
| `bcrypt`/`scrypt` em vez de Argon2id            | `scrypt` é nativo do Node, sem dependência                           | Argon2id é a recomendação atual da OWASP; `bcrypt` limita a 72 bytes                                                                                 | Argon2id custa uma dependência com prebuilds e atende ao requisito                    |
| Auth própria com tabelas no schema `auth` do PG | Separa visualmente                                                   | O schema `auth` é do GoTrue; risco de conflito                                                                                                       | `public` com RLS sem policies é suficiente e explícito                                |

## Consequências

- Positivas: a identidade é do domínio e testável sem serviço externo; e-mails e mensagens no nosso idioma e layout; sessão única e expiração sob nosso controle; nenhuma credencial transita pelo PostgREST.
- Negativas: a segurança de credenciais passa a ser responsabilidade do time (hash, tokens, rate limit, enumeração de e-mail); mais código a manter que com GoTrue; `argon2` é um módulo nativo (prebuilds para as plataformas comuns; plataforma sem prebuild exige toolchain de compilação).
- Impacto: `apps/api/src/modules/auth/`, migration `create_users_and_auth_tokens`, dependência `argon2` em `apps/api`. O 409 `EMAIL_ALREADY_REGISTERED` permite enumerar e-mails (decisão de produto), mitigado pelo limite `sign-up` (ADR 0005). Documentado em `ARCHITECTURE.md` §4.6.
