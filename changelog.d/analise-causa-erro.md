## Técnico

### Corrigido

- Análise estruturada (#438): `processNextAnalysis` grava o status HTTP da recusa do provedor em `job_analysis.provider_status` (migração `0032_job_analysis_provider_status`, aditiva: uma coluna `integer` anulável), só o número, nunca a mensagem nem o corpo. `failureCause` (puro, em `job-structure.ts`) traduz código e status em causa: 404/410 modelo desligado, 401/403 chave sem permissão, 5xx/408/`network` provedor instável, outro 4xx pedido recusado; `provider_error` sem status (como as tentativas antigas) vira causa desconhecida e continua legível. Os adapters (`providers.ts`) passam a olhar o status antes do corpo: recusa com corpo vazio, texto ou HTML de gateway vira sempre `LlmError` com o status, em vez de `SyntaxError` gravado como `network` ("provedor instável"); o corpo cru nunca vira mensagem. `jho analysis run` imprime `errorCode` e `providerStatus` quando o provedor recusa ou não responde, e para na primeira recusa permanente (modelo desligado ou chave sem permissão), sem gastar tentativa do resto da fila.
- Cadastro de LLM (#438): `src/core/llm/model-retirement.ts` lista os modelos que o provedor desligou, com status e data — os três NIM da semente (Kimi K2 410 em 2026-05-12, Qwen3 Coder 480B 410 em 2026-06-11, Llama 3.1 405B 404). A semente não os cadastra mais e diz quais pulou; `listModels` marca `retired`; `chooseModel` nunca devolve um deles, nem por `--model` nem como padrão gravado; `setDefaultModel(modelId, providerSlug?)` devolve `"ok" | "not_found" | "retired" | "ambiguous"`, recusa o desligado e o id que existe em mais de um provedor sem `--provider` (`jho llm use <modelo> --provider <slug>`). Sem modelo vivo com chave, `jho analyze` e `jho analysis run` dizem "Nenhum modelo disponível: escolha um" com o motivo (`explainNoModel`) e não reivindicam nada; `jho llm list` sinaliza o desligado.

## pt-BR

### Corrigido

- Quando a análise de uma vaga falha, o administrador vê o motivo: modelo desligado pelo provedor, chave sem permissão ou provedor instável, com o que fazer antes de tentar de novo. O botão de nova tentativa avisa quando é preciso trocar o modelo primeiro.
- O cadastro de modelos de IA não oferece mais os modelos que a NVIDIA desligou, e avisa quando não há nenhum modelo disponível em vez de falhar depois.

## en

### Fixed

- When a job analysis fails, the administrator sees why: model retired by the provider, key not authorized or provider unstable, with what to do before retrying. The retry button says when the model must be changed first.
- The AI model registry no longer offers the models NVIDIA retired, and says when no model is available instead of failing later.
