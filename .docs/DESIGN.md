# Design

> **Público:** qualquer pessoa que crie, altere ou revise UI.
> **Obrigatório** para tarefas de interface. Complementa `DESIGN_SYSTEM.md`.
> **Estado:** direção visual definida; tokens e `Button` aplicados na fundação, o restante ainda não implementado (ver §10).

## 1. Direção

Interface **retro, inspirada em arte 8-bit, futebol e Brasil**. Deve parecer um produto com identidade própria — não um template de SaaS.

Princípios, em ordem de prioridade:

1. **Legibilidade** vence nostalgia. Pixel art é identidade, não desculpa para texto ruim.
2. **Poucas cores, usadas com intenção.** A paleta é marcante; o fundo neutro evita poluição.
3. **Formas duras e contrastes claros.** Bordas visíveis, cantos quase retos, sombras discretas.
4. **Movimento contido.** Animações curtas e mecânicas, nunca decorativas em excesso.
5. **Acessível por padrão.** Contraste, foco, teclado e leitor de tela não são opcionais.

## 2. Paleta

### 2.1 Cores principais

| Token                    | Hex       | RGB          | Papel sugerido                            |
| ------------------------ | --------- | ------------ | ----------------------------------------- |
| `--color-blaze-orange`   | `#FB6107` | 251, 97, 7   | Ação primária, destaque, energia          |
| `--color-golden-glow`    | `#F3DE2C` | 243, 222, 44 | Realce, badges, detalhes                  |
| `--color-lime-moss`      | `#7CB518` | 124, 181, 24 | Estados positivos, séries de dados        |
| `--color-forest-moss`    | `#5C8001` | 92, 128, 1   | Apoio, bordas e texto sobre fundos claros |
| `--color-sunflower-gold` | `#FBB02D` | 251, 176, 45 | Acento secundário, hover                  |

### 2.2 Neutros (proposta)

| Token           | Hex       | Papel                                  |
| --------------- | --------- | -------------------------------------- |
| `--color-ink`   | `#0A0A0A` | Texto principal e fundo escuro         |
| `--color-paper` | `#FFFDF5` | Fundo claro (branco quente, não cinza) |
| `--color-muted` | `#6B6B6B` | Texto secundário sobre fundo claro     |

Não use cinzas frios genéricos como base. Se precisar de mais tons, derive de `ink`/`paper` com opacidade.

### 2.3 Regras de contraste

Contrastes aproximados contra branco (`#FFFFFF`):

| Cor       | Contraste | Uso permitido                                                  |
| --------- | --------- | -------------------------------------------------------------- |
| `#FB6107` | ~3,1:1    | Texto grande (>= 24px), ícones e bordas; **não** texto normal  |
| `#F3DE2C` | ~1,4:1    | **Nunca** texto sobre branco; usar como fundo com texto escuro |
| `#7CB518` | ~2,5:1    | Ícones/gráficos; **não** texto normal                          |
| `#5C8001` | ~4,6:1    | Texto normal sobre fundo claro (passa AA)                      |
| `#FBB02D` | ~1,9:1    | Fundo de destaque com texto escuro; **não** texto normal       |

Regras práticas:

- Texto sobre qualquer cor de destaque deve ser `--color-ink`.
- Cor nunca é o único indicador de estado; combine com ícone, texto ou padrão.
- Ao criar um par de cores, valide o contraste real (DevTools, axe ou Lighthouse), não confie na percepção.

## 3. Tipografia

| Uso                         | Estilo                                      | Regra                                                  |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| Títulos e números de placar | Fonte display com personalidade pixel/8-bit | Só em títulos curtos e números; nunca em parágrafos    |
| Corpo e interface           | Sans-serif legível                          | Tamanho mínimo 16px no corpo; 14px apenas em metadados |
| Dados tabulares             | Mono-espaçada                               | Números alinhados, ideal para tabelas e métricas       |

Hoje `apps/docs` usa Geist (sans e mono) via `next/font/local` e `apps/app` usa a fonte do sistema. Ao adotar uma fonte display, carregue com `next/font` e preserve fallback legível. Não use fonte pixel abaixo de 16px nem em blocos longos.

