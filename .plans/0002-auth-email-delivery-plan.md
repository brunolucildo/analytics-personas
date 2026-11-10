# Plano — Envio de e-mail transacional (0002)

- **Status:** concluído (verificação manual no Mailtrap pendente: sem credenciais)
- **Slug:** 0002-auth-email-delivery
- **Spec:** `.specs/0002-auth-email-delivery.md`
- **Data:** 2026-11-09

## Contexto

A API não envia e-mail e cinco specs de auth (0004, 0006, 0007, 0009, 0010) dependem disso. A spec fixa o desenho: `EmailService` com provedores `mailtrap` (non-production), `resend` (produção) e `capture` (testes), escolhidos por configuração.

## Objetivo

Entregar `apps/api/src/modules/email` com `EmailService` (`send` e `dispatch`), três provedores, configuração validada no boot, layout base de e-mail, timeout, retry limitado, erro tipado e logs sem PII.

## Não-objetivos

Templates de auth, fila/outbox, verificação de domínio no Resend, rastreamento, limite por destinatário, Inbucket/Mailpit.

## Usuários e permissões

Sem usuário final. A rota de apoio a testes (`GET/DELETE /api/v1/test-support/emails`) só responde com `EMAIL_PROVIDER=capture`; a API não sobe com `capture` em produção.

## Fluxos e estados

Caminho feliz: caso de uso chama `dispatch` após o commit -> provedor ativo -> log `email_sent`. Erro: erro transitório (timeout, rede, 5xx, 408, 429) é repetido até 3 tentativas com espera de 250 ms e 500 ms e prazo total de 15 s; erro permanente (demais 4xx) não é repetido; ao final `EmailDeliveryError` e log `email_delivery_failed`. `dispatch` resolve na hora e nunca rejeita; `drain()` espera as entregas em andamento (testes e desligamento).

## Requisitos

R1 a R9 da spec (critérios de aceite na spec §4 e §6).

## Contratos de dados

- `EmailMessage { to, subject, text, html, purpose? }` (`purpose` identifica o tipo de e-mail nos logs; padrão `unspecified`).
- `EmailDeliveryError { code, retryable, attempts }`; `code`: `TIMEOUT`, `NETWORK_ERROR`, `PROVIDER_UNAVAILABLE`, `RATE_LIMITED`, `PROVIDER_REJECTED`, `PROVIDER_UNAUTHORIZED`.
- Env: `EMAIL_PROVIDER`, `EMAIL_FROM`, `MAILTRAP_API_TOKEN`, `MAILTRAP_INBOX_ID`, `RESEND_API_KEY`.

## Integrações

- Mailtrap Email Sandbox: `POST https://sandbox.api.mailtrap.io/api/send/{inbox_id}`, `Authorization: Bearer <token>`.
- Resend: `POST https://api.resend.com/emails`, `Authorization: Bearer <key>`.

## Decisões e premissas

- **API HTTP com `fetch` nativo nos dois provedores (sem SDK e sem SMTP).** Por que: zero dependência nova (Node >= 24 tem `fetch`/`AbortController`); o status HTTP dá classificação limpa de erro transitório x permanente (SMTP exigiria interpretar códigos 4xx/5xx de sessão); o transporte falso do teste de contrato é só um `fetch` injetado; timeout por `AbortSignal`. Descartado: `nodemailer` (SMTP) para o Mailtrap (dependência + classificação de erro opaca) e SDK `resend` (dependência e retry/timeout próprios que brigam com a política da spec). Registrado em ADR.
- Retry e timeout vivem em `EmailService` (application), não nos provedores: a política é única e testável com provedor falso.
- `renderEmailLayout` recebe `bodyHtml` como `SafeHtml` (gerado pela tag `html` que escapa interpolações), então conteúdo dinâmico não chega cru ao HTML.
- A rota de teste é declarada no módulo, mas um guard responde 404 (mesmo envelope de rota inexistente) fora do `capture`: o `ConfigModule` 12 carrega o env de forma assíncrona, então a escolha do provedor só é conhecida após o boot dos módulos. A segunda trava é o boot falhar com `capture` em produção.
- `capture` guarda no máximo 500 mensagens em memória (descarta as mais antigas).
- Não editar `playwright.config.ts`: o E2E atual não sobe a API; as specs de auth que precisarem ajustam o `webServer` e definem `EMAIL_PROVIDER=capture`.
- Credenciais reais não existem: verificação manual no Mailtrap fica como pendência documentada em `QA.md`.

## Abordagem (fatias verticais)

1. **Núcleo + capture + configuração** (R1, R3, R4, R5, R6, R7): domain (`EmailMessage`, `EmailDeliveryError`, port `EmailProvider`, `EmailLogger`), `EmailService`, `CaptureEmailProvider`, store, `parseEmailConfig` ligado a `validateEnvironment`, `setup-env.ts`, `.env.example`.
2. **Provedores Mailtrap e Resend** (R2): contrato com `fetch` falso, classificação de erro.
3. **Layout** (R8): `renderEmailLayout`, `html`/`escapeHtml`, contraste AA.
4. **Módulo Nest + rota de teste + docs** (R1, R3, R9): `EmailModule`, controller/guard, `AppModule`, teste de integração, `ARCHITECTURE.md`, `DEVELOPMENT.md`, `QA.md`, ADR.

## Arquivos previstos

`apps/api/src/modules/email/**`, `apps/api/src/config/environment.ts` (+ spec), `apps/api/src/app.module.ts`, `apps/api/test/setup-env.ts`, `apps/api/test/email.int-spec.ts`, `.env.example`, `.docs/{ARCHITECTURE,DEVELOPMENT,QA}.md`, `.adrs/0006-*.md`, spec e plano.

## Testes

Unitário por fatia (Vitest, provedor e `fetch` falsos, sem rede). Integração (Supertest) para a rota de teste e o boot com `capture`; depende de Supabase local só por convenção do projeto (a API do teste não toca o banco), sob o lock de infra.

## Riscos e rollback

Formato exato das APIs do Mailtrap/Resend não é exercitado contra o serviço real (sem credenciais): mitigado por teste de contrato e verificação manual pendente. Rollback: reverter o commit; a única mudança de contrato é a nova env obrigatória.

## Critério de pronto

Gates de `QA.md` (lint, tipos, build, test, test:integration) verdes; ADR e docs atualizados; commit e push feitos.

## Perguntas abertas

Credenciais e domínio de produção (fora do repositório; antes de publicar).
