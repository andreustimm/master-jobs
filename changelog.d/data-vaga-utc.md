## Técnico

### Corrigido

- `/jobs/[id]`: o "visto em" do cabeçalho e a data de cada linha do histórico da candidatura saem pela ilha `LocalDate` (`app/local-date.tsx`, `testId` `job-first-seen` e `application-timeline-event-date`), no fuso do navegador, em vez de `slice(0, 10)` do instante, que dava o dia em UTC e divergia do Funil à noite em São Paulo. O formato passa de `2026-10-07` para o dia por extenso do idioma da tela (`formatDay`). `tests/job-detail-local-date.test.ts` guarda a página; a área `pipeline-filters` do E2E ganha E2E-500, em `America/Sao_Paulo`, com `firstSeenAt` e um evento de histórico fixos na vaga `908000000` (#500).

## pt-BR

### Corrigido

- No detalhe da vaga, o "visto em" e a data de cada passo do histórico da candidatura agora aparecem no seu fuso, como no Funil: o que você registrou às 23:45 em São Paulo não vira mais o dia seguinte, e as duas telas concordam. A data passa a ser escrita por extenso ("7 de out. de 2026").

## en

### Fixed

- On the job page, the "first seen" date and the date of each step in the application history now show in your time zone, like the Pipeline: what you logged at 11:45 pm in São Paulo no longer becomes the next day, and the two screens agree. The date is now written out ("Oct 7, 2026").