## 4. Motivos visuais

Use com moderação:

- Grade de pixels sutil, bordas de 2–4px, cantos com raio 0–4px.
- Ícones e ilustrações em pixel art, com contorno consistente.
- Referências de futebol: números de camisa, placar, campo, faixas; referências de Brasil: verde/amarelo, sem cair no clichê.
- Sombras duras e deslocadas (efeito "botão de arcade"), não sombras difusas.

Evite:

- Gradientes suaves, glassmorphism, blur decorativo e brilho neon genérico.
- Cantos muito arredondados (>= 16px) como padrão.
- Excesso de cores na mesma tela; escolha uma cor dominante e uma de apoio.
- Pixel art em tamanhos que quebrem a grade ou fiquem ilegíveis.

## 5. Layout e espaçamento

- **Mobile-first.** Valide em 375px, 768px e 1280px no mínimo.
- Base de espaçamento em múltiplos de 4px.
- Conteúdo com largura máxima confortável para leitura; não estique texto em telas largas.
- Áreas de toque com no mínimo 44×44px.
- Tabelas e gráficos devem ter fallback para telas estreitas (scroll horizontal controlado ou visão resumida).

## 6. Movimento

- Duração curta: 120–200ms para feedback; até 300ms para transições de painel.
- Prefira `steps()` ou easing seco para reforçar o efeito 8-bit.
- Respeite `prefers-reduced-motion: reduce` e desative animações não essenciais.
- Não anime conteúdo que muda de layout repetidamente; nada de "piscando" constante.

## 7. Acessibilidade (obrigatório)

- Meta: **WCAG 2.2 AA**.
- Foco visível com contraste mínimo de 3:1; nunca remova `outline` sem substituto.
- Navegação completa por teclado; ordem de tabulação lógica.
- HTML semântico (`button`, `a`, `label`, `nav`, `main`, headings em ordem).
- Todo input tem label associado; erros são anunciados e descritos em texto.
- Imagens com `alt` significativo; decorativas com `alt=""`.
- Não dependa de cor, posição ou forma isolada para comunicar estado.
- `lang="en-US"` em `apps/app` e `apps/docs` (decisão de 2026-11-09).

## 8. Conteúdo e tom

- Idioma: **en-US** para interface, mensagens da API e e-mails; esta documentação segue em pt-BR.
- Tom direto, técnico e futebolístico; evite jargão de marketing.
- Datas e números no padrão `en-US` na interface (ISO 8601 UTC nos contratos de API).
- Não entregue `lorem ipsum`, placeholder ou texto de template em tela final.
- Microcopy de erro deve dizer o que aconteceu e o que fazer em seguida.

## 9. Do / Don't

| Faça                                       | Não faça                                     |
| ------------------------------------------ | -------------------------------------------- |
| Usar uma cor de destaque por ação primária | Colorir todos os botões com cores diferentes |
| Texto escuro sobre amarelo/laranja         | Texto branco sobre amarelo/laranja           |
| Bordas nítidas e formas consistentes       | Misturar estilos flat, glass e neumórfico    |
| Ícones pixel com grade consistente         | Misturar ícones de bibliotecas diferentes    |
| Validar contraste e teclado                | Confiar apenas no visual                     |

## 10. Estado da implementação

| Item                             | Estado                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Paleta aplicada em tokens        | Sim (`packages/ui/src/styles.css`; `apps/docs/app/globals.css` repete uma parte em variáveis próprias) |
| Fonte display                    | Não                                                                                                    |
| Componentes no estilo 8-bit      | Parcial (`Button` com borda de 2px e sombra dura; demais primitivos não existem)                       |
| `lang="en-US"`                   | Sim (`apps/app` e `apps/docs`)                                                                         |
| Revisão de contraste             | Não                                                                                                    |
| Testes de teclado/leitor de tela | Não                                                                                                    |

Os tokens são definidos em `packages/ui/src/styles.css` e consumidos pelos componentes. Não espalhe hex pelo código. A duplicação de hex em `apps/docs/app/globals.css` é dívida: o `apps/docs` ainda não consome `@repo/ui`.
