# 0011 — Instrumentação do Postgres pelo `fetch` do `supabase-js` e pelo receiver do Collector

- **Status:** substituído por [0016](0016-instrumentacao-do-postgres-no-pool.md)
- **Data:** 2026-11-10

## Contexto

A API acessa o Postgres só por `@supabase/supabase-js` com a service role (ADR 0008): cada query vira uma chamada HTTP ao PostgREST, e o SDK do OpenTelemetry só enxergava "GET `*.supabase.co`", sem tabela, função nem operação. O servidor Postgres também não era coletado. Ao inspecionar os spans, os de saída (undici) traziam `url.full` e `url.query` completos, e no PostgREST a query string é o filtro: o Tempo guardava o e-mail do usuário e o id de sessão. Os spans de entrada guardavam o IP do cliente.

## Decisão

Instrumentar o banco em dois pontos: (1) o `fetch` do cliente `supabase-js` (`global.fetch`) abre um span e grava `db.client.operation.duration` por operação e por tabela ou função, derivadas só do **path**, nunca da query string; (2) o OTel Collector coleta o servidor com o receiver `postgresql`. Os hooks da própria biblioteca (`startSpanHook` do undici, `requestHook` do HTTP) sobrescrevem `url.full`, `url.query` e `client.address`.

## Alternativas consideradas

| Alternativa                                         | Prós                                     | Contras                                                                                   | Por que não                                            |
| --------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Instrumentar cada repositório                       | Controle por método                      | Seis repositórios, fácil esquecer um novo, mistura telemetria com regra de acesso a dados | Um ponto só cobre todos, inclusive os futuros          |
| Conexão direta com `pg` e `instrumentation-pg`      | Spans com SQL e métricas de pool prontos | Troca a decisão da ADR 0008; o SQL nos spans pode conter dado pessoal                     | Fora do escopo e contra a decisão vigente              |
| `pg_stat_statements` e texto de query               | Queries lentas por texto                 | O texto pode conter valores; precisa de ofuscação                                         | Risco de PII; fica no backlog com ofuscação            |
| Processador de spans que apaga atributos no `onEnd` | Cobre qualquer instrumentação            | Muta um span já encerrado, dependendo de detalhe interno do SDK                           | Os hooks públicos resolvem o caso sem esse acoplamento |
| Raspar o endpoint de métricas do Supabase hospedado | Cobre o banco na nuvem                   | Exige a service role como credencial de raspagem e rede para o projeto                    | Decisão do Owner pendente (spec 0013 §11)              |

## Consequências

- Positivas: toda operação de banco, atual e futura, ganha span, histograma e log de falha sem alterar repositórios; o servidor Postgres tem conexões, transações, locks, cache e tamanho no Mimir; os spans deixam de levar e-mail, sid e IP; o histograma de auth passa a ter buckets em segundos.
- Negativas: a duração vai até os headers da resposta (o corpo não entra); um cliente `supabase-js` criado fora do `auth.module` sem o `fetch` instrumentado não é medido; as métricas do servidor são do banco **local** mesmo que a API aponte para o hospedado; spans antigos no Tempo ainda têm o dado pessoal até expirarem.
- Impacto: `createInstrumentedFetch()` é obrigatório em todo `createClient` do `supabase-js` na API (regra em `DEVELOPMENT.md` §7); o Collector precisa alcançar o banco (`host.docker.internal:54322`, ajustável por `POSTGRES_ENDPOINT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`); em outro ambiente, use um usuário com o papel `pg_monitor`, não o superusuário.
