# 0010 — Métricas por push OTLP, contadas uma vez no middleware de app

- **Status:** aceito
- **Data:** 2026-11-10

## Contexto

A API já exporta traces, métricas e logs por OTLP HTTP ao Collector, que os repassa a Tempo, Mimir e Loki (`ARCHITECTURE.md` §4.4). A spec `0011` pediu mais observabilidade nos fluxos de auth e levantou duas decisões:

1. **Como as métricas chegam ao Mimir.** A ideia inicial era expor `GET /metrics` no formato Prometheus e fazer o Collector raspá-lo. O caminho OTLP já funciona e já emite `http_server_request_duration_seconds` com método e status.
2. **Onde contar as tentativas de auth.** Validação (400), limite de requisições (429) e guard de sessão (401) respondem em pipe e guards, antes do controller; um contador gravado só no caso de uso não veria essas falhas. Contar em mais de um lugar arriscaria contar duas vezes.

Também foi preciso resolver dois detalhes técnicos: a métrica HTTP não tem `http_route` (a instrumentação do Express 5, `instrumentation-router`, não preenche o metadado RPC que o `instrumentation-http` lê ao fechar a resposta) e os labels não podem carregar PII nem revelar se um e-mail tem conta.

## Decisão

- **Métricas por push OTLP**, sem `GET /metrics` e sem raspagem.
- **Uma contagem por tentativa**, feita por um middleware de app (`auth-telemetry.middleware.ts`) quando a resposta termina, a partir do status e do `code` do erro que o `AllExceptionsFilter` guarda em `response.locals`. O mesmo ponto grava o histograma de duração e o log `auth_operation`.
- **Spans nos controllers** (`traceAuthOperation`), em volta do caso de uso; a camada `application` não muda e não conhece OpenTelemetry.
- **`http_route`** gravado por um middleware registrado primeiro em `configureApp` (antes do CORS), que escreve o template da rota (ou `unmatched`) no metadado RPC no evento `finish`.
- **Labels e atributos de conjuntos fechados** (`operation`, `outcome`, `reason`), sem PII, e o mesmo resultado para e-mail existente e inexistente em `forgot_password` e `resend_confirmation`.
- Dependências diretas novas em `apps/api`, todas já presentes no lockfile na mesma versão: `@opentelemetry/core@3.1.0` (`getRPCMetadata` e `RPCType`) e, só para testes, `@opentelemetry/sdk-trace@3.1.0` e `@opentelemetry/context-async-hooks@3.1.0` (exportadores e provider em memória).

## Alternativas consideradas

| Alternativa                                                                                     | Prós                                              | Contras                                                                                                                                                                      | Por que não                                                                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /metrics` Prometheus raspado pelo Collector                                                | Formato familiar; fácil de inspecionar com `curl` | Segundo caminho de métricas ao lado do OTLP (séries duplicadas ou troca do que funciona); precisa de receiver `prometheus`, rota nova na API e decisão de acesso ao endpoint | O OTLP já cobre o caso e não expõe rota nova; o Owner decidiu manter o push (2026-11-10) |
| Contar no caso de uso (camada `application`)                                                    | Perto da regra de negócio                         | Não vê 400, 429 e 401; acopla a camada ao OpenTelemetry                                                                                                                      | Perde as recusas antes do controller e fere a separação de camadas                       |
| Contar no controller e de novo no filtro de exceções                                            | Cada ponto simples                                | Duas contagens por tentativa e risco de divergência entre elas                                                                                                               | Contagem única no `finish` é mais simples e prova-se por teste                           |
| Interceptor do Nest                                                                             | Idiomático                                        | Roda depois dos guards: não vê 429 nem 401                                                                                                                                   | Mesmo problema do caso de uso                                                            |
| Instrumentar a rota por `view` de métrica do SDK                                                | Sem middleware                                    | Views não adicionam atributos que a instrumentação não emite                                                                                                                 | Não resolve o `http_route` ausente                                                       |
| Esperar uma versão do `instrumentation-http` ou do `instrumentation-router` que preencha a rota | Zero código nosso                                 | Sem prazo; o label de rota continua faltando                                                                                                                                 | Vira upgrade quando existir (ver Consequências)                                          |

## Consequências

- **Positivas:** um único caminho de telemetria; recusas antes do controller aparecem nas métricas e nos logs; casos de uso continuam puros; labels sem PII e sem vazar contas; dashboards e testes travam os nomes.
- **Negativas:** `http_route` depende de um detalhe interno (`rpcMetadata.route`) do `instrumentation-http`. O teste de unidade cobre o contrato do middleware, mas só a verificação com o SDK ligado (roteiro de `QA.md`) prova que o label chega ao Mimir. Se a instrumentação passar a preencher a rota, o middleware vira redundante e deve ser removido.
- **Impacto em código, operação e time:** operação de auth nova exige acrescentar a `AUTH_OPERATIONS` e ao mapa do middleware (`DEVELOPMENT.md` §7); código de erro novo exige entrar em `AUTH_FAILURE_REASONS` e no dashboard; três dependências diretas novas em `apps/api` (sem pacote novo no lockfile).
