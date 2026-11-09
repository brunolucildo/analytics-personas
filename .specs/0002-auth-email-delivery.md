# 0002 — Envio de e-mail transacional (habilitadora)

> Spec executável. Preencha todas as seções; `TODO` é lacuna, não requisito.
> Use `create-spec` para criar, `refine-spec` para auditar e `implement-me` para executar.

- **Status:** rascunho
- **Slug:** 0002-auth-email-delivery
- **Data:** 2026-11-09
- **Atualizado em:** 2026-11-09
- **Owner:** Time de engenharia
- **Relacionados:** `.plans/auth-breakdown.md` (mapa do épico), `.docs/ARCHITECTURE.md` §7 (integração externa: timeout, retry, logs sem PII), `.docs/DEVELOPMENT.md` §5, §7 e §9 (teste não depende de rede externa). **Depende de:** nenhuma. **Destrava:** 0004, 0006, 0007, 0009 e 0010 (todas enviam e-mail).

## 1. Escopo

### Dentro do escopo

- **`EmailService`**: a abstração de envio, com `send` e um `dispatch` que nunca rejeita. Nenhum outro código conhece o provedor.
- **Três provedores atrás dela**, escolhidos por configuração:
  - `mailtrap`: ambientes **non-production** (a mensagem não chega a ninguém; fica na caixa do Mailtrap).
  - `resend`: **produção**.
  - `capture`: **testes automatizados e E2E**; não envia nada, guarda as mensagens em memória para o teste lê-las.
- Configuração validada no boot (`EMAIL_PROVIDER`, `EMAIL_FROM` e as credenciais do provedor escolhido), sem segredo no repositório.
- **Layout base de template** (HTML + texto puro) em en-US, reutilizável pelos e-mails de auth.
- Timeout, retry limitado, erro tipado e logs sem PII.
- Documentação em `.docs/` e `.env.example` (só valores de exemplo).

### Fora do escopo

- Os e-mails em si (conteúdo): confirmação (0004 e 0006), nova sessão (0007), reset (0009), senha alterada (0010).
- Fila, outbox ou retry persistente (backlog).
- Verificação do domínio de envio no Resend (SPF/DKIM) e conta de produção: pré-requisito de infraestrutura antes de publicar (backlog).
- Rastreamento de abertura/clique, anexos, e-mail em massa.
- Limite de envio por destinatário: o 0003 limita as rotas que disparam e-mail.
- Servidor de e-mail local do Supabase (Inbucket/Mailpit): **não é usado** (decisão do solicitante: Mailtrap fora de produção).

## 2. Contexto

A API não tem como enviar e-mail e cinco fluxos de auth dependem disso. O solicitante decidiu: fora de produção a API usa o **Mailtrap**; em produção, o **Resend**; e essa escolha fica escondida atrás do `EmailService`, de modo que casos de uso e templates não saibam qual provedor está ativo.

Como `DEVELOPMENT.md` §9 proíbe teste que dependa de rede externa, os testes automatizados e o E2E usam o provedor `capture`; Mailtrap e Resend são verificados por teste de contrato com transporte falso e por verificação manual.

**Decisões compartilhadas do épico de autenticação** (idênticas em todas as specs; fonte: `.plans/auth-breakdown.md` §2):

- **Identidade:** auth próprio na API (Nest + Postgres); sem Supabase Auth.
- **Sessão:** bearer JWT (`sub`, `sid`, `exp`) no header `Authorization: Bearer <token>`; a API confere o `sid` no banco a cada request. **Sessão única por usuário:** emitir uma nova sessão revoga a anterior. Validade de 7 dias, sem refresh token. O SPA guarda o token no `localStorage` (risco de XSS aceito e registrado).
- **Idioma:** UI, rotas, endpoints, código, mensagens de erro e e-mails em **en-US**; `.docs/`, specs e ADRs seguem em pt-BR.
- **URLs:** páginas públicas em `/auth/*`, privadas em `/app/*`; API em `/api/v1/*` (auth em `/api/v1/auth/*`).
- **Contratos:** JSON em camelCase, colunas em snake_case; erros no envelope `{"error":{"code","message","details"}}` com `code` em `UPPER_SNAKE_CASE`.
- **Credenciais:** senha de 8 a 128 caracteres, sem regras de composição, hash Argon2id; nome e sobrenome de 1 a 100 caracteres após trim; e-mail com trim e minúsculas, único.
- **Tokens de link:** opacos, aleatórios, de uso único, guardados só como hash SHA-256; confirmação expira em 24 h e reset em 1 h.
- **Logs:** nunca registrar senha, token, link, e-mail do destinatário nem IP.
- **Isolamento:** por usuário; clube e workspace ficam fora.

