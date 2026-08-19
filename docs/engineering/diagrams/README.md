# Diagramas

Todos em Mermaid, renderizáveis direto no GitHub e no Obsidian.

## C4 — arquitetura em três níveis

| Nível | Documento | O que responde |
|---|---|---|
| 1 · Contexto | [c4-01-context.md](c4-01-context.md) | Quem usa e com que sistemas externos fala |
| 2 · Containers | [c4-02-container.md](c4-02-container.md) | Unidades executáveis e onde o estado vive |
| 3 · Componentes | [c4-03-components.md](c4-03-components.md) | Módulos de `src/core` e como se compõem |

Não há nível 4 (código) de propósito: nessa profundidade o código é a
documentação, e um diagrama envelheceria mais rápido do que seria lido.

## Fluxos

| Documento | O que mostra |
|---|---|
| [flow-sync.md](flow-sync.md) | Sincronização: fingerprint, dedupe, invalidação de score, sweep de fechamento |
| [flow-scoring.md](flow-scoring.md) | Os cinco componentes do fit e o caminho da remuneração |
| [flow-email.md](flow-email.md) | Parsing de e-mail até a sugestão de funil |
| [flow-funnel.md](flow-funnel.md) | Máquina de estados da candidatura e quem pode escrever nela |
| [flow-journey.md](flow-journey.md) | A semana do candidato, ponta a ponta |

## Dados

| Documento | O que mostra |
|---|---|
| [data-model-er.md](data-model-er.md) | As 14 tabelas e as três naturezas de dado |

---

## Como ler estes diagramas

Vale mais atenção às **setas ausentes** do que às presentes. Três ausências
carregam as decisões centrais do projeto:

1. **Nada aponta de `job-hunt-os` para a plataforma do LinkedIn.** O sistema lê
   o que o LinkedIn envia por e-mail e nunca consulta a plataforma
   ([ADR 0001](../../adr/0001-nao-fazer-scraping-do-linkedin.md),
   [ADR 0008](../../adr/0008-ingestao-de-email-como-fonte-de-sourcing.md)).

2. **Nenhuma ingestão escreve em `application`.** Sync, import, verify e e-mail
   tocam `job` e produzem sugestões; a decisão é sempre humana
   ([ADR 0005](../../adr/0005-separacao-entre-fato-observado-e-decisao-do-usuario.md)).

3. **`scoring` não faz rede.** Ele lê `fx_rate`, o que mantém a pontuação pura,
   offline e reproduzível.
