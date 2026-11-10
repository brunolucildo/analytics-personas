# Design System

> **Público:** quem cria ou altera componentes de UI.
> **Obrigatório** em conjunto com `DESIGN.md`.
> **Estado:** fundação pronta. `packages/ui` tem Tailwind v4, configuração shadcn, tokens da paleta, `Button`, `Input` e `Label`. Os demais primitivos ainda não existem.

## 1. Decisão

O design system é construído sobre **shadcn/ui** com **TailwindCSS v4 (CSS-first)**, dentro de `packages/ui`, e consumido pelos apps via `@repo/ui/*`.

| Item                 | Estado                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Estilo               | Tailwind v4; `@tailwindcss/vite` em `apps/app`; sem `tailwind.config` (`components.json` com `config: ""`)    |
| Componentes base     | `Button` (shadcn, estilo `new-york`, com variantes `default`, `secondary`, `outline`, `ghost`, `destructive`) |
| Tokens               | Semânticos shadcn em `packages/ui/src/styles.css`, apontando para a paleta de `DESIGN.md`                     |
| Local dos primitivos | `packages/ui/src`                                                                                             |
| Utilitários          | `cn()` em `packages/ui/src/lib/utils.ts` (`clsx` + `tailwind-merge`)                                          |

Ao instalar ou mudar algo, atualize esta tabela, `ARCHITECTURE.md` e `QA.md` na mesma mudança.

## 2. Onde cada componente vive

| Tipo                       | Local                                         | Exemplo                                 |
| -------------------------- | --------------------------------------------- | --------------------------------------- |
| Primitivo reutilizável     | `packages/ui/src/<componente>.tsx`            | `button.tsx`, `input.tsx`, `dialog.tsx` |
| Composição de uma feature  | `apps/app/src/features/<dominio>/components/` | `expert-card.tsx`                       |
| Composição raiz            | `apps/app/src/`                               | `App.tsx`, `main.tsx`                   |
| Utilitário de apresentação | `packages/ui/src/lib/` ou `apps/app/src/lib/` | `utils.ts` (`cn`)                       |

Regras:

- Se o componente é usado por mais de um app ou por mais de uma feature, ele pertence a `packages/ui`.
- Se depende de uma regra de negócio ou de uma chamada de API, ele **não** pertence a `packages/ui`.
- O contrato de exports é **explícito**: hoje `./button`, `./input`, `./label`, `./styles.css` e `./lib/utils` (mapa `exports` do `package.json`). Todo novo primitivo precisa de uma entrada nesse mapa na mesma mudança; imports de caminhos não exportados falham.
- Um app que usa `@repo/ui` importa `@repo/ui/styles.css` e precisa que o Tailwind enxergue `packages/ui/src` (`@source "./"` já está em `styles.css`).

## 3. Tokens

### 3.1 Camadas

```text
primitivos (paleta bruta)
  → semânticos (background, foreground, primary, muted, border, focus)
    → componentes (button, card, badge)
```

- **Primitivos:** os hex de `DESIGN.md` (`--color-blaze-orange`, etc.).
- **Semânticos:** nomes no padrão shadcn (`--background`, `--foreground`, `--primary`, `--primary-foreground`, `--muted`, `--border`, `--ring`).
- **Componentes:** não definem hex; consomem semânticos.

### 3.2 Regras

1. Hex só aparece na definição dos primitivos.
2. Componente nunca escolhe cor "no olho"; usa token semântico.
3. Todo par texto/fundo precisa passar o contraste definido em `DESIGN.md`.
4. Dark mode ainda **não foi decidido**. Não implemente dark mode por conta própria; se necessário, abra decisão e registre ADR.
5. Espaçamento, raio, sombra e tipografia também são tokens, não valores soltos repetidos.

## 4. Contrato de componentes

Todo primitivo deve:

- Aceitar `className` e permitir composição.
- Expor variantes explícitas (ex.: `variant`, `size`) em vez de flags booleanas proliferadas.
- Ter estados documentados: default, hover, focus-visible, active, disabled, loading, error (quando aplicável).
- Ser acessível: elemento semântico correto, label, `aria-*` quando necessário, foco visível.
- Funcionar com teclado e leitor de tela.
- Ser o mais "server-safe" possível; `"use client"` apenas quando houver estado, efeito ou evento.
- Não conter chamadas de API, regra de negócio, texto de produto hardcoded ou `alert`.

Convenções:

- Arquivo em `kebab-case.tsx`; export em `PascalCase`.
- Props tipadas; sem `any`.
- `children` quando o conteúdo for composicional.
- Ao usar shadcn, preserve o padrão gerado e adapte via tokens; não reescreva o primitivo sem necessidade.

## 5. Componentes atuais

| Componente | Estado                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`   | Primitivo real: aceita `className`, `asChild`, `variant` e `size`; `type="button"` por padrão; foco visível; alvo de toque de 44px no tamanho padrão; sem `alert` nem texto de produto |
| `Input`    | Campo de texto de 44px de altura, borda de 2px, foco visível; `aria-invalid` troca a borda para `destructive` e mais grossa (o erro em texto fica por conta de quem usa, ligado por `aria-describedby`) |
| `Label`    | `<label>` visível em 16px e negrito; sempre com `htmlFor`                                                                                                                                                |

Os stubs herdados do template (`Card`, `Code` e o `Button` com `alert`) foram removidos. Novos primitivos entram pela receita da seção 6.

## 6. Receita para adicionar um componente

1. Confirme que não existe primitivo equivalente em `packages/ui`.
2. Defina o contrato: propósito, props, variantes, estados e acessibilidade.
3. Implemente com tokens semânticos e Tailwind (após instalação).
4. Adicione exemplo de uso e, se houver lógica, teste.
5. Verifique teclado, foco, contraste e responsividade.
6. Atualize este documento se o contrato ou o local mudar.

## 7. Do / Don't

| Faça                                     | Não faça                                           |
| ---------------------------------------- | -------------------------------------------------- |
| Compor primitivos para criar uma feature | Copiar o código do primitivo e alterar uma cor     |
| Usar tokens semânticos                   | Escrever `#FB6107` no componente                   |
| Manter um único `Button`                 | Criar `PrimaryButton`, `OrangeButton`, `BigButton` |
| Passar `className` para ajustes locais   | Criar props para cada espaçamento                  |
| Testar estados e teclado                 | Validar apenas o caminho feliz no mouse            |

## 8. Lacunas para implementar

- [x] Instalar TailwindCSS e configurar o tema.
- [x] Configurar shadcn/ui em `packages/ui` (`components.json`).
- [x] Definir tokens semânticos em `packages/ui/src/styles.css` (o `apps/docs/app/globals.css` ainda repete alguns hex; dívida).
- [x] Substituir os stubs e remover os links de template.
- [ ] Separar os tokens primitivos (`--color-blaze-orange` etc.) dos semânticos; hoje `styles.css` aponta direto para hex.
- [ ] Decidir dark mode (sim/não) e registrar ADR.
- [ ] Escolher e carregar fonte display (hoje só Geist em `apps/docs`; `apps/app` usa a fonte do sistema).
- [ ] Revisar contraste real dos pares de cor (DevTools/axe), por exemplo `--primary` com `--primary-foreground`.
- [ ] Adicionar verificação de acessibilidade no QA.
- [x] `lang="en-US"` e `<title>` corretos em `apps/app/index.html` e `apps/docs/app/layout.tsx`.
