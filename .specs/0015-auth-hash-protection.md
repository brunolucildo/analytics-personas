# 0015 — Proteção do hash de senha: limite de hashes simultâneos e limite de sign-in por IP

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** concluída em 2026-11-10 (testes e medição sob carga verdes; pendente conferir o E2E, que não roda neste ambiente)
- **Slug:** 0015-auth-hash-protection
- **Data:** 2026-11-10
- **Atualizado em:** 2026-11-10
- **Owner:** Time de engenharia
- **Relacionados:** 0014 §14 (investigação do gargalo, origem desta spec), 0003 (limite de requisições), 0007 (sign-in), 0011 e 0013 (observabilidade), ADR 0005 (limitador em memória), ADR 0013 (esta decisão). **Depende de:** 0003, 0004, 0007, 0010. **Destrava:** calibragem dos parâmetros do argon2 (decisão separada) e limitador compartilhado.

## 1. Escopo

### Dentro do escopo

- **Limite de hashes simultâneos** (`HashLimiter`): toda operação argon2 (hash no sign-up e no reset, verificação no sign-in, inclusive a de e-mail inexistente) passa por um limitador com concorrência máxima, fila **limitada** e resposta **503** quando a fila enche.
- **Limite de sign-in por IP independente do e-mail** (`sign-in-ip`), além do atual por IP e e-mail; o decorator `@RateLimit` passa a aceitar mais de uma política.
- Telemetria da fila (espera, ocupação, rejeições), novo motivo `service_busy` nas métricas de auth, painéis no dashboard e uma regra de alerta.
- Testes (unitários, integração e sob carga) e documentação.

### Fora do escopo

- Mudar os parâmetros do argon2 (64 MiB, 3 passes, 4 lanes): é decisão de segurança do Owner; os números medidos estão em `0014` §14.
- Limitador compartilhado entre réplicas (Redis) e o despejo de chaves no teto de 10.000 do store em memória.
- Tirar a verificação do JWT do pool de threads do libuv (a fila deixa de afetá-la com este limite).
- Limites por IP nas demais rotas e proteção contra envio de e-mails em massa por `forgot-password`.

## 2. Contexto

O teste de carga mostrou (spec 0014 §14): o argon2id com os parâmetros atuais tem teto de **~33 hashes/s** na máquina de desenvolvimento, independente da concorrência; os hashes enchem o pool de 4 threads do libuv e tudo que depende do pool (verificação do JWT, `randomBytes`, `fetch` ao PostgREST) espera na mesma fila: `jwtVerify` foi de 0,3 ms para 1.252 ms, e o `session` chegou a p95 de 12,8 s com o event loop saudável. Limitar os hashes a 3 simultâneos (pool menos 1) derrubou o `jwtVerify` de 530 ms para 1 ms perdendo 4% de vazão de hash.

Além disso, o limite de sign-in é por IP **e** e-mail: um IP que troca de e-mail a cada tentativa nunca é barrado (4.040 tentativas, 0 respostas 429), e cada tentativa custa um hash. Um único cliente satura a API a ~33 req/s.

## 3. Necessidade de negócio

| Item                     | Descrição                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Usuário/papel afetado    | Quem entra no sistema e quem opera a API.                                                                       |
| Decisão ou ação que muda | A API recusa rápido (503 ou 429) em vez de travar todo mundo por 13 s quando o hash satura ou um IP abusa.      |
| Resultado esperado       | Sob hash saturado, as rotas que não dependem de hash seguem rápidas; um IP só não esgota a capacidade de login. |
| Métrica de sucesso       | `session` com p95 em milissegundos enquanto o login é saturado; 429 para um IP que gira e-mails.                |

## 4. Requisitos

