# 0003 — TanStack Router (rotas em código) no `apps/app`

- **Status:** aceito
- **Data:** 2026-11-09

## Contexto

O `apps/app` é uma SPA (ADR 0001) que só tinha a rota `/`. O épico de autenticação (`.plans/auth-breakdown.md`) precisa de dois grupos de rota (`/auth/*` público e `/app/*` privado), de redirecionamentos, de uma página 404 e de leitura tipada de parâmetros de busca (ex.: `?token=` nos links de e-mail). O stack do cliente já usa a família TanStack (Query, Table, Charts).

## Decisão

Usar `@tanstack/react-router` no `apps/app`, com a árvore de rotas escrita **em código** (`src/router.tsx`), sem o plugin de geração de rotas por arquivo.

## Alternativas consideradas

| Alternativa                             | Prós                                                        | Contras                                                              | Por que não                                                          |
| --------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| React Router                            | Mais conhecido; muito material de referência                | Parâmetros de busca e guards menos tipados; fora da família TanStack | O tipo seguro de `search`/`beforeLoad` pesa mais que a familiaridade |
| TanStack Router com rotas por arquivo   | Árvore gerada; tipos automáticos                            | Plugin do Vite, arquivo gerado e mais configuração                   | A árvore é pequena; evitar tooling extra nesta fase                  |
| **TanStack Router com rotas em código** | Sem plugin; tipos fortes; `beforeLoad` e `redirect` nativos | Árvore escrita à mão em um só arquivo                                | **Escolhida**                                                        |

## Consequências

- Positivas: guards e redirecionamentos por `beforeLoad`; parâmetros de busca tipados; testes de roteamento com `createMemoryHistory`; uma só família de bibliotecas no cliente.
- Negativas: nova dependência (`@tanstack/react-router` 1.170.46); a árvore em `router.tsx` precisa ser mantida à mão (se crescer demais, reavaliar a geração por arquivo em novo ADR).
- Impacto em código, operação e time: `App` recebe o `router` por prop (facilita testes); páginas novas entram como filhas de `authRoute` ou `appRoute` (`DEVELOPMENT.md` §13.1).
