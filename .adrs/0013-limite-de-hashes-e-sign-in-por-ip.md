# 0013 — Limite de hashes simultâneos com fila limitada e limite de sign-in por IP

- **Status:** aceito
- **Data:** 2026-11-10

## Contexto

O argon2id (64 MiB, 3 passes, 4 lanes) tem teto de ~33 hashes/s por máquina, e roda no pool de threads do libuv, que a verificação do JWT, o `randomBytes` e o `fetch` ao PostgREST também usam. Quando o pedido de hash passa do teto, a fila do pool cresce e tudo que depende dele espera na mesma fila (medido: `jwtVerify` de 0,3 ms para 1.252 ms; `session` com p95 de 12,8 s e o event loop saudável). O limite de sign-in por IP e e-mail não barra um IP que troca de e-mail, então um único cliente consegue esse efeito (4.040 tentativas sem um 429).

## Decisão

1. Um `HashLimiter` único na aplicação limita as operações argon2 em voo a `pool − 1` (padrão 3), com fila **limitada** (padrão 64) em ordem de chegada; com a fila cheia a operação não roda e a API responde **503 `SERVICE_BUSY`** com `Retry-After`.
2. O sign-in ganha a política `sign-in-ip` (60 por 10 min por IP, sem e-mail), avaliada antes da por IP e e-mail; para isso `@RateLimit` passa a aceitar várias políticas.

## Alternativas consideradas

| Alternativa                          | Prós                                | Contras                                                                             | Por que não                                            |
| ------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Aumentar `UV_THREADPOOL_SIZE`        | Uma variável de ambiente            | Medido: o teto de hashes não muda e o host vai a 100% de CPU; a fila continua única | Não resolve                                            |
| Reduzir os parâmetros do argon2      | Multiplica o teto por 2,6 a 3,9     | Decisão de segurança; não impede a saturação por abuso                              | Fica com o Owner; complementa, não substitui           |
| Fila ilimitada                       | Nunca recusa                        | Latência e memória crescem sem limite; o login legítimo espera dezenas de segundos  | A recusa rápida é o comportamento desejado             |
| 429 em vez de 503 para a fila cheia  | Reaproveita o envelope do limitador | 429 diz que o cliente errou; aqui falta capacidade do servidor                      | 503 com `Retry-After` descreve melhor                  |
| Hash em worker threads próprias      | Isola o hash do pool compartilhado  | Mais código e processos; o limite simples já devolveu `jwtVerify` a 1 ms            | Custo maior que o benefício agora                      |
| Só reforçar o limite por IP e e-mail | Sem código novo no hash             | Não cobre o abuso distribuído em vários IPs nem a capacidade total                  | O limitador de hashes cobre o que o por IP não alcança |

## Consequências

- Positivas: o `jwtVerify` e o banco deixam de esperar atrás dos hashes (medido: 530 ms para 1 ms, com 4% menos vazão de hash); sob abuso a API recusa rápido em vez de travar; um IP só não esgota a capacidade de login; memória e latência da fila ficam limitadas.
- Negativas: sign-up, sign-in e reset podem responder 503 sob pico (o front precisa tratar `SERVICE_BUSY`); 60 por 10 min por IP pode barrar redes compartilhadas muito grandes; o limite é por processo (várias réplicas multiplicam a capacidade e o limite de IP, até existir limitador compartilhado).
- Impacto: variáveis `AUTH_HASH_CONCURRENCY` e `AUTH_HASH_QUEUE_LIMIT` (opcionais); novo motivo `service_busy` nas métricas de auth; métricas `auth_hash_*`; `@RateLimit` aceita várias políticas; o filtro de exceções não registra mais o 503 deliberado como `unhandled_exception`.
