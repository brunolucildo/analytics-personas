# Negócio

> **Público:** qualquer pessoa que precise entender o produto antes de decidir ou codar.
> **Verificado contra o código em:** 2026-11-05. O produto ainda não foi implementado; este documento descreve intenção e vocabulário, não funcionalidades prontas.

## 1. Problema

Clubes de futebol acumulam conhecimento em ferramentas dispersas: documentos no Drive, páginas no Notion/Confluence, chamados no Jira/Linear, planilhas e PDFs. Cada função (técnico, analista, jurídico, fisiologista) precisa transformar esse acervo em decisões rápidas, mas o acesso é fragmentado e o contexto raramente chega pronto.

## 2. Proposta de valor

Uma plataforma onde o usuário configura **experts** — agentes especializados em uma função do clube — conecta as fontes de dados autorizadas e faz demandas em linguagem natural. O expert recupera o contexto relevante, analisa e entrega uma resposta **rastreável às fontes**, no formato daquela função.

O diferencial não é "um chat genérico": é ter especialização por função, fontes conectadas e respostas auditáveis.

## 3. Conceitos do domínio

| Termo                    | Definição                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Expert**               | Agente de IA configurado para atuar como uma função específica do clube. Tem escopo, fontes autorizadas e formato de entrega.   |
| **Persona**              | Termo do nome anterior do produto (`analytics-personas`, hoje **Rondo**); neste documento, o conceito operacional é **Expert**. |
| **Conector**             | Integração que traz dados de uma fonte externa (Notion, Drive, Jira etc.).                                                      |
| **Fonte**                | Documento, página, arquivo ou registro obtido por um conector.                                                                  |
| **Base de conhecimento** | Conjunto de fontes indexadas e disponíveis para um expert.                                                                      |
| **Demanda**              | Pedido feito pelo usuário a um expert.                                                                                          |
| **Entrega**              | Resposta do expert: análise, relatório, plano ou recomendação, com citações das fontes.                                         |
| **Clube**                | Organização atendida. Limite de isolamento de dados (modelo a confirmar).                                                       |
| **Área / Posição**       | Função de futebol que define o escopo do expert (ex.: Head Coach, Fisiologista).                                                |

## 4. Experts iniciais

Exemplos de configuração, não requisitos fechados:

| Expert                            | Responsabilidade                                            | Entradas típicas                                              | Saídas típicas                                                     |
| --------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Head Coach Expert**             | Apoiar decisões de treino, escalação e estratégia de jogo   | Relatórios de adversário, dados de treino, elenco, calendário | Plano de treino, análise de adversário, recomendações de escalação |
| **Analista de Desempenho Expert** | Interpretar métricas individuais e coletivas                | Dados de partida/treino, scouts, vídeos e relatórios          | Análise de desempenho, comparativos, alertas                       |
| **Jurídico Esportivo Expert**     | Apoiar contratos, regulamentos e transferências             | Contratos, regulamentos de federação, normas da FIFA/CBF      | Resumo de riscos, checklist contratual, parecer                    |
| **Fisiologista Expert**           | Apoiar controle de carga, recuperação e prevenção de lesões | Dados físicos, carga de treino, histórico de lesões           | Recomendações de recuperação, alertas de sobrecarga                |

## 5. Conectores previstos

| Categoria              | Conectores                      |
| ---------------------- | ------------------------------- |
| Gestão de conhecimento | Notion, Confluence, Google Docs |
| Arquivos               | Google Drive, PDF, Markdown     |
| Gestão de trabalho     | Jira, Linear, ClickUp           |
| Dados tabulares        | Google Sheets                   |

Requisitos mínimos para qualquer conector:

1. Autenticação e autorização explícitas do clube.
2. Ingestão idempotente e incremental (não duplicar documentos).
3. Metadados de origem preservados (título, URL, autor, data, permissões).
4. Citação da fonte na entrega do expert.
5. Revogação de acesso e remoção dos dados indexados.

## 6. Fluxo de valor (alvo)

```text
1. Administrador conecta uma fonte e autoriza o acesso.
2. A plataforma ingere, normaliza e indexa os documentos.
3. Usuário seleciona um expert e descreve a demanda.
4. O expert recupera os trechos relevantes, analisa e responde com citações.
5. O usuário avalia a entrega e refina a demanda; o histórico fica disponível.
```

O fluxo acima é o alvo. Nenhuma etapa está implementada no repositório atual.

## 7. Escopo

### Dentro do escopo do produto

- Configuração de experts por função.
- Conexão e ingestão de fontes externas.
- Demanda em linguagem natural e entrega com citações.
- Histórico de demandas e entregas.
- Controle de acesso por clube e por expert.

### Fora do escopo desta fase

- Treinar modelo próprio.
- Substituir sistemas oficiais de federações ou clubes.
- Edição colaborativa de documentos.
- Aplicativo mobile nativo.
- Faturamento e cobrança.
- Análise em tempo real durante partidas.

## 8. Métricas de sucesso (hipóteses a validar)

| Métrica                                         | O que indica                   |
| ----------------------------------------------- | ------------------------------ |
| Tempo até a primeira resposta útil              | Velocidade de geração de valor |
| % de entregas com pelo menos uma citação válida | Rastreabilidade e confiança    |
| Taxa de conclusão da demanda                    | Se o expert resolve o problema |
| Demandas por clube por semana                   | Retenção e uso real            |
| Fontes conectadas por clube                     | Profundidade de contexto       |

## 9. Decisões em aberto

Estas decisões afetam diretamente o modelo de dados e a arquitetura. Não as assuma sem validação:

1. **Multi-tenant:** o isolamento é por clube, por usuário ou por workspace? RLS é obrigatória?
2. **Autenticação:** Supabase Auth é suficiente ou haverá provedor próprio? Se houver, o `bcrypt` citado no stack original pode ser redundante.
3. **LLM:** provedor único, multi-provedor ou chave trazida pelo cliente (BYOK)?
4. **Ingestão:** sincronização contínua, agendada ou sob demanda? Quem paga o custo de indexação?
5. **Permissões:** um expert pode acessar qualquer fonte do clube ou apenas as explicitamente vinculadas?
6. **Retenção e LGPD:** por quanto tempo documentos e conversas ficam armazenados? Como atender exclusão?
7. **Ordem dos conectores:** qual integração entrega valor primeiro? (Recomendação: começar por upload de PDF/Markdown e Google Drive.)
8. **Cobrança:** por clube, por assento, por volume de demandas ou por uso de LLM?

## 10. Regras de produto para o código

- Nenhuma entrega sem indicar as fontes usadas.
- Nenhum expert acessa fonte fora do escopo autorizado.
- Nenhuma resposta deve inventar dado ausente; quando faltar contexto, o expert deve declarar a lacuna.
- Histórico e citações precisam sobreviver à revogação de acesso de forma compatível com a política de retenção.
- Textos de interface, mensagens da API e e-mails em **en-US** (decisão de 2026-11-09; ver `DEVELOPMENT.md` §13). Esta documentação, as specs e os ADRs continuam em pt-BR. Internacionalização (vários idiomas) exige decisão explícita.
