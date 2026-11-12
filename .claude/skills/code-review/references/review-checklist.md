# Checklist de revisão

Oito dimensões prioritárias (as que o time mais valoriza), depois as dimensões extras. A numeração é a ordem de prioridade quando o tempo é curto. A decoração entre crases é a que o comentário usa (ver [`conventional-comments.md`](conventional-comments.md)).

Âncoras `DEV §n`, `ARQ §n`, `QA §n`, `DS §n` apontam para `.docs/DEVELOPMENT.md`, `ARCHITECTURE.md`, `QA.md` e `DESIGN_SYSTEM.md` do repositório. **O código vence os docs**: se divergirem, vale o que roda e você registra a divergência como `note`/`chore (docs)`.

Aplique só o que o diff toca. Não percorra o checklist inteiro por obrigação: ele serve para você **não esquecer**, não para gerar comentário.

## Como ler o PR

1. Intenção: título, descrição, spec/plano/ADR citados (`.specs/`, `.plans/`, `.adrs/`). O diff faz o que o PR diz? Falta algo que a spec marca como `Must`?
2. Risco: onde um erro custa mais (autenticação, dados, contrato de API, UI de fluxo crítico, migration). Revise essas áreas primeiro e com mais cuidado.
3. Testes antes do código: o que o PR promete provar? Os testes provam isso?
4. Depois leia o código de produção, arquivo a arquivo, com contexto (arquivo inteiro, chamadores, testes existentes), não só as linhas verdes.

---

## 1. Padrões — `standards`

O PR segue as convenções do projeto e do stack?

- **Camadas e fatias (DEV §2, ADR 0014):** `interface → application → domain`; `infrastructure` implementa ports. **Um endpoint, um request handler, um caso de uso**; handler injeta exatamente um caso de uso; caso de uso não agrega fluxos; `application/services/` só para capacidade reutilizável. Módulo não importa outro módulo; compartilhamento só em `modules/shared` (2+ usos, estável). Request handler fino (DTO → caso de uso → presenter), sem acesso a banco.
- **TypeScript (DEV §3):** sem `any`, `@ts-ignore`, `eslint-disable` sem justificativa; `unknown` + estreitamento; `import type`; `as`/`!` só com invariante comentada; uniões discriminadas no lugar de flags; dado externo validado na fronteira.
- **API (DEV §5, §13.2):** DTO validado (campo extra rejeitado), JSON em `camelCase`, datas ISO 8601 UTC, erro por `ApiException` com `code` em `UPPER_SNAKE_CASE` no envelope `{ error: { code, message, details } }`, sem stack no corpo. Endpoint novo é fechado por padrão: `@Public()` exige justificativa. `@RateLimit` em rota sensível, política nova em `AUTH_RATE_LIMIT_POLICIES`. E-mail só por `EmailService`. `argon2` só via `HashRunner`. Nada de SDK de provedor fora do módulo dono.
- **Frontend (DEV §2.3, §4):** dado remoto com TanStack Query (não `useEffect` para carga inicial); HTTP por `lib/api-client.ts`; rota nova como filha de `authRoute`/`appRoute`; componentes só apresentam; segredo nunca no cliente; só `VITE_*` (públicas) no bundle; sem `services/` genérico. Next (`apps/docs`): server-first, `"use client"` só na folha, `next/font`, `next/image`, `metadata`.
- **Design system (DS §4):** primitivo em `packages/ui` aceita `className`, tem variantes explícitas, estados documentados; sem hex solto (use tokens), sem texto de produto hardcoded em primitivo, sem copiar componente para "mudar só uma coisinha".
- **Dados (DEV §6):** migration `<timestamp>_<descricao>.sql` com comentário de rollback; `snake_case`; `grant`/`revoke` corretos para `rondo_app` (DML e `execute`, nunca DDL; migration já aplicada não se edita); SQL parametrizado (`$1..$n`); função SQL para o que exige transação; erro do banco vira `DataAccessError`.
- **Idioma (DEV §13.3):** ver dimensão 6.
- **Anti-padrões (DEV §12):** `console.log`, código morto, template demo, regra de negócio em componente/handler.
- **Processo:** commits em Conventional Commits (descrição em pt-BR, `type`/`scope` em inglês); PR sem segredo, `.env` ou artefato gerado; `AGENTS.md` da raiz e `turbo.json` intocados sem leitura dos docs do Turborepo.

