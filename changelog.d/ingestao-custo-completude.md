## Técnico

### Corrigido

- Janela parcial não fecha mais vaga por ausência (#211). Todo adapter declara
  em `fetchJobs()` se a listagem é `complete` ou `partial` (`SourceSnapshot`), e
  `syncOne()` só fecha o que deixou de listar quando `decideAbsenceClosure()`
  confirma listagem completa e não vazia. Himalayas, Remotive, Arbeitnow,
  RemoteOK, Adzuna e Jobicy — e SmartRecruiters, Workable, Braintrust e career
  pages quando cortados pelo teto — fechavam a cada rodada vagas que só tinham
  saído da janela; agora essas fecham apenas por 404/410 na reconferência.
- `enqueueStale()` e `verifyJobs()` leem a melhor nota por vaga de um CTE
  agregado uma vez (`bestPrimaryFitByJob`) em vez de uma subconsulta
  correlacionada por vaga repetida no `WHERE` e no `ORDER BY`. Novo índice
  `job_score_job_idx (job_id, fit)`, migração aditiva `0015_job_score_job_idx`.
- A reconferência agendada tem um dono só: o cron de `/api/cron/recheck` saiu
  de `vercel.json` e a varredura do GitHub é o único agendador de
  `jobs recheck`, travado por teste. A rota continua para chamada manual.

## pt-BR

### Corrigido

- Vagas de sites que mostram só as publicações mais recentes não somem mais do quadro só porque desceram na lista. Elas continuam abertas até a conferência do link confirmar que o anúncio saiu do ar.

### Melhorado

- A conferência diária de vagas ainda abertas ficou mais leve para o sistema.

## en

### Fixed

- Jobs from sites that only show their latest postings no longer disappear from the board just because they moved down the list. They stay open until the link check confirms the posting was taken down.

### Improved

- The daily check of jobs that are still open is now lighter on the system.
