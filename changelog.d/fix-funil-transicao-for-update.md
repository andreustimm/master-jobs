## Técnico

### Corrigido

- `setApplicationStatusInTransaction` (`src/core/db/repo.ts`) passa a seguir o mesmo padrão que `undoApplicationStatus` já usa (#346): a leitura de `previous` agora usa `SELECT ... FOR UPDATE`, e não um `SELECT` comum — sem a trava, um avançar-e-recuar real de outra sessão entre a leitura e a gravação podia devolver o mesmo `status` (ABA) sem ser o mesmo estado, e a comparação otimista de `commitOverSnapshot` não via a diferença: a decisão (inclusive o `appliedAt` que ela carrega) era tomada sobre uma foto velha e sobrescrevia um carimbo real gravado no meio da janela (#356). O bloco que grava a transição (criação ou `commitOverSnapshot`, mais o evento) mapeia `23505` para `ApplicationTransitionConflictError` via `isDuplicateKey`, cobrindo também a primeira observação: duas transições concorrentes para o mesmo par candidato/vaga sem candidatura prévia correm para o mesmo `INSERT`, e só uma vence `application_candidate_job_idx` — a outra recebe o conflito conhecido, não um erro cru do driver. `decideSuggestion` (`src/core/mail/run.ts`) lê `owned` com `FOR UPDATE` pela mesma razão: sem a trava, uma igualdade trivial entre `suggestedStatus` e um `status` que já ficou velho por trás de um avanço real em voo podia pular o guard de regressão de `mailMayMove` inteiro, e a gravação (que relê `previous` já travada) regredia o funil em silêncio. Três testes de corrida real com duas conexões PostgreSQL, que reprovam sem a trava correspondente (`tests/repo.application.test.ts`, `tests/mail-suggestion.test.ts`).

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