`issue` quando viola regra "não negociável" dos docs. `suggestion`/`nitpick` quando é preferência.

## 2. Performance — `performance`

- **Banco:** N+1, consulta sem índice no filtro/ordenação, `select *` onde bastam colunas, falta de paginação/limite, transação longa ou lock amplo, índice novo sem justificativa. Consulte a skill `supabase-postgres-best-practices` para migration e SQL.
- **Async:** `await` em loop de chamadas independentes (`Promise.all`), trabalho CPU-bound no event loop, fila/recurso sem limite. Atenção ao pool de threads do libuv (argon2, `randomBytes`, `fetch` competem; ver ARQ §4.4 sobre o `HashLimiter`).
- **Memória:** crescimento sem teto (cache, `Map` em processo, listeners), vazamento de timer/subscription.
- **Rede/integrações:** chamada externa sem timeout, retry ilimitado, chamada em loop, payload grande demais.
- **Frontend:** re-render desnecessário, listas grandes sem virtualização, import pesado no bundle inicial (carregue sob demanda), cascata de requests (_waterfall_), cache do TanStack Query mal configurado (`staleTime`, invalidação), imagens sem `next/image`/dimensões (CLS), `useEffect` que dispara em loop. Skill `vercel-react-best-practices` para React/Next.
- **Medida antes de otimizar:** não peça microotimização sem evidência de caminho quente. `performance` vira `issue` só com custo concreto (ex.: O(n²) em lista sem limite, query sem índice em tabela crescente); senão, `suggestion`.

## 3. Bug e funcionalidade — `bug`

O código faz o que deveria, inclusive quando algo dá errado?

- **Lógica:** off-by-one, condição invertida, `null`/`undefined`, `NaN`, coerção implícita, comparação de datas/fuso, arredondamento.
- **Concorrência:** _check-then-act_ (consulta e depois insere), corrida entre requests, dupla submissão; no projeto, concorrência se resolve no banco (índice único + `on conflict`) (DEV §6). Idempotência de operações repetidas.
- **Erros:** `catch` que engole, promise sem `await`/tratamento, erro de domínio mapeado para o status errado, falha de integração derrubando a demanda inteira (DEV §7: isolar e informar a lacuna), 503 que vira "senha errada" ou 500.
- **Estados (DEV §8, QA §5.4):** vazio, carregando, erro, cancelamento e _retry_ existem e funcionam; botão desabilita durante envio; sucesso parcial.
- **Contrato:** o comportamento bate com a spec e os critérios de aceite; compatibilidade com clientes existentes; anti-enumeração preservada (`forgot-password`, `resend-confirmation` respondem igual com ou sem conta).
- **Regressão:** o PR muda algo usado por outro fluxo? Procure os chamadores (`git grep` no head do PR).
- Prove o bug com um cenário concreto (entrada → saída errada). Sem cenário, é `question`, não `issue`.

## 4. Legibilidade — `readability`

- Nomes revelam intenção; sem abreviação obscura; booleanos com `is/has/can`.
- Funções curtas, uma responsabilidade; aninhamento raso (retorno antecipado); complexidade que pede extração.
- Sem comentário óbvio; **comentário que explica o porquê** onde a regra não é evidente; sem código comentado ou morto; sem número mágico (constante nomeada); sem `TODO` sem dono/issue.
- **DRY de conhecimento, WET de estrutura (DEV §1):** a regra de negócio vive em um lugar; não peça abstração para duas ocorrências ainda incertas, mas aponte a mesma regra copiada em três lugares.
- Tipos expressivos (uniões discriminadas) em vez de flags; `import` organizado; arquivo no lugar certo da arquitetura.
- Mantenha como `suggestion`/`nitpick` quase sempre; `issue` só quando a falta de clareza esconde um defeito ou viola regra dos docs.

## 5. Componentes acessíveis — `a11y`

WCAG 2.2 AA é o piso (DEV §8, QA §5.3, DS §4). Só se o PR toca UI.

