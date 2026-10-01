## Técnico

### Corrigido

- O vazio de busca por termo descreve os filtros aplicados, sem inferir ausência do termo em todo o acervo.
- A mensagem de zero resultados agora distingue de fato "0 vagas com este filtro" de "termo ausente no acervo" (`hasFilterBeyondTerm`): a primeira correção trocara uma frase única por outra, ainda sem a distinção.
- A distinção agora vale também quando o corte padrão de fit (45) ou o status padrão (esconde candidatura arquivada) é a causa do zero, sem filtro nenhum escolhido (`termExistsInOpenCorpus`).

## pt-BR

### Corrigido

- Quando uma busca fica vazia, a mensagem esclarece que nenhum resultado corresponde aos filtros atuais e orienta como ampliar a busca.
- Sem nenhum filtro escolhido, a mensagem passa a dizer que o termo não está no acervo, em vez de pedir para remover filtros que você não tinha.
- Um termo que existe só numa vaga abaixo da nota padrão (ou só numa vaga arquivada) também mostra a mensagem de recorte, não a de ausência.

## en

### Fixed

- Empty search results now refer to the current filters and explain how to broaden the search.
- With no filter chosen, the message now says the term is not in the corpus, instead of asking to remove filters you never set.
- A term that only matches a job below the default fit cut (or only an archived one) also shows the narrowed-down message, not the absent one.
