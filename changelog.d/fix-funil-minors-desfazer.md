## Técnico

### Corrigido

- `transitionDirection`/`transitionApplication`/`transitionGroups`/`allowedTransitions` (`src/contexts/pursuit/domain/application.ts`) ganham `reopenFrom` opcional (o `fromStatus` do evento de encerramento, lido por `lastStatusChangeFromStatus()`): reabrir Rejeitada, Retirada ou Arquivada fica limitado a até onde a candidatura chegou de verdade antes de fechar, e reabrir além disso é ilegal, não "voltar". Sem esse histórico, a reabertura continua livre para qualquer estágio, como antes desta correção. A decisão **não** usa `appliedAt` — a versão original desta correção usava, e a revisão L1 da PR #354 achou o Major: o domínio cria de propósito um registro direto em estágio avançado com `appliedAt` nulo (primeira observação), e `appliedAt` recusaria reabrir de volta para onde a candidatura realmente esteve. `mailMayMove` passou a checar `=== "forward" || === "close"`, e não `!== "back"` (#346).
- `setApplicationStatusInTransaction`/`undoApplicationStatus` (`src/core/db/repo.ts`) buscam `reopenFrom` via a nova `lastStatusChangeFromStatus()`. `undoApplicationStatus` lê a linha com `SELECT ... FOR UPDATE` antes de decidir: sem a trava, um avançar-e-recuar real de outra sessão entre a leitura e a gravação podia devolver o mesmo `status` (ABA) sem ser o mesmo estado, e a comparação otimista por status não via a diferença. O índice único de `reverts_event_id` (`23505`) agora vira `ApplicationTransitionConflictError`, nunca um erro cru do driver. Testes de concorrência real com duas conexões em `tests/repo.application.test.ts` (#346).
- `undoTransition` (`src/contexts/pursuit/domain/application.ts`): desfazer até `untracked` ("fora do funil") sempre limpa `appliedAt`, mesmo em linha legada cujo evento revertido não é literalmente `applied`. `listBoard`'s `hideApplied` (`src/core/db/repo.ts`) também aceita `status = 'untracked'` direto na consulta, para a linha que já chega pronta com o carimbo remanescente (dado anterior a esta correção) (#346).
- `decideSuggestion` (`src/core/mail/run.ts`): sugestão de e-mail para candidatura fora do funil recusa com `OutOfFunnelSuggestionError`, não `RegressiveSuggestionError` — não é uma regressão, e a mensagem não expõe o marcador interno `untracked` como se fosse um estágio real. `RegressiveSuggestionError` só é lançado quando a direção é literalmente `"back"`; outra ilegalidade (ex.: `shortlisted` → `interviewing`) segue para `IllegalApplicationTransitionError` (#346).

## pt-BR

### Corrigido

- No seletor "Mover para", reabrir uma candidatura Rejeitada, Retirada ou Arquivada agora só oferece até o estágio em que ela realmente esteve antes de fechar — nunca um estágio mais adiantado que ela nunca alcançou.
- Desfazer até tirar a vaga do funil agora sempre limpa a data de candidatura, mesmo em registros antigos — a vaga volta a aparecer normalmente com o filtro "ocultar candidatadas".
- A recusa de uma sugestão de e-mail para uma vaga fora do funil, ou para uma mudança que não existe no funil, agora explica o motivo certo, em vez de uma mensagem de regressão com um código interno ou falsa.

## en

### Fixed

- In the "Move to" selector, reopening a Rejected, Withdrawn or Archived application now only offers stages up to where it actually reached before closing — never a further stage it never got to.
- Undoing all the way out of the funnel now always clears the application date, even on legacy records — the job shows up normally again with the "hide applied" filter.
- Rejecting an email suggestion for a job that's outside the funnel, or for a change that doesn't exist in the funnel, now explains the real reason, instead of a regression message with an internal or false code.
