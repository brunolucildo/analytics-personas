# 0004 — Convenções de URL, versionamento da API e idioma

- **Status:** aceito
- **Data:** 2026-11-09

## Contexto

Antes de implementar a autenticação é preciso fixar o espaço de URLs, o formato de erro e o idioma, porque todas as specs seguintes assumem esses contratos. A API respondia em `GET /` sem versão; `BUSINESS.md` §10, `DESIGN.md` e `DEVELOPMENT.md` §4 mandavam interface em pt-BR e `lang="pt-BR"`. O solicitante decidiu que páginas, endpoints e código ficam em en-US, que a API é versionada em `/api/v1/*` e que as páginas públicas ficam em `/auth/*` e as privadas em `/app/*`.

## Decisão

- **API:** prefixo global `/api/v1`; `GET /` deixa de existir e vira `GET /api/v1/health`; fora do prefixo a API responde 404.
- **Erros:** envelope único `{"error":{"code","message","details"}}`, `code` em `UPPER_SNAKE_CASE`, sem stack trace; JSON em `camelCase`.
- **CORS:** apenas a origem de `APP_URL`, variável obrigatória.
- **Páginas:** `/auth/*` públicas e `/app/*` privadas, como grupos de rota do roteador (ADR 0003); `/` redireciona para `/app`.
- **Idioma:** en-US para interface, mensagens e códigos de erro da API, e-mails, rotas e código novo; `.docs/`, specs, planos, ADRs e commits continuam em pt-BR.

## Alternativas consideradas

| Alternativa                         | Prós                           | Contras                                                 | Por que não                                   |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------- | --------------------------------------------- |
| Versão por header ou por subdomínio | URLs "limpas"                  | Mais difícil de testar, cachear e depurar               | Pedido explícito de `/api/v1/*`               |
| Sem prefixo de versão               | Simples                        | Quebra de contrato sem caminho de migração              | Pedido explícito de versionar                 |
| Biblioteca de i18n desde já         | Pronta para outros idiomas     | Custo e complexidade sem requisito de múltiplos idiomas | Fora do escopo; revisitar com decisão de i18n |
| Manter pt-BR na interface           | Alinhado ao documento anterior | Contraria a decisão do solicitante                      | Decisão de produto prevalece                  |

## Consequências

- Positivas: contrato de URL e de erro estável para todas as specs de auth; SPA e API tratam erros do mesmo jeito; CORS restrito.
- Negativas: quem já tem `.env` precisa adicionar `APP_URL`; `/app` fica acessível sem login até a spec `0005`; mensagens em pt-BR de código antigo ainda existem (`lib/supabase.ts`, `telemetry.ts`) e migram quando os arquivos forem tocados.
- Impacto em código, operação e time: `configureApp` (`apps/api/src/bootstrap.ts`) concentra prefixo, CORS, logs, validação e filtro; erros de domínio usam `ApiException`; ver `DEVELOPMENT.md` §13.
