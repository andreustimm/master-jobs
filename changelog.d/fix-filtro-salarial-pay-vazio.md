## Técnico

### Corrigido

- Aplicar a faixa salarial com o mínimo vazio não grava mais `pay=` vazio na URL (#520). `PayRange` liga `omitEmptyMin` no `RangeSlider`, que já servia ao Funil: para o leitor da URL (`app/filter-state.ts`), `pay` ausente e `pay=` vazio são o mesmo "sem piso". O Score segue gravando `fit=` vazio, porque lá vazio ("toda nota") difere do ausente (o corte padrão). E2E novo na área `searches`.

## pt-BR

### Corrigido

- Em Vagas, filtrar só pelo teto salarial deixa a URL limpa, sem um mínimo vazio.

## en

### Fixed

- In Jobs, filtering by a salary cap alone keeps the URL clean, without an empty minimum.
