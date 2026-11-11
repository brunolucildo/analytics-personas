# 0014 — Request handler por endpoint, um caso de uso por fluxo

- **Status:** aceito
- **Data:** 2026-11-11

## Contexto

As fatias da API seguem as quatro camadas (`domain`, `application`, `infrastructure`, `interface`), mas a camada `interface` agrupava vários endpoints num único controller. O `AuthController` tinha 8 rotas e injetava 7 casos de uso; o controller de `test-support/emails` tinha 2 rotas e falava direto com o `CapturedEmailStore` (infraestrutura). O guard de `rate-limit` decidia o limite e calculava o `Retry-After` dentro da borda HTTP, e o módulo não tinha camada nenhuma. Também havia vazamentos entre camadas: o `HashLimiter` (infraestrutura) lançava `ServiceBusyException` (status 503), os casos de uso recebiam uma função de hash de token em vez de um port, e o barrel público de `email` exportava helpers de captura.

Controllers com vários endpoints e várias dependências crescem sem limite, misturam o tratamento de erro de fluxos diferentes e dificultam testar e revisar um fluxo isolado.

## Decisão

Cada endpoint HTTP tem **uma classe de request handler** (`interface/request-handlers/<fluxo>.request-handler.ts`) que injeta **exatamente um** caso de uso (`application/use-cases/<fluxo>.use-case.ts`, uma classe, um `execute`). O vínculo é 1:1: dois endpoints que precisam do mesmo comportamento usam dois casos de uso, ou uma parte comum extraída para um serviço de capacidade em `application/services/`. O handler só declara a rota e os decorators de borda, recebe o DTO, chama o caso de uso, traduz erros de domínio em `ApiException` e apresenta a resposta com um presenter. Erros de infraestrutura que viram status HTTP (como a fila de hash cheia) passam por um erro tipado do domínio e são mapeados na interface.

## Alternativas consideradas

| Alternativa                                       | Prós                                   | Contras                                                                         | Por que não                                                     |
| ------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Um controller por domínio (estado anterior)       | Menos arquivos                         | Classe cresce com cada rota; muitas injeções; erros de fluxos diferentes juntos | É o que gerou as violações da auditoria                         |
| Controller fino que chama um service orquestrador | Um ponto de entrada por domínio        | O service vira o novo controller grande; esconde qual fluxo cada rota executa   | Só move o problema de camada                                    |
| Um caso de uso compartilhado por vários handlers  | Menos classes                          | Acopla endpoints; o caso de uso passa a conhecer variações de borda             | Quebra o 1:1; extrair serviço de capacidade resolve sem acoplar |
| Manter exceções por módulo pequeno                | Sem trabalho em `email` e `rate-limit` | `test-support/emails` e `rate-limit` já tinham regra e adaptador misturados     | Exceção sem justificativa técnica vira regra                    |

## Consequências

- Positivas: cada fluxo é revisado, testado e alterado isoladamente; a injeção fica explícita (um caso de uso por handler); a infraestrutura deixa de conhecer HTTP; `rate-limit` ganha caso de uso (`CheckRateLimit`) com decisão pura no domínio; o módulo Nest lista todos os handlers em `controllers`.
- Negativas: mais arquivos (8 handlers em `auth`, 2 em `email`) e mais ligação no módulo; o mapeamento de um erro compartilhado (a fila de hash cheia) se repete nos 3 handlers que fazem hash; o namespace da chave de rate limit passa de `AuthController.<método>` para `<Handler>.handle`, então os contadores em memória reiniciam no deploy (sem mudança de contrato HTTP).
- Impacto em código, operação e time: sem mudança de rotas, status, DTOs, envelope de erro, telemetria, políticas, SQL ou e-mail; `GET /api/v1/auth/session` ganha o caso de uso `GetSession`; `MIN_JWT_SECRET_LENGTH` vai para `apps/api/src/config/auth-secret.ts`; os helpers de captura de e-mail saem do barrel público para `modules/email/testing/index.ts`; `SessionService` e `EmailService` ficam como serviços de capacidade (exceções conhecidas da auditoria `audit-slices.mjs`, junto de `renderEmailLayout`). Endpoint novo segue o padrão: um handler, um caso de uso, um DTO e um presenter.
