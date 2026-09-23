## Técnico

### Adicionado

- Análise estruturada da vaga (#223, tarefa 06). Tabela `job_analysis`
  (migration aditiva `0018_job_analysis`): uma linha imutável por tentativa,
  `retry_of` para a nova tentativa, índice único parcial por
  `(job_id, input_hash, schema_version)` nos estados ativos e lease de 10 min
  (`running` vencido vira `interrupted`). Regras puras em
  `src/core/llm/job-structure.ts` (`buildStructureInput`, `bindEvidence`,
  `interpretOutput`, `decideAnalysisRequest`); fila e processador em
  `src/core/llm/job-analysis.ts`; `isStale` em
  `src/contexts/operations/domain/runs.ts`.
- Prompt versionado `docs/prompts/system/job-structure.md`: entrada só com a
  vaga (título, empresa, local, anúncio), saída JSON por campo com
  proveniência, confiança e trechos. Trecho que não está no texto rebaixa o
  campo para desconhecido; o corpo do provedor e a chave nunca são gravados.
- `jho analysis queue <id>`, `jho analysis run` (confirmação antes de enviar,
  BYOK) e `jho analysis status`. Seção "Análise estruturada" na tela da vaga,
  com pedido (`requestJobAnalysisAction`, `job:read`) e, só para admin,
  modelo, tokens, custo e nova tentativa (`retryJobAnalysisAction`,
  `admin:access`).
- Reuso: análise `succeeded` do mesmo texto e versão de esquema é devolvida
  sem nova chamada paga; nova tentativa só depois de `failed`, `partial`,
  `paused_quota` ou `interrupted`, até três pedidos por texto.

## pt-BR

### Novidades

- A tela da vaga ganhou uma análise estruturada: nível, contratação, modelo de trabalho, restrição de local, fuso, remuneração e o que a vaga exige, cada item com o trecho do anúncio que o sustenta. O que o anúncio não diz aparece como desconhecido, e um aviso mostra quando a vaga mudou depois da análise.

## en

### New

- The job page now has a structured analysis: seniority, employment, work model, location restriction, time zone, compensation and what the job requires, each backed by the passage of the posting that supports it. What the posting does not say shows as unknown, and a notice appears when the job changed after the analysis.