| ID  | Requisito                                                                                                                                                                                                                                                | Prioridade | Critério de aceite                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `HashLimiter` limita as operações argon2 em voo a `AUTH_HASH_CONCURRENCY` (padrão: tamanho do pool menos 1, mínimo 1; o pool vem de `UV_THREADPOOL_SIZE`, padrão 4) e enfileira o excedente em ordem de chegada até `AUTH_HASH_QUEUE_LIMIT` (padrão 64). | Must       | Given concorrência 3 e 10 hashes pedidos juntos, When rodam, Then no máximo 3 estão em execução ao mesmo tempo e os demais começam em ordem; uma falha libera a vaga.     |
| R2  | Com a fila cheia, a operação **não é executada** e a resposta é **503** `SERVICE_BUSY` com `Retry-After` e o envelope de erro padrão. Isso não é uma exceção não tratada (sem log `unhandled_exception`).                                                | Must       | Given fila cheia, When chega sign-in, sign-up ou reset, Then 503 com `Retry-After` e corpo `SERVICE_BUSY`; nenhum hash foi iniciado; nenhum `unhandled_exception` no log. |
| R3  | Toda chamada ao argon2 passa pelo limitador: `hash` (sign-up, reset) e `verify` (sign-in, incluindo o hash fantasma do e-mail inexistente).                                                                                                              | Must       | Given os adaptadores argon2, When executam, Then cada chamada à biblioteca ocorre dentro do limitador (teste com um limitador espião).                                    |
| R4  | `service_busy` entra no conjunto fechado de `reason` das métricas de auth (derivado do `code` `SERVICE_BUSY`); contador e log `auth_operation` seguem a regra existente.                                                                                 | Must       | Given um 503 por fila cheia, When consulto o contador, Then há `reason="service_busy"`; `AUTH_FAILURE_REASONS` e os testes do conjunto fechado incluem o motivo.          |
| R5  | Telemetria da fila: histograma `auth.hash.queue.wait` (s), gauges `auth.hash.active` e `auth.hash.queued`, contador `auth.hash.rejected`; nenhum rótulo com valor do cliente.                                                                            | Must       | Given tráfego de login, When consulto o Mimir, Then as quatro métricas existem sem labels de cliente.                                                                     |
| R6  | Política `sign-in-ip` (60 por 10 min por IP, sem e-mail) aplicada ao sign-in **antes** da política por IP e e-mail; `@RateLimit` aceita várias políticas e a primeira que estoura responde 429 com `Retry-After` e log `rate_limited` da política.       | Must       | Given 61 sign-ins do mesmo IP com e-mails diferentes, When envio, Then o 61º recebe 429; o limite por IP e e-mail continua valendo; rotas com uma política só não mudam.  |
| R7  | Sob hash saturado, rotas que não usam hash continuam rápidas.                                                                                                                                                                                            | Must       | Given `browse` junto com login inválido saturando (perfil `capacity`), When termino, Then o p95 do `session` fica na casa de centenas de ms, contra 12,8 s antes.         |
| R8  | Dashboard com a fila de hashes e as rejeições, regra de alerta para `service_busy`, e documentação (`ARCHITECTURE.md` §4.4, `DEVELOPMENT.md`, `QA.md`) e ADR 0013.                                                                                       | Must       | Given os docs e o dashboard, When leio, Then constam as variáveis, o 503, o motivo novo e os painéis.                                                                     |
| R9  | Testes unitários do limitador, do filtro de exceções e do guard com várias políticas, e de integração do sign-in por IP.                                                                                                                                 | Must       | Given `bun run test` e `bun run test:integration`, When executados, Then passam.                                                                                          |

## 5. Fluxos e estados

- **Caminho feliz:** o hash começa na hora se há vaga; senão espera na fila (em ordem) e começa quando uma vaga abre.
- **Fila cheia:** sign-in, sign-up e reset respondem 503 `SERVICE_BUSY` com `Retry-After` (estimado pela espera média e pela fila); a conta e o banco não são tocados por essa tentativa de hash.
- **Falha do hash:** o erro original sobe e a vaga é liberada.
- **IP acima do limite de sign-in:** 429 `RATE_LIMITED` com `Retry-After`, sem custo de hash nem de banco.
- **Ordem no sign-in:** a política por IP é avaliada primeiro; só depois a por IP e e-mail.
- **Vazio:** sem tráfego de login as métricas da fila ficam em zero.

## 6. Acceptance Criteria

- [x] Given concorrência 3 e 10 hashes simultâneos, When rodam, Then no máximo 3 em execução e ordem preservada. (R1, `hash-limiter.spec.ts`)
- [x] Given a fila cheia, When chega um login, Then 503 `SERVICE_BUSY` com `Retry-After` e nenhum `unhandled_exception`. (R2, integração com sign-in, sign-up e reset; sign-up não cria a conta)
- [x] Given os adaptadores argon2, When executam, Then passam pelo limitador. (R3, inclusive o hash fantasma, que não fica preso quando é recusado)
- [x] Given um 503 por fila cheia, When consulto o contador de auth, Then há `reason="service_busy"`. (R4)
- [x] Given tráfego de login, When consulto o Mimir, Then as métricas `auth_hash_*` existem. (R5, os painéis executam com dados)
- [x] Given 61 sign-ins de um IP com e-mails diferentes, When envio, Then o 61º recebe 429. (R6, integração e carga: 60 passam e 7.454 seguintes recebem 429)
- [x] Given `browse` junto com login saturando, When termino, Then o p95 do `session` é de centenas de ms. (R7, 196 ms contra 12.796 ms)
- [x] Given os docs e o dashboard, When leio, Then constam variáveis, 503 e painéis. (R8)
- [x] Given os gates, When executo, Then passam. (R9, 431 unitários e 225 de integração)

