## Técnico

### Adicionado

- Funil: desfazer a última movimentação (`undoApplicationStatus`, `undoTrackAction`) grava um `status_change` compensatório com `application_event.reverts_event_id` (migração aditiva `0027`, FK `cascade`, índice único); o evento revertido nunca é editado. O id do evento visto é o token otimista: outra aba no meio devolve `conflict`. Desfazer o primeiro registro deixa `application.status = 'untracked'` (fora do funil, sem DELETE), excluído de contagens, listas, análise e casamento de e-mail por `inFunnel()` e ainda protegido da retenção (#316).

### Alterado

- Máquina de estados do funil: voltar para qualquer estágio anterior, `rejected`/`withdrawn`/`archived` reabrem, Preparando pode arquivar e rejeitar/retirar valem de todo estágio depois de `applied`; `transitionDirection`/`transitionGroups` agrupam avançar, voltar e encerrar. `applied_at` só é limpo ao desfazer a própria entrada em `applied`. Opções de status em ordem de funil, não alfabética. Aceite de sugestão de e-mail que regrediria o funil é recusado (`RegressiveSuggestionError`) e a sugestão fica pendente (#316).

## pt-BR

### Novidade

- Na vaga, "Mover para" agora separa Avançar, Voltar e Encerrar, mostra em que estágio a candidatura está e deixa voltar para qualquer estágio anterior — inclusive reabrir uma candidatura rejeitada, retirada ou arquivada.
- Depois de mover, o aviso traz "Desfazer" por 10 segundos, e a movimentação mais recente do histórico também tem o botão. O que foi desfeito continua no histórico, marcado como desfeito; desfazer o primeiro registro tira a vaga do funil.

## en

### New

- On a job, "Move to" now splits Move forward, Move back and Close, shows which stage the application is in, and lets you go back to any earlier stage — including reopening a rejected, withdrawn or archived application.
- After a move, the notice offers "Undo" for 10 seconds, and the latest move in the history has the button too. Undone moves stay in the history, marked as undone; undoing the first entry takes the job out of the funnel.