- **Semântica:** elemento certo (`button` para ação, `a` para navegação, `label`, `fieldset`/`legend`, `h1` único e headings em ordem, landmarks); nunca `div`/`span` com `onClick`.
- **Teclado e foco:** tudo operável por teclado (Tab, Shift+Tab, Enter, Espaço, Esc); foco visível e em ordem lógica; foco gerenciado ao abrir/fechar diálogo e ao trocar de rota; sem armadilha de foco; `outline: none` sem substituto é `issue`.
- **Formulários:** todo input tem `label` (placeholder não é label); erro em **texto** junto ao campo, ligado por `aria-describedby`/`aria-invalid`; erro dinâmico anunciado (`role="alert"`/`aria-live`); não mostre erro no `blur` se ele deslocar o botão de envio (DEV §2.3); `autocomplete` correto; não use só cor para informar estado.
- **Nome, papel e estado:** controles com nome acessível (botão só com ícone precisa de `aria-label`); `aria-expanded`/`aria-selected`/`aria-busy` quando aplicável; ARIA só quando o HTML nativo não resolve.
- **Visual:** contraste AA (texto 4.5:1, texto grande e ícones/bordas de UI 3:1); alvo de toque >= 44×44px; `alt` em imagem (decorativa com `alt=""`); `prefers-reduced-motion` respeitado; layout em 375, 768 e 1280px sem scroll horizontal; zoom 200% sem perda.
- **Primitivos (DS §4):** aceita `className`, variantes explícitas, todos os estados (hover, focus-visible, active, disabled, loading, error).
- Falha de acessibilidade que **impede** uso por teclado ou leitor de tela é `issue (a11y)`; refinamento é `suggestion`. Skill `web-design-guidelines` ajuda.

## 6. I18n — `i18n`

O projeto **não tem biblioteca de i18n** (DEV §13.3); adotar uma exige decisão e ADR. Até lá, a regra é de **idioma e preparo**:

- **en-US** em: texto de interface, mensagens e códigos de erro da API, e-mails, rotas, identificadores, comentários e mensagens de log/erro no código novo. **pt-BR** em `.docs/`, specs, planos, ADRs e commits. String pt-BR em código novo é `issue (i18n)`; em código antigo, migre quando o arquivo for alterado (pedir é `suggestion`).
- **Texto hardcoded de produto em primitivo de `packages/ui`** é proibido (DEV §12): texto entra por props/`children`.
- **Concatenação de frases** ("Hello " + name + "!") quebra tradução: prefira um único template com placeholders. Plural e gênero não podem ser `n + " item(s)"` espalhado.
- **Formatação:** data, número, moeda e lista via `Intl` com locale explícito, não `toFixed`/template manual; a API trafega ISO 8601 UTC e não texto formatado.
- **Layout:** não assuma largura de texto (palavra em outro idioma é mais longa): sem largura fixa em botão/rótulo; sem texto dentro de imagem.
- **Centralização:** mensagens do mesmo fluxo num único módulo (ex.: `describe-sign-up-failure.ts`), não espalhadas, para a futura extração.
- Não peça lib de i18n em PR que não a introduz; no máximo `thought (i18n)`.

## 7. QA (testes) — `tests`

Comportamento novo ou bug corrigido precisa de teste (DEV §9). A pergunta central: **este teste falharia se o código estivesse errado?**

- **Nível certo:** regra pura → unitário (Vitest: `apps/api/src/**/*.spec.ts`, `apps/app/src/**/*.test.tsx`); contrato HTTP, DB (privilégios, constraints, funções SQL), guards → integração (`apps/api/test/*.int-spec.ts`, Postgres local); fluxo crítico de usuário → E2E (`e2e/*.spec.ts`, Playwright). Mudança na API pede integração; mudança de fluxo de tela crítico pede E2E.
- **Cobertura do que importa:** caminho feliz **e** caminhos de erro, limites, vazio, permissão negada, acesso cruzado entre clubes/usuários, 4xx/5xx/429/503, idempotência. Bug corrigido ganha teste de regressão.
- **Qualidade:** testa comportamento observável, não implementação; nome descreve cenário e resultado; assert forte (nada de `toBeTruthy` onde cabe valor exato); sem `sleep`/timer real (use `createFakeClock`); sem dependência de rede externa, dado real ou ordem de execução; dados únicos (`uniqueEmail`) e limpeza (`deleteUsersByEmail`); e-mail com `EMAIL_PROVIDER=capture` e `getCapturedEmails`; usar os helpers existentes (`seedConfirmedUser`, `seedSignedInUser`, `resetRateLimitStore`, `renderApp`, `stubSessionFetch`) em vez de reinventar.
- **Sinais de alerta:** teste editado para passar (asserção relaxada, `skip`/`only`, `expect` removido), mock que reimplementa o código testado, teste que passaria sem a mudança, snapshot gigante sem leitura, flakiness por concorrência.
- **CI/gates:** consulte `gh pr checks`. Falha causada pelo PR é `issue (tests)`. Se **não há CI** (estado atual do projeto) ou nada foi executado, registre em "Não verificado": você **não roda** os testes (não faz checkout do PR).
- Comportamento novo **sem nenhum teste** é `issue (tests)`. Teste existente mas fraco é `suggestion (tests)`.

