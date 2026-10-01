## Técnico

### Corrigido

- O rótulo de remuneração das mensagens de score (`comp.ideal`, `comp.target`, `comp.range`, `comp.below`, `comp.noBasis`, `comp.projectNoDuration`) passa a ter o período no idioma de quem lê. O scorer continua gravando o rótulo pronto e sem idioma (`$5,000/month`, `total (2 meses)`); `renderScoreMessage` troca o sufixo pelas chaves `jobs.moneyPeriod*` e `jobs.moneyProject*` na hora de exibir. A saída gravada não muda: sem aumento de `SCORER_VERSION` e sem repontuação (#426).

## pt-BR

### Corrigido

- A explicação de salário no score de uma vaga agora mostra o período em português ("/mês", "/hora") quando a tela está em português, em vez de "/month".

## en

### Fixed

- The pay line in a job's score explanation now follows the interface language: fixed-price projects read "total (2 months)" in English instead of "total (2 meses)".
