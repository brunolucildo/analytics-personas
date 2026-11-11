# 0012 — Alertas da API, de auth, das dependências e do Postgres

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** em implementação (regras provisionadas e saudáveis em 2026-11-10; pendente: ver uma regra disparar de verdade e definir o canal de notificação)
- **Slug:** 0012-api-alerts
- **Data:** 2026-11-10
- **Atualizado em:** 2026-11-10
- **Owner:** Time de engenharia
- **Relacionados:** 0011 (observabilidade da API; deixou alertas e SLOs no backlog), 0013 (instrumentação do Postgres, que alimenta as regras de banco), `.docs/ARCHITECTURE.md` §4.4, `.docs/QA.md`. **Depende de:** 0011 e 0013. **Destrava:** SLOs e on-call (backlog).

## 1. Escopo

### Dentro do escopo

- Regras de alerta do Grafana **como código** em `infra/grafana/provisioning/alerting/rondo-alerts.yaml`, na pasta "Rondo": API (disponibilidade, 5xx, latência, event loop), auth (credenciais inválidas, limite de requisições, sucesso do sign-in, e-mail), dependências (Supabase) e Postgres (falha de operação, lentidão, conexões, deadlock, cache, banco fora).
- Teste automatizado que valida o arquivo (uids únicos, datasources conhecidos, severidade, período de espera).
- Documentação do catálogo de regras e de como alterá-las.

### Fora do escopo

- Contact points, políticas de notificação, silêncios, on-call e canais (e-mail, Slack, webhook): dependem de uma decisão de quem recebe.
- SLOs e burn rate.
- Alertas de produção: os limites são pontos de partida para o ambiente local e precisam de calibragem com tráfego real.

## 2. Contexto

Depois da spec 0011, o dashboard mostra o que acontece, mas ninguém é avisado. Não existia nenhuma regra, contact point ou política no Grafana (verificado em 2026-11-10). Regras criadas pela interface ou pela API ficam no volume do Grafana e se perdem ao recriá-lo, e o MCP do Grafana grava assim; por isso a fonte de verdade é o arquivo versionado.

Dois fatos de medição moldam as regras:

- **`increase()` e `rate()` sobre contador OTLP perdem o primeiro evento de uma série nova** (o contador nasce no primeiro incremento). Para eventos raros (5xx, falha de banco, falha de e-mail, exceção, 429, falhas de auth) as regras contam **logs do Loki**, que são exatos. As regras de taxa e de latência usam métricas, porque tratam de tráfego contínuo.
- **Ausência de dado é diferente de estar tudo bem.** Sem tráfego ou sem logs, uma consulta volta vazia; isso conta como normal (`noDataState: OK`). A queda real da API ou do Postgres é detectada por `absent_over_time` sobre uma métrica que o processo exporta sempre (event loop, `postgresql_backends`).

## 3. Necessidade de negócio

| Item                     | Descrição                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Usuário/papel afetado    | Quem opera a API (engenharia).                                                                                                    |
| Decisão ou ação que muda | Saber que algo quebrou sem estar olhando o dashboard: API parada, erros 5xx, banco com falha, abuso no login, e-mail sem entrega. |
| Resultado esperado       | 18 regras saudáveis, visíveis no painel "Alertas do Grafana" e em Alerting, versionadas.                                          |
| Métrica de sucesso       | Cada regra avalia sem erro de consulta e muda de estado quando a condição ocorre.                                                 |

## 4. Requisitos

| ID  | Requisito                                                                                                                                                                                                                                                                   | Prioridade | Critério de aceite                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | As regras existem em `rondo-alerts.yaml`, agrupadas em `rondo-api`, `rondo-auth`, `rondo-dependencias` e `rondo-postgres`, com `uid` estável (até 40 caracteres), `severity` (`critical` ou `warning`), período de espera (`for`) e `summary` e `description` em português. | Must       | Given o Grafana iniciado, When listo as regras, Then aparecem as 18, todas com `health: ok`.                                                      |
| R2  | Eventos raros usam contagem de logs (Loki); tráfego contínuo usa métricas (Mimir). `noDataState` é `OK`; "API sem telemetria" e "Postgres sem métricas" usam `absent_over_time`.                                                                                            | Must       | Given a API parada por 3 minutos, When a regra avalia, Then "API sem telemetria" dispara. Given tráfego zero, Then nenhuma regra de taxa dispara. |
| R3  | Nenhuma consulta de regra falha: cada expressão roda contra seu datasource.                                                                                                                                                                                                 | Must       | Given o arquivo gerado, When executo a consulta A de cada regra, Then nenhuma volta com erro.                                                     |
| R4  | Teste automatizado do arquivo: uids e títulos únicos, `uid` com até 40 caracteres, `for`, `severity` e limiar em toda regra, só datasources `mimir`, `loki` e `__expr__`, e presença das regras de API/Postgres parados.                                                    | Must       | Given `bun run test`, When executado, Then passa e falha se uma regra perder o limiar, usar um datasource desconhecido ou duplicar um uid.        |
| R5  | Documentar o catálogo e o fluxo de alteração (editar o YAML, `docker compose restart grafana`).                                                                                                                                                                             | Must       | Given `ARCHITECTURE.md` §4.4 e `QA.md`, When leio, Then constam as regras, a lógica de "sem dados" e o aviso sobre reinício.                      |
| R6  | Contact point e política de notificação provisionados para um canal real.                                                                                                                                                                                                   | Could      | Bloqueado: depende de definir o destinatário (§11).                                                                                               |