## 8. Observabilidade — `o11y`

DEV §7 e ARQ §4.4 são o contrato. Só se o PR toca backend, jobs, integrações ou fluxo operacional.

- **Logs:** estruturados (`pino`/`StructuredLogger`), com `requestId`, operação, duração e resultado; **nunca** `console.log` em código de produto; nível adequado (`warn` para falha esperada, `error` para inesperada).
- **Sem PII e sem segredo:** nenhum token, senha, e-mail, nome, documento, conversa, IP, `userId`/`sid`, header, query string ou corpo em log, métrica, label ou atributo de span. Cuidado com `logger.error(error)` que serializa a mensagem do Postgres (pode conter valores).
- **Cardinalidade:** labels/atributos só de **conjuntos fechados** (`operation`, `outcome`, `reason`); texto vindo do cliente nunca vira label. Código de erro novo entra em `AUTH_FAILURE_REASONS` e no dashboard.
- **Operação de auth nova:** `AUTH_OPERATIONS`, mapa de endpoints de `auth-telemetry.middleware.ts` e `traceAuthOperation` no request handler.
- **Acesso a dados novo:** toda query passa por `DatabaseClient.query(call, text, values)` com `operation` e alvo declarados, sem SQL nem valores em span, métrica ou log, e SQL sempre parametrizado (`$1..$n`), sem concatenar valor. Histograma novo com `DURATION_BUCKETS_SECONDS`.
- **Alertas e dashboards:** regra nova em `rondo-alerts.yaml` (`uid` <= 40 caracteres, `for`, `severity`, limiar; evento raro conta logs no Loki) e o teste `grafana-assets.spec.ts`; mudança de nome de métrica/label exige mudar dashboard e teste.
- **Resiliência da telemetria:** nunca decide a resposta nem derruba o request; exportação nunca bloqueia; falha de conector é registrada e isolada.
- **Sem sinal = sem diagnóstico:** `catch` vazio, erro engolido, caminho de falha sem log/métrica/span; operação nova sem contagem e latência; anti-enumeração: mesmo sinal com e sem conta.
- Vazamento de PII em telemetria é `issue (o11y, security)`. Falta de métrica em endpoint novo é `suggestion` ou `issue`, conforme o grau de criticidade do fluxo.

---

## Dimensões extras (além das oito)

### 9. Segurança — `security`

- **Autorização:** a API é fechada por padrão (guard global); `@Public()` novo precisa de motivo. Verifique papel/propriedade do recurso (IDOR), isolamento por clube/workspace/usuário e **teste de acesso cruzado** (DEV §6). O banco não usa RLS: a API é o único cliente e acessa como `rondo_app`; um predicado de tenant ausente numa query é falha de autorização.
- **Entrada e saída:** validação na fronteira; injeção (SQL concatenado em vez de parametrizado, comando, HTML); XSS (`dangerouslySetInnerHTML`, e-mail sem a tag `html` que escapa); SSRF e _path traversal_ em conectores/upload; upload com tipo e tamanho validados; redirecionamento aberto.
- **Segredos e dados:** nada de chave/token/`.env` no repositório; `DATABASE_URL` e `DATABASE_MIGRATOR_URL` só no servidor (nunca `VITE_*`); só `VITE_*` (públicas) no browser; mensagem de erro sem stack nem detalhe interno; dado pessoal minimizado, sem retenção indefinida (LGPD; dados de atletas e clubes).
- **Abuso:** rate limit em endpoint sensível/barato de atacar, comparação em tempo constante para segredos, enumeração de contas, timing.
- **Dependência:** pacote novo com CVE conhecida, abandonado ou de licença incompatível.
- Falha de segurança comprovada é `issue (security)`. Defesa em profundidade é `suggestion`. Ao citar um segredo vazado, indique arquivo e linha **sem repetir o valor**.
- Decisões já tomadas e documentadas (ex.: token em `localStorage`, ADR 0009; _fail-open_ do rate limit, ADR 0005) **não** são defeitos: registre `note` se relevante.

