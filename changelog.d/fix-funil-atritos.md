## Técnico

### Corrigido

- Tema HP escuro pelo sistema (`@media (prefers-color-scheme: dark)` em `app/themes.css`): `--primary` passa de #296ef9 para #4d8bff, igual à escolha explícita do escuro; o texto do botão primário tinha 4,34:1. `tests/design.test.ts` passa a exigir que os dois blocos escuros de cada tema sejam iguais e que `--primary-foreground` sobre `--primary` dê pelo menos 4,5:1 nos três modos (#494).
- `/pipeline`: o cartão do estágio escolhido ganha `ring-2 ring-primary` e `aria-current` (era `border-[var(--primary)]` sem largura de borda); "aplicado em" sai pela ilha `LocalDate` (`app/local-date.tsx`, `formatDay` em `src/core/i18n/date.ts`), no fuso do navegador; o selo e o seletor de canal mostram os canais documentados pelo dicionário (`channels.*`, `channelLabel`), com valor desconhecido como dado da pessoa; no seletor, valores que dariam o mesmo rótulo (`Referral` e `referral`) mostram o valor cru (`channelOptionLabel`). O histórico do recrutador (`/recruiter/[candidateId]`) também passa a usar `LocalDate`.
- `RangeSlider`: teto vazio deixa de ir para a URL (`fitMax=`); no Funil o piso vazio também (`omitEmptyMin`). Em Vagas `fit=` vazio continua indo, porque lá ele difere do ausente.
- `fit` ou `fitMax` não numérico gera o aviso `fit_invalid` em `/pipeline` e `/jobs` (`unreadableFit` em `app/filter-state.ts`), como manda o contrato de URL do Funil.

## pt-BR

### Corrigido

- No Funil, o estágio escolhido agora fica marcado, a data de "aplicado em" sai no seu fuso (às 23:45 não vira o dia seguinte) e o canal aparece em português ("indicação", "direto"). O histórico que o recrutador vê também mostra a data no fuso de quem lê.
- No tema escuro, o texto dos botões principais ficou mais legível.
- Um score inválido no link agora mostra aviso, no Funil e em Vagas, e aplicar só o mínimo do score não deixa mais um "fitMax=" vazio no link.

## en

### Fixed

- In the Pipeline, the chosen stage is now marked, the "applied on" date shows in your time zone (11:45 pm no longer becomes the next day), and the channel shows in your language. The history a recruiter sees also shows the date in the reader's time zone.
- In the dark theme, the text on primary buttons is easier to read.
- An invalid score in the link now shows a notice, in the Pipeline and in Jobs, and applying only the minimum score no longer leaves an empty "fitMax=" in the link.
