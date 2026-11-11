# 0012 — Teste de carga com k6 contra uma API isolada

- **Status:** aceito
- **Data:** 2026-11-10

## Contexto

O dashboard de observabilidade precisa de volume de dados real e a API nunca foi submetida a carga. O limitador de requisições (sign-up 5 por hora por IP, sign-in 10 a cada 10 min por IP e e-mail) impediria qualquer teste que viesse de um único IP. O `.env` de desenvolvimento aponta para um projeto Supabase hospedado, então rodar carga na API de dev (porta 3002) criaria milhares de contas no banco da nuvem. Além disso, o fluxo completo de auth (confirmação e reset) depende de links enviados por e-mail.

## Decisão

Usar o **k6** (scripts em JavaScript em `load/k6/`) contra uma **API isolada** que o runner `scripts/load-test.ts` sobe numa porta própria, com Supabase **local**, `EMAIL_PROVIDER=capture` (o k6 lê os links em `GET /api/v1/test-support/emails`) e `TRUST_PROXY=true` (o k6 envia um `X-Forwarded-For` sintético por cliente, então cada um tem a própria cota do limitador). O runner recusa Supabase que não seja local e porta ocupada, apaga as contas `k6-*` ao final e envia as métricas do k6 ao Mimir por remote write para o mesmo dashboard.

## Alternativas consideradas

| Alternativa                               | Prós                     | Contras                                                                                     | Por que não                                                    |
| ----------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Carga na API de dev (3002)                | Nada a subir             | Escreve no banco hospedado do `.env`; o limitador bloqueia tudo depois de 5 sign-ups por IP | Risco de dados na nuvem e teste inútil                         |
| Desligar ou afrouxar o limitador no teste | Mais vazão por IP        | Muda o código ou a configuração sob teste; some o caminho 429 e o custo do limitador        | Preferimos o limitador ligado e IPs sintéticos                 |
| Artillery ou Locust                       | Ferramentas maduras      | Outra linguagem ou runtime; sem integração nativa com o Grafana                             | k6 é do mesmo ecossistema do Grafana e envia métricas ao Mimir |
| Semear usuários direto no banco           | Evita o custo do sign-up | Não exercita o endpoint mais caro (argon2) nem o fluxo real                                 | O objetivo é estressar todos os endpoints                      |
| k6 em Docker                              | Nada instalado no host   | Overhead de rede do Docker Desktop distorce a latência                                      | Instalação nativa (winget) dá medidas mais fiéis               |

## Consequências

- Positivas: todo endpoint atual é exercitado, inclusive 404, preflight, rotas fechadas e o limitador; os dados enchem os painéis de HTTP, auth, banco e runtime; as métricas do k6 ficam no dashboard ao lado das da API; o runner protege o banco hospedado.
- Negativas: API e k6 dividem a máquina, então a saturação medida mistura os dois; os IPs sintéticos só valem com `TRUST_PROXY=true`, que é diferente de uma produção sem proxy; `EMAIL_PROVIDER=capture` não exercita o provedor real; o buffer de 500 e-mails limita a concorrência do fluxo completo.
- Impacto: dependência de desenvolvimento nova, o binário `k6` (instalado fora do repositório, `winget install GrafanaLabs.k6`); script `bun run load [smoke|load|stress]`; pasta `load/` e `load/results` (ignorada pelo git); `QA.md` documenta o uso. Uma mudança na API veio do primeiro teste: `service.instance.id` por processo em `telemetry.ts` (label `instance`), porque duas instâncias da API escreviam nas mesmas séries do Mimir e distorciam as métricas do servidor.
