# 0016 — Instrumentação do Postgres no Pool e pelo receiver do Collector

- **Status:** aceito
- **Data:** 2026-11-12
- **Substitui:** [0011](0011-instrumentacao-do-postgres.md)

## Contexto

O ADR 0011 instrumentava o `fetch` do `supabase-js`: o alvo da operação vinha do **path** do PostgREST, para nunca ler a query string, que carregava e-mail e `sid`. Com `pg` não há HTTP: a API envia texto SQL e parâmetros, e ambos podem conter dado pessoal (e-mail, hash de senha, hash de token, `sid`). Instrumentações genéricas do `pg` registram o SQL em `db.statement`. É preciso manter o mesmo contrato de telemetria (métrica, span, atributos, log de falha) sem que o SQL ou os valores entrem em span, métrica ou log.

## Decisão

Instrumentar o banco em dois pontos, como antes:

1. **No Pool, por um wrapper próprio.** `createDatabaseClient(pool)` expõe `query(call, text, values)`, em que `call` é declarado **pelo repositório**: `operation` (`select`, `insert`, `update`, `delete`, `rpc`, `other`) e `collection` (tabela) ou `procedure` (função SQL). O wrapper nunca interpreta o SQL nem os parâmetros. Cada chamada gera 1 ponto em `db.client.operation.duration` e 1 span `<operation> <alvo>` com `db.system.name=postgresql`, `db.operation.name` e `db.collection.name` ou `db.stored_procedure.name`. Nome fora de `[a-z_][a-z0-9_]{0,62}` vira `unknown`. `error.type` é o SQLSTATE ou `connection`. Span `ERROR` e o log `db_operation_failed` só em falha de infraestrutura (sem SQLSTATE, ou classes `08`, `53`, `57`, `58`); violações de negócio (`23*`, `22*`) ficam fora da taxa de erro. Nunca há `db.statement`, texto de SQL, parâmetros, e-mail, `sid` ou IP.
2. **No Collector, pelo receiver `postgresql`.** Coleta conexões, transações, locks, cache e tamanho do serviço `postgres` do Compose como `rondo_app` (com `pg_monitor`, que só dá acesso a views de estatística). `infra:up` deriva endpoint, usuário e senha de `DATABASE_URL`, reescrevendo host local para `postgres`.

Os repositórios dependem da interface estreita `DatabaseClient`, não do Pool, para que toda query passe pela instrumentação e os testes unitários usem um fake.

## Alternativas consideradas

| Alternativa                                         | Prós                                   | Contras                                                                      | Por que não                                                   |
| --------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `@opentelemetry/instrumentation-pg`                 | Pronta, spans e métricas de pool       | Grava o SQL e, conforme a versão, parâmetros; exige hooks para apagar        | O texto de SQL é o risco de PII; o contrato exige metadados explícitos |
| Inferir tabela/função do texto SQL                  | Repositórios sem metadado              | Parser frágil e leitura do SQL que queremos evitar                           | Quem sabe o alvo é o repositório                              |
| Instrumentar cada repositório                       | Controle por método                    | Seis cópias, fácil esquecer uma nova, mistura telemetria com acesso a dados  | Um wrapper cobre todos, inclusive os futuros                  |
| `pg_stat_statements` e texto de query               | Queries lentas por texto               | O texto pode conter valores; exige ofuscação                                 | Risco de PII; segue no backlog com ofuscação                  |
| Processador de spans que apaga atributos no `onEnd` | Cobre qualquer instrumentação          | Muta um span já encerrado, preso a detalhe interno do SDK                    | O wrapper evita gravar o dado em vez de apagar depois         |

## Consequências

- Positivas: nomes de métrica, span e atributos do dashboard e dos alertas se mantêm (só o HTTP do Supabase sai); nenhuma instrumentação lê SQL ou parâmetros; o alvo de cada operação é explícito e revisável; o servidor Postgres continua visível no Mimir.
- Negativas: todo repositório novo precisa declarar `operation` e o alvo (esquecer vira `unknown`, visível no painel); uma query feita direto no Pool, fora de `DatabaseClient`, não é medida; a duração inclui a espera por uma conexão do Pool; as métricas do servidor são do banco apontado por `DATABASE_URL` só quando ele é o do Compose.
- Impacto: regra em `DEVELOPMENT.md` §7 (toda query passa por `DatabaseClient`, sem SQL ou valores em telemetria); `auth-observability.int-spec.ts` guarda sentinelas de PII; `grafana-assets.spec.ts` proíbe atributos de PII e referências ao Supabase; o dashboard usa `error.type` (SQLSTATE) em vez de status HTTP.
