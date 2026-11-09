# XXXX — Limite de requisições em memória com guard próprio

- **Status:** aceito (número provisório; o orquestrador renumera)
- **Data:** 2026-11-09

## Contexto

As rotas públicas de autenticação (sign-up, sign-in, confirmação, reenvio, forgot e reset de senha) aceitam força bruta e viram origem de spam por e-mail sem um limite de tentativas. A API roda hoje em uma única instância. É preciso um limite por rota, com chave por IP e, em algumas rotas, por e-mail do corpo, resposta 429 no envelope do ADR 0004, logs sem dado pessoal e memória limitada. Armazenamento distribuído está fora do escopo desta fase.

## Decisão

Implementar um módulo próprio `apps/api/src/modules/rate-limit/`: decorator `@RateLimit('<policy>')` (opt-in), guard registrado como `APP_GUARD` que só age em rota com o metadado, registro de políticas nomeadas (`AUTH_RATE_LIMIT_POLICIES`) e armazenamento de janela fixa em memória atrás da interface `RateLimitStore`, com teto de 10 000 entradas. Falha do armazenamento é fail-open. O IP vem de `request.ip` do Express, com `trust proxy` controlado por `TRUST_PROXY` (padrão `false`).

## Alternativas consideradas

| Alternativa                                            | Prós                                 | Contras                                                                                                                                                                                                               | Por que não                                                                 |
| ------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `@nestjs/throttler`                                    | Pronta, mantida pela comunidade Nest | Dependência nova; chave por rota + IP + e-mail do corpo exige `getTracker`/`generateKey` customizados; 429 precisaria ser remapeado para o envelope; teto de entradas e relógio simulado exigiriam um storage próprio | Mais adaptação do que as ~150 linhas próprias, e acrescenta dependência     |
| Contador em tabela do Postgres                         | Compartilhado entre instâncias       | Escrita no banco por request, tabela e limpeza novas, latência no login                                                                                                                                               | Fora do escopo e vetado pela spec                                           |
| Redis                                                  | Compartilhado, expiração nativa      | Serviço novo na infra local e em produção                                                                                                                                                                             | Vetado pela spec; a interface `RateLimitStore` deixa a troca para o backlog |
| `@UseGuards(RateLimitGuard)` por rota em vez de global | Sem guard global                     | Cada módulo de auth precisaria importar o módulo e repetir dois decorators                                                                                                                                            | O guard global com decorator opt-in dá o mesmo efeito com um decorator só   |

## Consequências

- Positivas: sem dependência nova; um decorator por rota; números das políticas em um só arquivo; chave em hash e sem PII em log; relógio e políticas injetáveis tornam os testes determinísticos; troca do armazenamento sem tocar no guard.
- Negativas: contadores zeram ao reiniciar a API e não são compartilhados entre instâncias; janela fixa permite um pequeno "rajadão" na virada da janela; fail-open abre mão da proteção durante uma falha rara do armazenamento; manutenção do código passa a ser nossa.
- Impacto: `AppModule` importa `RateLimitModule`; `configureApp` aplica `trust proxy`; nova variável `TRUST_PROXY` (opcional, `false` por padrão); guards globais futuros (sessão) devem ser registrados depois dele. Documentado em `DEVELOPMENT.md` §13.4 e `ARCHITECTURE.md` §6.