## 7. O que fazer

1. Criar `ServiceBusyException` (503), tratá-la no filtro (cabeçalho `Retry-After`, sem log de erro) e acrescentar `service_busy` ao conjunto de motivos.
2. Criar `HashLimiter` com fila limitada e telemetria; ler `AUTH_HASH_CONCURRENCY` e `AUTH_HASH_QUEUE_LIMIT` em `config/environment.ts`; ligar o limitador aos adaptadores argon2 no `auth.module`.
3. Fazer `@RateLimit` aceitar várias políticas, o guard avaliá-las em ordem e criar a política `sign-in-ip`; aplicá-la ao sign-in.
4. Testes, painéis, alerta e documentação; rodar os gates e o teste sob carga.

## 8. O que não fazer

- Não mudar os parâmetros do argon2 nem o custo do hash do e-mail inexistente (a resposta continua a mesma).
- Não colocar IP, e-mail ou chave do limitador em log, label ou atributo.
- Não deixar a fila ilimitada: ela é a proteção de memória e de latência.
- Não registrar o 503 deliberado como exceção não tratada.
- Não alterar o contrato dos endpoints além do novo 503 e do 429 por IP.

## 9. Riscos e dependências

| Tipo  | Descrição                                                                          | Mitigação                                                                                                    |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Risco | 60 sign-ins por 10 min por IP pode barrar um escritório inteiro atrás do mesmo IP. | Valor único em `rate-limit.policies.ts`; calibrar com dados de produção.                                     |
| Risco | Fila de 64 e concorrência 3 podem ser conservadoras ou frouxas em outra máquina.   | Variáveis de ambiente; métricas da fila para calibrar.                                                       |
| Risco | O 503 aparece no sign-up e no reset, que antes só falhavam por lentidão.           | Envelope padrão e `Retry-After`; o front pode tratar o código `SERVICE_BUSY`.                                |
| Risco | A verificação do JWT continua usando o pool de threads.                            | Com a concorrência de hash menor que o pool, sobra thread livre (medido: 1 ms).                              |
| Risco | Testes de integração e E2E fazem muitos sign-ins do mesmo IP.                      | Os testes já zeram o store a cada caso; conferir o E2E depois (não roda neste ambiente por apontar à nuvem). |

## 10. Resultado

- **Comando/verificação:** `bun run lint`, `bun run check-types`, `bun run test`, `bun run test:integration`; `bun run load capacity --only=browse,invalidCredentials` antes e depois; um IP real girando e-mails recebe 429.
- **Evidência esperada:** p95 do `session` de centenas de ms sob login saturado; 503 e 429 com `Retry-After`; métricas `auth_hash_*` no Mimir.
- **Comportamento observável:** o login saturado devolve 503 rápido e o resto da API não sente.

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                                         | Impacto                                  | Bloqueante? | Quem decide |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------- | ----------- |
| **Premissa:** o limite por IP de sign-in é 60 por 10 min; a concorrência é pool menos 1 e a fila é 64.    | Valores calibráveis sem mudar o código.  | Não         | Engenharia  |
| **Premissa:** 503 (e não 429) para a fila cheia, porque a causa é capacidade do servidor e não o cliente. | O front trata `SERVICE_BUSY` à parte.    | Não         | Engenharia  |
| Reduzir o custo do argon2 (parâmetros)?                                                                   | Multiplica o teto de hashes por segundo. | Não         | Owner       |

## 12. Refinamento

| Data       | O que mudou                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Motivo                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 2026-11-10 | Implementada e medida. Mesma carga (`browse` + login inválido saturando): `session` p95 de 12.796 ms para **196 ms**, `sign-in` p95 de 13.127 para 2.574 ms (limitado pela fila), vazão de 99 para **420 req/s**, iterações descartadas de 3.587 para 39; sob a saturação, 4.197 logins recusados com 503 e 3.278 atendidos. Um IP real trocando de e-mail: 60 passaram e **7.454 receberam 429** (antes: 4.040 sem nenhum 429). O `rate-limit.int-spec` montava o ambiente à mão e precisou das duas variáveis novas. | Fechar as recomendações 1 e 2 da investigação (0014 §14).              |
| 2026-11-10 | Spec criada a partir da investigação do gargalo (0014 §14).                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Proteger o hash e o login legítimo contra saturação por um só cliente. |
