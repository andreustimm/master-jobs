## Técnico

### Corrigido

- O vazio da busca por termo na tela Vagas escolhe a frase pelo acervo, não pelos filtros da URL: `loadJobsView` consulta `termExistsInOpenCorpus` (mesmo casamento de termo do quadro, sem fit, status, fonte, modalidade, trilha nem faixa) quando a lista vem vazia, e a tela diz "corresponde com os filtros atuais" se o termo existe em alguma vaga aberta ou "ausente do acervo" se não existe.

## pt-BR

### Corrigido

- Quando uma busca por termo não acha nada, a mensagem agora distingue os dois casos: se o termo existe no acervo e algum filtro (inclusive a nota mínima ou o status padrão) esconde as vagas, ela fala dos filtros atuais e orienta a ampliar a busca; se o termo não está em nenhuma vaga aberta, diz que o termo está ausente do acervo.

## en

### Fixed

- When a term search finds nothing, the message now tells the two cases apart: if the term exists in the corpus and a filter (including the minimum score or the default status) hides the jobs, it mentions the current filters and how to broaden the search; if no open job has the term, it says the term is absent from the corpus.