## 3. Necessidade de negócio

| Item                     | Descrição                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Usuário/papel afetado    | Time de engenharia; indiretamente, toda pessoa que recebe e-mail de auth.                                           |
| Decisão ou ação que muda | A API passa a ter um único ponto de saída de e-mail, trocável por configuração, com timeout e retry.                |
| Resultado esperado       | Casos de uso enviam por `EmailService`; em dev a mensagem vai ao Mailtrap, em prod ao Resend, em teste é capturada. |
| Métrica de sucesso       | Testes leem as mensagens capturadas; falha do provedor não derruba nenhum request.                                  |

## 4. Requisitos

| ID  | Requisito                                                                        | Prioridade | Critério de aceite                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `EmailService.send({to, subject, text, html})` com um provedor por configuração. | Must       | Given `EMAIL_PROVIDER` = `mailtrap`, `resend` ou `capture`, When `send`, Then só o provedor escolhido é acionado; casos de uso e templates não importam código de provedor (verificável por import).                                                                                                                                                                                                                                      |
| R2  | Provedores `mailtrap` e `resend` entregam a mensagem corretamente.               | Must       | Given um transporte falso no lugar da rede (teste de contrato, um por provedor), When `send`, Then o provedor recebe remetente igual a `EMAIL_FROM`, destinatário, assunto, texto e HTML sem alteração e uma resposta de sucesso resolve a chamada; uma resposta de erro rejeita com `EmailDeliveryError`. Verificação manual documentada: com credenciais reais do Mailtrap em desenvolvimento, a mensagem aparece na caixa do Mailtrap. |
| R3  | Provedor `capture` para testes.                                                  | Must       | Given `EMAIL_PROVIDER=capture`, When `send`, Then nada sai da máquina e a mensagem fica disponível por um helper de teste (`getCapturedEmails({to})`) e, quando a API roda como processo (E2E), por uma rota de apoio a testes registrada **só** nesse modo; Given `NODE_ENV=production` com `EMAIL_PROVIDER=capture`, Then a API não sobe.                                                                                               |
| R4  | Seleção e configuração validadas no boot.                                        | Must       | Given `EMAIL_PROVIDER` ausente ou fora de `mailtrap                                                                                                                                                                                                                                                                                                                                                                                       | resend | capture`, `EMAIL_FROM`inválido (endereço, com nome opcional) ou credencial do provedor escolhido ausente, When iniciar a API, Then ela não sobe e cita a variável; Given`NODE_ENV=production`com provedor diferente de`resend`, Then não sobe; `.env.example`traz só valores de exemplo e`test/setup-env.ts`usa`capture`; nenhuma credencial real entra no repositório. |
| R5  | `dispatch(message)` nunca rejeita.                                               | Must       | Given provedor indisponível, When `dispatch`, Then a promessa resolve, o erro é registrado e quem chamou segue normalmente; `send` rejeita com `EmailDeliveryError`.                                                                                                                                                                                                                                                                      |
| R6  | Timeout e retry limitado.                                                        | Must       | Given o provedor não responde ou devolve erro transitório (5xx, timeout), When `send`, Then há no máximo 3 tentativas (1 + 2 retries com espera crescente), timeout de 5 s por tentativa e `EmailDeliveryError` em ≤ 15 s no total; erros permanentes (4xx de requisição inválida) não são repetidos; o request que chamou via `dispatch` não espera pelas tentativas.                                                                    |
| R7  | Logs sem PII.                                                                    | Must       | Given envios com sucesso e com falha, When inspecionar os logs, Then há apenas `event` (`email_sent` ou `email_delivery_failed`), nome do provedor, `purpose` do e-mail, duração e código de erro; nunca destinatário, assunto, corpo, token, link ou chave de API.                                                                                                                                                                       |
| R8  | Layout base de e-mail em en-US.                                                  | Must       | Given `renderEmailLayout({title, preheader, bodyHtml, bodyText})`, When renderizar, Then o HTML é válido, com `lang="en-US"`, título, texto alternativo e contraste AA (cores dos tokens de `DESIGN.md`), e a parte de texto puro contém o mesmo conteúdo sem marcação; conteúdo dinâmico é escapado (teste com `<script>`).                                                                                                              |
| R9  | Módulo isolado conforme as camadas.                                              | Should     | Given o código, When inspecionar, Then `EmailService` (porta) vive em `domain/application` do módulo `email`, os provedores em `infrastructure`, e nenhum caso de uso de outro módulo importa SDK/cliente de provedor.                                                                                                                                                                                                                    |

