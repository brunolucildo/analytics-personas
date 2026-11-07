# 0001 — Cliente em React + Vite no lugar de Next.js

- **Status:** aceito
- **Data:** 2026-11-07

## Contexto

O repositório nasceu do `create-turbo` com dois apps Next.js: `apps/web` (produto) e `apps/docs`. A arquitetura-alvo (`.docs/ARCHITECTURE.md`) separa o backend em `apps/api` (Nest.js); o produto é uma aplicação autenticada, orientada a dados e sem requisito de SEO ou renderização no servidor. Manter Next.js no cliente de produto duplicaria a camada de servidor (rotas, server actions) que já pertence à API e atrapalharia o limite "o browser fala com a API; segredos ficam no servidor".

## Decisão

O app de produto passa a ser `apps/app`, em React + Vite + TypeScript (porta 5173); `apps/web` é removido. `apps/docs` permanece em Next.js (porta 3001).

## Alternativas consideradas

| Alternativa                         | Prós                                     | Contras                                                           | Por que não                                                     |
| ----------------------------------- | ---------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| Manter `apps/web` em Next.js        | Sem migração; Server Components; SEO     | Segunda camada de servidor; risco de acesso direto ao banco       | O produto não precisa de SSR e já tem API própria               |
| Migrar também `apps/docs` para Vite | Um único bundler no monorepo             | Perde geração estática e rotas por arquivo, sem ganho para o site | Fora do escopo da fundação; o site de docs se beneficia do Next |
| Vite no cliente, Next só nos docs   | Cliente leve; limites claros; HMR rápido | Dois toolchains de frontend                                       | **Escolhida**                                                   |

## Consequências

- Positivas: fronteira nítida entre cliente (SPA) e servidor (API); build e testes do cliente mais rápidos (Vite + Vitest); Tailwind via `@tailwindcss/vite`.
- Negativas: sem Server Components no produto; os guias de `next-best-practices` valem apenas para `apps/docs`; variáveis do cliente usam o prefixo `VITE_` (não `NEXT_PUBLIC_`).
- Impacto em código, operação e time: `apps/web` foi removido; `.docs/` foi atualizado; o roteamento do `apps/app` fica para uma spec futura (a fundação entrega só `/`).
