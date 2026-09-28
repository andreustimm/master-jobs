## Técnico

### Corrigido

- `transitionDirection`/`transitionGroups`/`allowedTransitions` (`src/contexts/pursuit/domain/application.ts`) ganham `appliedAt` opcional: reabrir Rejeitada, Retirada ou Arquivada continua livre até "Candidatura enviada", mas além dela (Triagem, Entrevista, Oferta) só é legal com `appliedAt` já gravado — sem essa trava, "Preparando → Arquivada → Oferta" pulava o carimbo e ficava nulo para sempre, e "Voltar" mentia. `mailMayMove` passou a checar `=== "forward" || === "close"`, e não `!== "back"`, para não deixar essa reabertura agora ilegal escapar como "permitida" (#346).
- `undoApplicationStatus` (`src/core/db/repo.ts`) lê a linha com `SELECT ... FOR UPDATE` antes de decidir: sem a trava, um avançar-e-recuar real de outra sessão entre a leitura e a gravação podia devolver o mesmo `status` (ABA) sem ser o mesmo estado, e a comparação otimista por status não via a diferença — o desfazer gravava sobre um histórico que já tinha mudado. O índice único de `reverts_event_id` (`23505`) agora vira `ApplicationTransitionConflictError`, nunca um erro cru do driver. Testes de concorrência real com duas conexões em `tests/repo.application.test.ts` (#346).
- `undoTransition` (`src/contexts/pursuit/domain/application.ts`): desfazer até `untracked` ("fora do funil") sempre limpa `appliedAt`, mesmo em linha legada cujo evento revertido não é literalmente `applied` — sem isso o carimbo sobrevivia escondido e `hideApplied` continuava ocultando uma vaga que voltou a ser "nunca registrada" (#346).
- `decideSuggestion` (`src/core/mail/run.ts`): sugestão de e-mail para candidatura fora do funil agora recusa com `OutOfFunnelSuggestionError`, não `RegressiveSuggestionError` — não é uma regressão, e a mensagem não expõe o marcador interno `untracked` como se fosse um estágio real (#346).

## pt-BR

### Corrigido

- No seletor "Mover para", reabrir uma candidatura Rejeitada, Retirada ou Arquivada direto para Triagem, Entrevista ou Oferta só aparece quando a candidatura já tinha data de envio; pular a Candidatura enviada deixava essa data em branco para sempre.
- Desfazer até tirar a vaga do funil agora sempre limpa a data de candidatura, mesmo em registros antigos — a vaga volta a aparecer normalmente com o filtro "ocultar candidatadas".
- A recusa de uma sugestão de e-mail para uma vaga fora do funil agora explica o motivo certo, em vez de uma mensagem de regressão com um código interno.

## en

### Fixed

- In the "Move to" selector, reopening a Rejected, Withdrawn or Archived application straight into Screening, Interview or Offer now only shows up once the application already has a submission date; skipping "Application sent" used to leave that date blank forever.
- Undoing all the way out of the funnel now always clears the application date, even on legacy records — the job shows up normally again with the "hide applied" filter.
- Rejecting an email suggestion for a job that's outside the funnel now explains the real reason, instead of a regression message with an internal code.
