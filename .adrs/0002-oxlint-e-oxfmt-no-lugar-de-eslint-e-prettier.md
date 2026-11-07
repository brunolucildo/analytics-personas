# 0002 — OXLint e OXFmt no lugar de ESLint e Prettier

- **Status:** aceito
- **Data:** 2026-11-07

## Contexto

O tooling do template era ESLint 10 + Prettier, com `packages/eslint-config` compartilhado. O baseline estava quebrado: `bun run lint` falhava em `@repo/ui` por preset Babel não resolvido. O stack-alvo (`.docs/ARCHITECTURE.md` §3.2) já previa OXLint, OXFmt, lefthook e lint-staged.

## Decisão

Lint com OXLint e formatação com OXFmt, configurados na raiz (`.oxlintrc.json`, `.oxfmtrc.json`). Hooks de pre-commit com lefthook executando lint-staged. `packages/eslint-config`, ESLint e Prettier foram removidos, sem fallback.

## Alternativas consideradas

| Alternativa                             | Prós                                          | Contras                                                      | Por que não                                    |
| --------------------------------------- | --------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| Corrigir o preset Babel e manter ESLint | Ecossistema de regras e plugins maduro        | Mais lento; configuração por pacote; mantém duas ferramentas | Diverge do stack-alvo definido                 |
| Biome                                   | Lint e format unificados                      | Fora do stack-alvo; migração de regras diferente             | Decisão anterior já escolheu o ecossistema Oxc |
| OXLint + OXFmt                          | Muito rápido; config única na raiz; sem Babel | OXFmt é novo; OXLint não cobre todas as regras do ESLint     | **Escolhida**                                  |

## Consequências

- Positivas: `bun run lint` volta a passar; um comando de correção (`bun run code:fix`); hooks rápidos.
- Negativas: regras de React/Next específicas do ESLint não existem; OXFmt (0.x) pode mudar a formatação entre versões. A mitigação é manter `tsc --noEmit` (`check-types`) como gate e fixar versões no `bun.lock`.
- Impacto em código, operação e time: escopo de `format` e `code:fix` limitado por `ignorePatterns` (skills de terceiros, artefatos gerados, `bun.lock`); ESLint não deve ser reintroduzido como fallback silencioso. Os hooks do lefthook ainda precisam ser instalados (`bun run hooks:install`) e validados com um commit real.