## 5. Fluxos e estados

- **Caminho feliz:** o caso de uso monta a mensagem com o layout e chama `dispatch` depois do commit; o `EmailService` entrega ao provedor ativo; a API registra `email_sent` sem PII.
- **Vazio:** não se aplica.
- **Carregando:** `dispatch` retorna imediatamente; a entrega acontece em segundo plano no mesmo processo.
- **Erro:** provedor recusa, não responde ou dá timeout → retry com espera crescente (só para erro transitório) → `EmailDeliveryError` registrado como `email_delivery_failed`; o request original não muda de resultado. Credencial inválida do provedor aparece como erro permanente no log, sem a chave.
- **Sucesso parcial:** não se aplica (um destinatário por mensagem).
- **Cancelamento/retry:** o processo cair com e-mails em andamento perde essas mensagens (sem outbox); aceito nesta fase, mitigado por "reenviar" nas specs 0006 e 0009.
- **Permissões e dados:** o destinatário é PII e fica só em memória durante o envio. As chaves do Mailtrap e do Resend são segredos: só em variável de ambiente do servidor, nunca no bundle (`VITE_*`) nem em log. A rota de apoio a testes (R3) devolve e-mails de teste e só existe no provedor `capture`.

## 6. Acceptance Criteria

- [ ] Given cada valor de `EMAIL_PROVIDER`, When `send`, Then só o provedor escolhido é acionado e nenhum caso de uso importa provedor. (R1)
- [ ] Given transporte falso, When `send` por `mailtrap` e por `resend`, Then o payload é o esperado; resposta de erro vira `EmailDeliveryError`. (R2)
- [ ] Given `capture`, When `send`, Then a mensagem é lida por `getCapturedEmails` (e pela rota de teste no processo da API) e nada sai da máquina; `capture` em produção impede o boot. (R3)
- [ ] Given variável ausente/inválida ou provedor errado para produção, When iniciar, Then falha citando a variável. (R4)
- [ ] Given provedor indisponível, When `dispatch`, Then resolve sem erro e registra `email_delivery_failed`; When `send`, Then `EmailDeliveryError`. (R5)
- [ ] Given timeout ou 5xx, When `send`, Then ≤ 3 tentativas e erro em ≤ 15 s; Given 4xx de requisição inválida, Then 1 tentativa. (R6)
- [ ] Given envios com sucesso e com falha, When inspecionar os logs, Then não há destinatário, assunto, corpo, token, link ou chave. (R7)
- [ ] Given o layout, When renderizar com `<script>` no conteúdo, Then o HTML o escapa e o texto puro está presente. (R8)
- [ ] Manual: Given credenciais do Mailtrap em um `.env` local, When um e-mail de teste é enviado, Then ele aparece na caixa do Mailtrap. (R2, verificação manual; registrar no relatório)

## 7. O que fazer

1. Criar o módulo `apps/api/src/modules/email/` com `EmailService` (porta), `EmailDeliveryError`, `dispatch`, os provedores `mailtrap`, `resend` e `capture` e o layout base.
2. Decidir no plano, com justificativa, como falar com cada provedor (SMTP ou API/SDK) e registrar as dependências.
3. Adicionar `EMAIL_PROVIDER`, `EMAIL_FROM` e as credenciais dos provedores ao esquema de ambiente, ao `.env.example` (placeholders) e a `test/setup-env.ts` (`capture`).
4. Implementar a rota de apoio a testes do `capture` (registrada só nesse modo) e o helper `getCapturedEmails`.
5. Escrever os testes: unitário (layout e escape, retry e classificação de erro com provedor falso, contrato dos dois provedores com transporte falso, validação de configuração).
6. Atualizar `ARCHITECTURE.md` (módulo e provedores), `DEVELOPMENT.md` (envio pós-commit via `dispatch`; teste usa `capture`) e `QA.md` (verificação manual no Mailtrap).
7. Executar os gates de `QA.md`.

## 8. O que não fazer

- Não escrever templates específicos de auth aqui.
- Não criar fila, outbox, job agendado ou tabela de e-mails.
- Não logar destinatário, assunto, corpo, link, token ou chave de API; não propagar o erro do provedor ao cliente HTTP.
- Não deixar `capture` ou `mailtrap` ativos em produção, nem enviar e-mail real a partir de teste automatizado.
- Não colocar credenciais do Mailtrap ou do Resend no repositório nem em variáveis `VITE_*`.
- Não importar SDK de provedor fora do módulo `email`.
- Não depender do servidor de e-mail local do Supabase.

## 9. Riscos e dependências

