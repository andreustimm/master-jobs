## Técnico

### Corrigido

- `boardConditions` (`src/core/db/repo.ts`) ganha `keepUnscored`: com ele, vaga sem nota do candidato passa pelo filtro de Score (`fit is null or …`, no mínimo e no máximo) em vez de valer zero. `toBoardFilters` e as facetas de `/jobs` e do cockpit o pedem, então lista, total, faixa salarial, facetas, cockpit e exportação deixam de mostrar o quadro vazio ao candidato recém-criado sob o corte padrão de 45 (#279, regra 8). Relatório, `jobs list` e a varredura de triagem continuam estritos; a ordenação continua levando as sem nota para o fim; o acervo sem escopo de candidato não muda.
- `hasTrackScores` e `corpusStats().scored` dizem se o candidato já tem nota na trilha principal; `/jobs` (aviso `scores_pending`) e o cockpit mostram que o cálculo está pendente enquanto não tem.

## pt-BR

### Corrigido

- Conta nova agora vê as vagas em Vagas e no início antes de as notas serem calculadas, com um aviso de que o cálculo ainda está em andamento. Antes, a tela ficava vazia.

## en

### Fixed

- A new account now sees jobs on Jobs and on the home screen before its scores are calculated, with a notice that the calculation is still running. The screens used to be empty.
