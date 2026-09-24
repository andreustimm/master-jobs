## Técnico

### Segurança

- Os adapters de LLM (`src/core/llm/providers.ts`) apagam o valor exato da chave de qualquer erro que sai deles, por `redactSecret()`. `redactText` só conhecia o formato `sk-…`, e uma chave `nvapi-…` ecoada pelo provedor chegava inteira ao terminal e ao Sentry. Falha de `fetch` que cita o cabeçalho é reconstruída sem `cause` nem pilha original (#308, G41).
- `tests/llm-key-sentinel.test.ts` (V03-06): uma chave sentinela atravessa cadastro, escolha, porta e adapter reais e é procurada no erro, no evento do Sentry, na saída da CLI, em todas as tabelas do banco e no painel da análise; mutação local provou que cada observável reprova se a chave vazar.

### Corrigido

- O gate de chave em `tests/architecture.test.ts` isentava o ARQUIVO inteiro que citasse `apiKeyEnv`; a exceção agora é por ocorrência, cobre `app/` e tem caso negativo (E16).
- `pnpm check:qa-tracker` reprova cenário que cita jornada, bug, relatório ou evidência versionada inexistente; `evidence/`, ignorado pelo git por contrato, continua fora (E27).

## pt-BR

### Corrigido

- Quando o provedor de LLM recusa a chave e a repete na resposta, a mensagem de erro do `jho analyze` não mostra mais a chave, qualquer que seja o formato dela.

## en

### Fixed

- When the LLM provider rejects the key and echoes it back, the `jho analyze` error message no longer shows the key, whatever its format.