### 10. Arquitetura e design — `architecture`

Dependências apontando para dentro; ports no `domain`; abstração justificada por dois usos reais (KISS/WET); acoplamento a detalhe (SDK, framework) no domínio; módulo que conhece demais outro; decisão estrutural **sem ADR** (nova dependência relevante, contrato entre partes, modelo de dados, autenticação, multi-tenancy, observabilidade, estratégia de testes) é `chore (architecture, docs)` bloqueante conforme RULES §5.

### 11. Resiliência — `bug` ou `architecture`

Timeout, retry limitado, erro tipado, falha parcial, _fail-open_ vs _fail-closed_ consciente, limpeza de recursos (timer, listener, conexão), _graceful shutdown_, ordem correta commit → efeito colateral (e-mail só **depois** do commit, via `dispatch`).

### 12. Dados e migrations — `data`

Reversível e compatível com o código antigo (expandir/contrair); sem lock longo em tabela grande (`ADD COLUMN ... NOT NULL DEFAULT` volátil, `CREATE INDEX` sem `CONCURRENTLY` onde couber); nome `<timestamp>_<descricao>.sql`; comentário de rollback; `snake_case`; FKs e índices justificados; tipos explícitos; seed sem dado real; função SQL com `revoke`/`grant` corretos.

### 13. API e compatibilidade — `api`

Mudança que quebra cliente existente (campo removido/renomeado, status alterado, código de erro mudado) exige migração e aviso; `v2` exige ADR; código de erro novo documentado e no envelope padrão; status HTTP coerentes (`400` validação, `401`, `403`, `404`, `409`, `429`, `503`); respostas e erros sem vazar existência de conta.

### 14. Dependências e build — `deps`

Dependência nova com problema, alternativa e custo justificados; instalada no workspace consumidor (não na raiz); licença e manutenção; peso no bundle; versões fora do escopo atualizadas; lockfile editado à mão; mudança em `turbo.json`/scripts sem ler `node_modules/turbo/docs/README.md`.

### 15. Escopo, PR e documentação — `scope`, `docs`

PR focado (um assunto); refatoração, renomeação ou reformatação **fora da tarefa** (RULES §7) vira `suggestion (scope)` pedindo para separar; descrição clara com link para spec/plano/ADR; `.docs/` atualizado quando a realidade mudou (código vence docs, e o doc deve acompanhar na **mesma** mudança); lista de skills/agentes em `.docs/AGENTS.md` e `RULES.md` coerente quando skills ou agentes mudam; artefato gerado, segredo ou `.env` commitado; `TODO` sem dono; plano de rollback para mudança arriscada (migration, config, infra).

---

## Calibragem de severidade

| Situação | Comentário |
| --- | --- |
| Bug comprovado, perda de dado, falha de segurança, quebra de contrato sem migração | `issue` |
| Regra "não negociável" dos docs violada (`any`, PII em log, handler com 2 casos de uso, input sem label, `console.log`) | `issue` |
| Comportamento novo ou bug corrigido **sem teste** | `issue (tests)` |
| Falha de integração/migration sem rollback ou sem tratamento do caminho de falha | `issue` |
| Melhoria clara, mas o PR funciona sem ela | `suggestion` |
| Dúvida cuja resposta pode mudar a correção | `question (blocking)` |
| Dúvida de curiosidade ou contexto | `question` |
| Preferência pessoal, estilo não coberto pelo lint | `nitpick` |
| Ideia para depois | `thought` |
| Algo bem feito | `praise` |

**Orçamento de atenção:** priorize 1 `issue` bem fundamentado acima de 10 `nitpick`. Se a revisão passa de ~25 comentários, você está comentando demais: junte padrões repetidos e corte o que o autor não faria diferente.