## 5. Fluxos e estados

- **Caminho feliz:** o Grafana carrega o YAML na inicialização, avalia cada grupo a cada minuto e mostra o estado em Alerting e no painel "Alertas do Grafana" do dashboard.
- **Vazio:** nenhuma regra disparando é o estado normal; o painel mostra "No alerts".
- **Erro:** consulta que falha vira estado `Error` (`execErrState: Error`) e aparece como alerta de datasource. Mimir ou Loki fora gera esse estado, não "tudo certo".
- **Sem notificação:** sem contact point próprio, a política padrão do Grafana (e-mail sem SMTP) não entrega nada; o estado só aparece na interface.
- **Local:** "API sem telemetria" e "Postgres sem métricas" disparam quando a API ou o Supabase local estão parados. É o comportamento correto, e o ruído é aceito em desenvolvimento.

## 6. Acceptance Criteria

- [x] Given o Grafana reiniciado, When listo as regras, Then aparecem 18 regras em 4 grupos, todas com `health: ok`. (R1)
- [x] Given as 18 consultas, When executo a consulta A de cada uma contra Mimir e Loki, Then nenhuma volta com erro. (R3)
- [x] Given `bun run test`, When executo, Then o teste do arquivo de regras passa. (R4)
- [x] Given os docs atualizados, When leio, Then o catálogo e o aviso de reinício constam. (R5)
- [ ] Given a API parada por 3 minutos, When a regra avalia, Then "API sem telemetria" dispara. (R2)
- [x] Given uma falha real de banco ou um 5xx, When a regra avalia, Then a regra correspondente dispara. (R2, verificado em 2026-11-10: sob o teste de carga dispararam "Erros 5xx sustentados", "Resposta 5xx registrada", "Pico de credenciais inválidas", "Muitos bloqueios por limite", "Taxa de sucesso do sign-in baixa" e "Fila de hashes de senha cheia")

## 7. O que fazer

1. Escrever as regras em `rondo-alerts.yaml` (gerado a partir de uma lista de regras, validado contra os backends).
2. Testar o arquivo (`grafana-assets.spec.ts`).
3. Reiniciar o Grafana e conferir `health` e estado das regras pela API.
4. Documentar em `ARCHITECTURE.md` §4.4 e `QA.md`.

## 8. O que não fazer

- Não criar regras pela interface ou pela API do Grafana: elas somem com o volume.
- Não alertar sobre dado pessoal nem usar e-mail, `userId` ou `sid` em consulta, rótulo ou anotação.
- Não tratar "sem dados" como falha, exceto nos dois `absent_over_time`.
- Não inventar canal de notificação.

## 9. Riscos e dependências

| Tipo        | Descrição                                                                                    | Mitigação                                                                     |
| ----------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Dependência | Regras de banco precisam das métricas e do log da spec 0013.                                 | Entregues juntas; as consultas foram validadas após a spec 0013.              |
| Risco       | Limites calibrados sem tráfego real (5%, 1 s, 80%) geram falso positivo ou silêncio.         | Documentado como ponto de partida; calibrar com dados de produção.            |
| Risco       | Em ambiente local, regras de ausência disparam sempre que a API ou o Supabase estão parados. | Esperado; `for` de 2 minutos evita oscilação.                                 |
| Risco       | Sem contact point, ninguém é avisado de fato.                                                | Pergunta aberta bloqueante para o R6; até lá o estado é visível na interface. |
| Risco       | O Grafana só relê o YAML ao iniciar (bind mount no Docker Desktop do Windows).               | `docker compose restart grafana` documentado.                                 |

## 10. Resultado

- **Comando/verificação:** `docker compose restart grafana`; abrir Alerting > Alert rules (pasta "Rondo"); `bun run test`.
- **Evidência esperada:** 18 regras `ok`; teste verde.
- **Comportamento observável:** regras avaliando a cada minuto e o painel "Alertas do Grafana" listando as que disparam.

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                          | Impacto                                           | Bloqueante?        | Quem decide |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------ | ----------- |
| Quem recebe os alertas e por qual canal (e-mail, Slack, webhook)?                          | Sem isso, só a interface mostra o estado (R6).    | Não (para R1 a R5) | Owner       |
| **Premissa:** limites iniciais (5xx 5%, p95 1 s, event loop 80%, conexões 80%, cache 90%). | Falso positivo ou silêncio até calibrar.          | Não                | Engenharia  |
| **Premissa:** `noDataState: OK` em todas as regras, exceto pelo uso de `absent_over_time`. | Uma consulta quebrada não é confundida com calma. | Não                | Engenharia  |

## 12. Refinamento

| Data       | O que mudou                                                                                                   | Motivo                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 2026-11-10 | A spec 0015 acrescentou a 19ª regra, "Fila de hashes de senha cheia (503)" (Loki, `reason="service_busy"`).   | A fila de hashes passou a recusar com 503 e isso precisa avisar.                |
| 2026-11-10 | Spec criada e implementada: 18 regras provisionadas, `health: ok`; pendente ver disparo real e definir canal. | Fechar o backlog de alertas da 0011 com regras versionadas, sem inventar canal. |
