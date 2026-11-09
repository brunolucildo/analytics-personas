# XXXX — E-mail transacional atrás de `EmailService`, com provedores por API HTTP

- **Status:** aceito
- **Data:** 2026-11-09

> O prefixo `XXXX` é provisório (spec `0002`); o orquestrador renumera ao integrar.

## Contexto

Cinco fluxos de autenticação (specs 0004, 0006, 0007, 0009 e 0010) enviam e-mail. O solicitante decidiu: Mailtrap fora de produção, Resend em produção, e a escolha escondida atrás de uma abstração. `DEVELOPMENT.md` §5 e §9 exigem timeout, retry limitado e erro tipado em toda integração externa e proíbem teste que dependa de rede externa. A spec deixou em aberto como falar com cada provedor (SMTP, API ou SDK).

## Decisão

`apps/api/src/modules/email` expõe `EmailService` (`send` com retry e timeout; `dispatch` que resolve na hora e nunca rejeita). Três provedores implementam a porta `EmailProvider`, escolhidos por `EMAIL_PROVIDER`: `mailtrap` (Email Sandbox) e `resend` falam com a **API HTTP usando o `fetch` nativo**, sem SDK e sem SMTP; `capture` guarda as mensagens em memória para testes. A política de timeout (5 s por tentativa), retry (3 tentativas, espera de 250 ms e 500 ms, prazo total de 15 s) e logs sem PII vive em `EmailService`, igual para todos os provedores. Produção só aceita `resend`.

## Alternativas consideradas

| Alternativa                                 | Prós                                                     | Contras                                                                                 | Por que não                                                            |
| ------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `nodemailer` por SMTP para o Mailtrap       | Biblioteca madura; SMTP é o caminho "padrão" do Mailtrap | Dependência nova; erro de sessão SMTP é opaco para separar transitório de permanente    | A API HTTP dá o status e dispensa dependência                          |
| SDK `resend` (e SDK do Mailtrap)            | Tipos prontos; menos código                              | Dependência por provedor; retry e timeout próprios brigam com a política única da spec  | `fetch` cobre o caso com ~40 linhas e mantém a política em um só lugar |
| Provedor único (Resend também fora de prod) | Um caminho só                                            | Envia e-mail real de desenvolvimento; contraria a decisão do solicitante                | Decisão do solicitante: Mailtrap fora de produção                      |
| Inbucket/Mailpit do Supabase local          | Sem conta externa                                        | Fora do escopo por decisão do solicitante                                               | Decisão do solicitante                                                 |
| **API HTTP com `fetch`, política central**  | Zero dependência; transporte falso trivial no teste      | Formato das APIs mantido por nós; sem verificação contra o serviço real sem credenciais | **Escolhida**                                                          |

## Consequências

- Positivas: nenhuma dependência nova; um único ponto de saída de e-mail; troca de provedor por configuração; teste de contrato sem rede (`fetch` injetado); logs só com `event`, provedor, `purpose`, duração, tentativas e código de erro.
- Negativas: o formato das requisições ao Mailtrap e ao Resend é nosso e só foi verificado por teste de contrato; a verificação contra o Mailtrap real fica manual (`QA.md`) e a do Resend, no teste de fumaça em staging; sem outbox, e-mail em andamento se perde se o processo cair (aceito; mitigado por reenvio nas specs 0006 e 0009; `drain()` roda no desligamento gracioso).
- Impacto em código, operação e time: novas variáveis obrigatórias na API (`EMAIL_PROVIDER`, `EMAIL_FROM` e as credenciais do provedor); `.env` antigos precisam delas para a API subir; a API não sobe com `capture` ou `mailtrap` em produção; a rota `GET/DELETE /api/v1/test-support/emails` só responde com `capture` (404 nos demais). Casos de uso importam apenas de `modules/email` (barrel `index.ts`), chamam `dispatch` depois do commit e montam o corpo com `renderEmailLayout` e a tag `html`, que escapa conteúdo dinâmico.
