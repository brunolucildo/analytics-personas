# Plano — Teste de carga da API com k6

- **Status:** pronto para implementar (implementado em 2026-11-10; ver spec para o relatório do `stress`)
- **Slug:** 0014-load-testing-k6
- **Spec:** `.specs/0014-load-testing-k6.md`
- **Data:** 2026-11-10

## Contexto

O dashboard de observabilidade precisa de volume de dados e a API nunca recebeu carga. O `.env` de dev aponta para um Supabase hospedado, e o limitador barra qualquer carga vinda de um único IP.

## Objetivo

Estressar todos os endpoints atuais com k6, de forma repetível e segura, gerando dados para o dashboard e um relatório de capacidade.

## Não-objetivos

Carga na API de dev ou em banco hospedado, endpoints futuros, CI, SLO, tuning da API, provedor de e-mail real.

## Usuários e permissões

Quem opera a API. Só dados sintéticos (`k6-*@example.test`) no Supabase local; nenhum dado pessoal real. O runner apaga as contas ao fim.

## Fluxos e estados

Caminho feliz: runner compila e sobe a API isolada, roda o k6, apaga as contas e derruba a API. Erro: Supabase não local, porta ocupada, Mimir fora ou API que não sobe abortam antes do tráfego. Cancelamento: Ctrl+C limpa. Retry: leitura do e-mail capturado até 10 vezes.

## Requisitos

| ID  | Requisito                                         | Prioridade | Critério de aceite                                          |
| --- | ------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| R1  | Todo endpoint atual com cenário e status esperado | Must       | Given `smoke`, Then todos os checks passam.                 |
| R2  | Nunca API de dev nem banco hospedado              | Must       | Given host não local ou porta ocupada, Then recusa.         |
| R3  | Fluxo completo de auth sob carga                  | Must       | Given `load`, Then `flow_success` ≥ 95%.                    |
| R4  | Limitador exercitado, demais clientes livres      | Must       | Given `load`, Then há 429 e 0 falha inesperada.             |
| R5  | Limpeza das contas e da API, inclusive com Ctrl+C | Must       | Given qualquer perfil, Then 0 contas `k6-*` no banco local. |
| R6  | Perfis smoke, load, stress com limites            | Must       | Given cada perfil, Then o resumo traz os limites.           |
| R7  | Métricas do k6 no Mimir e seção no dashboard      | Must       | Given uma execução, Then a seção mostra dados.              |
| R8  | Docs e ADR                                        | Must       | Given os docs, Then constam.                                |
| R9  | Relatório de capacidade                           | Should     | Given `stress`, Then a spec registra o ponto de degradação. |

## Contratos de dados

Métricas `k6_*` no Mimir com `testid`, `endpoint`, `scenario`, `status` (valores fixos). Resumo JSON por execução em `load/results/` (ignorado pelo git). Contas `k6-<run>-<cenário>-<vu>-<iteração>@example.test`, removidas ao fim. Sem PII.

## Integrações

Supabase local (leitura de `supabase status`), Mimir (remote write em `localhost:9009`), API isolada na porta 3013. Falha de qualquer um aborta antes do tráfego.

## Decisões e premissas

- Decisão: k6 contra API isolada (ADR 0012), instalado com winget.
- Decisão: IPs sintéticos por `X-Forwarded-For` com `TRUST_PROXY=true`, em vez de afrouxar o limitador.
- Decisão: e-mail capturado (`test-support`) para fechar o fluxo de confirmação e reset.
- Premissa: limites de p95 são ponto de partida.
- Dúvida em aberto: CI (spec §11).

## Abordagem

1. Helpers (`client.js`): chamada com tag de endpoint, IP sintético, token do e-mail capturado.
2. Cenários (`scenarios.js`) e perfis e limites (`main.js`).
3. Runner (`scripts/load-test.ts`) e script `load` no `package.json`.
4. Seção do dashboard e teste de assets.
5. Executar smoke, load e stress; conferir no dashboard e contra o resumo do k6.
6. Docs e ADR.

## Arquivos previstos

- `load/k6/main.js`, `load/k6/lib/client.js`, `load/k6/lib/scenarios.js` — cenários.
- `scripts/load-test.ts`, `package.json` — runner e script.
- `.gitignore` — `load/results`.
- `infra/grafana/dashboards/api-observability.json`, `apps/api/src/observability/grafana-assets.spec.ts` — dashboard.
- `.docs/QA.md`, `.adrs/0012-teste-de-carga-com-k6.md` — docs.

## Testes

- Unitário: `grafana-assets.spec.ts` (a seção k6 e suas métricas).
- Integração: n/a.
- E2E: n/a.
- Manual: `bun run load smoke|load|stress` e conferência no dashboard.

## Riscos e rollback

- Risco: carga no banco hospedado. Mitigação: runner local-only.
- Risco: máquina compartilhada entre API e k6. Mitigação: documentado.
- Reverter: apagar `load/`, `scripts/load-test.ts` e o script `load`.

## Critério de pronto

- [x] smoke e load verdes
- [x] contas limpas
- [x] métricas e seção no dashboard
- [x] docs e ADR
- [ ] relatório do stress na spec

## Perguntas abertas

| Pergunta                      | Impacto                                | Bloqueante? | Quem decide |
| ----------------------------- | -------------------------------------- | ----------- | ----------- |
| Rodar o teste de carga em CI? | Exige Supabase local e Collector no CI | Não         | Owner       |
