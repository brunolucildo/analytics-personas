# Plano — Alertas da API, de auth, das dependências e do Postgres

- **Status:** pronto para implementar (implementado em 2026-11-10; ver spec para o que falta verificar)
- **Slug:** 0012-api-alerts
- **Spec:** `.specs/0012-api-alerts.md`
- **Data:** 2026-11-10

## Contexto

O dashboard mostra o que acontece, mas nada avisa. O Grafana local não tinha regras, contact points nem políticas. Regras criadas pela interface ou pela API se perdem ao recriar o volume.

## Objetivo

18 regras de alerta versionadas e saudáveis, na pasta "Rondo", cobrindo API, auth, dependências e Postgres.

## Não-objetivos

Contact points e canais, SLOs, on-call, calibragem de produção.

## Usuários e permissões

Só quem opera a API. Nenhuma regra usa dado pessoal; consultas e anotações trazem apenas contagens, taxas e durações.

## Fluxos e estados

Caminho feliz: o Grafana carrega o YAML ao iniciar e avalia a cada minuto. Vazio: nada disparando. Erro: consulta que falha vira estado `Error`. Sem dados: normal (`OK`), exceto `absent_over_time`.

## Requisitos

| ID  | Requisito                                              | Prioridade | Critério de aceite                                           |
| --- | ------------------------------------------------------ | ---------- | ------------------------------------------------------------ |
| R1  | 18 regras em `rondo-alerts.yaml`, 4 grupos             | Must       | Given o Grafana iniciado, When listo, Then 18 com `ok`.      |
| R2  | Eventos raros por logs; `absent_over_time` para parada | Must       | Given a API parada 3 min, Then "API sem telemetria" dispara. |
| R3  | Consultas sem erro                                     | Must       | Given o arquivo, When executo cada A, Then sem erro.         |
| R4  | Teste do arquivo                                       | Must       | Given `bun run test`, Then passa.                            |
| R5  | Docs                                                   | Must       | Given os docs, Then constam catálogo e reinício.             |

## Contratos de dados

Entrada: métricas `http_server_*`, `http_client_*`, `auth_*`, `db_client_*`, `nodejs_*`, `postgresql_*` (Mimir) e logs com `event`, `res_statusCode`, `operation`, `outcome`, `reason` (Loki). Saída: estado das regras no Grafana. Sem PII, sem retenção própria.

## Integrações

Mimir e Loki por datasource provisionado (`mimir`, `loki`). Falha: estado `Error` da regra.

## Decisões e premissas

- Decisão: regras como código (YAML provisionado), não pela API.
- Decisão: eventos raros contam logs, porque `increase()` perde o primeiro evento de uma série nova.
- Premissa: limites iniciais, calibrar com tráfego real.
- Dúvida em aberto: canal de notificação (spec 0012 §11).

## Abordagem

1. Descrever as regras (uid, título, grupo, `for`, severidade, consulta, limiar) e gerar o YAML.
2. Rodar a consulta A de cada regra contra Mimir e Loki.
3. Testar o arquivo em `grafana-assets.spec.ts`.
4. Reiniciar o Grafana e conferir `health` e estado pela API.
5. Atualizar `ARCHITECTURE.md` §4.4 e `QA.md`.

## Arquivos previstos

- `infra/grafana/provisioning/alerting/rondo-alerts.yaml` — as regras.
- `apps/api/src/observability/grafana-assets.spec.ts` — teste do arquivo.
- `.docs/ARCHITECTURE.md`, `.docs/QA.md` — catálogo e roteiro.

## Testes

- Unitário: `grafana-assets.spec.ts` (estrutura do YAML).
- Integração: n/a.
- E2E: n/a.
- Manual: reiniciar o Grafana, listar regras, parar a API e ver "API sem telemetria".

## Riscos e rollback

- Risco: falso positivo ou silêncio por limites sem calibragem. Rollback: ajustar o YAML.
- Reverter: apagar o YAML e reiniciar o Grafana.

## Critério de pronto

- [x] 18 regras `ok`
- [x] consultas sem erro
- [x] teste passando
- [x] docs
- [ ] ver um disparo real
- [ ] canal de notificação

## Perguntas abertas

| Pergunta                                 | Impacto                        | Bloqueante? | Quem decide |
| ---------------------------------------- | ------------------------------ | ----------- | ----------- |
| Quem recebe os alertas e por qual canal? | Só a interface mostra o estado | Não         | Owner       |