| Tipo        | Descrição                                                                                  | Mitigação                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Dependência | SDKs/clientes do Mailtrap e do Resend (ou SMTP).                                           | Escolher no plano e justificar (problema, alternativa, custo); instalar só em `apps/api`.                                |
| Dependência | Contas e credenciais do Mailtrap (sandbox) e do Resend (chave de API, domínio verificado). | Fornecidas por quem administra as contas, fora do repositório; domínio verificado é pré-requisito de produção (backlog). |
| Risco       | Teste automatizado não exercita Mailtrap nem Resend de verdade.                            | Teste de contrato com transporte falso e verificação manual registrada; teste de fumaça em staging antes de produção.    |
| Risco       | Rota de apoio a testes exposta por engano.                                                 | Só existe com `capture`; a API não sobe com `capture` em produção (R3, R4); teste cobre os dois lados.                   |
| Risco       | Sem outbox, e-mail pode se perder se o processo cair.                                      | Aceito; reenvio nas specs 0006 e 0009; outbox no backlog.                                                                |
| Risco       | Limites de envio do plano gratuito do Mailtrap em desenvolvimento.                         | Registrar no relatório; `capture` cobre o dia a dia dos testes.                                                          |

## 10. Resultado

Como validar que a spec foi atendida:

- **Comando/verificação:** `bun run test`; `bun run test:integration`; `bun run lint`; `bun run check-types`; verificação manual da caixa do Mailtrap com credenciais locais.
- **Evidência esperada:** testes verdes; log `email_sent` sem PII; mensagem de teste visível no Mailtrap (verificação manual).
- **Comportamento observável:** com o provedor fora do ar, `dispatch` não derruba nada e registra a falha; com `EMAIL_PROVIDER=capture`, a rota de apoio lista as mensagens do teste.

## 11. Perguntas abertas e premissas

| Pergunta/Premissa                                                                                                                                                                                                                                    | Impacto                                                       | Bloqueante?             | Quem decide        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------- | ------------------ |
| **Decisão (2026-11-09, solicitante):** fora de produção `EmailService` usa Mailtrap; em produção, Resend; a escolha fica abstraída no `EmailService`.                                                                                                | Define provedores, variáveis e testes.                        | Não (resolvida)         | Solicitante        |
| Premissa: o provedor `capture` é o que os testes automatizados e o E2E usam; o E2E lê as mensagens por uma rota de apoio a testes (só no `capture`). Alternativa descartada: ler a caixa do Mailtrap pela API (rede externa e credenciais no teste). | Define como os specs 0004 a 0010 provam o conteúdo do e-mail. | Não                     | Time de engenharia |
| Pergunta: Mailtrap por SMTP ou por API? Resend por SDK/API ou SMTP?                                                                                                                                                                                  | Dependências e variáveis.                                     | Não (decidir no plano)  | Time de engenharia |
| Pergunta: quem fornece as credenciais do Mailtrap e do Resend e onde ficam por ambiente?                                                                                                                                                             | Setup de dev e de produção.                                   | Não                     | Infra              |
| Pergunta: remetente e domínio de envio em produção (SPF/DKIM no Resend).                                                                                                                                                                             | Entregabilidade; antes de publicar.                           | Não (antes de produção) | Produto / Infra    |
| Premissa: remetente de dev `Analytics Personas <no-reply@analytics-personas.local>`; em produção, o domínio verificado.                                                                                                                              | Valor de `EMAIL_FROM`.                                        | Não                     | Time de engenharia |
| Premissa: o módulo vive em `apps/api/src/modules/email` (não em `shared`), porque `shared` exige uso estável por 2+ módulos.                                                                                                                         | Estrutura de pastas.                                          | Não                     | Time de engenharia |
| Premissa: `dispatch` roda em segundo plano no mesmo processo, sem fila persistente.                                                                                                                                                                  | Possível perda em queda do processo.                          | Não                     | Time de engenharia |

## 12. Refinamento

| Data       | O que mudou                                                                                                                                                                                                                                                                      | Motivo                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 2026-11-09 | Spec criada pela skill `breakdown-specs` (épico de autenticação).                                                                                                                                                                                                                | Habilitadora usada por 0004, 0006, 0007, 0009 e 0010. |
| 2026-11-09 | Reescrita: `MailerPort`/SMTP genérico/servidor local do Supabase substituídos por `EmailService` com Mailtrap (non-production), Resend (produção) e provider `capture` (testes); R5 (servidor local) removido; novas regras de seleção por ambiente e de teste sem rede externa. | Decisão do solicitante no quiz de perguntas abertas.  |
