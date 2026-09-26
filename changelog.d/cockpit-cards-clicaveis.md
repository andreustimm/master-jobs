## Técnico

### Adicionado

- Os cards de contagem do cockpit viraram links (#314): "vagas abertas" abre `/jobs?fit=0&ungrouped=1&status=any`; "empresa nomeada", "sem bloqueio" e "últimos 3 dias" abrem `/jobs` com o chip ligado e só os parâmetros que a faceta lê (`facetHref` em `app/filter-state.ts`); "melhor fit" abre a vaga de maior nota; "no funil" abre `/pipeline`. "Empresas" continua sem link. Cada card tem `data-testid="cockpit-stat-<chave>"` e dica do dicionário sobre o universo do número.
- `corpusStats` devolve `bestJobId`, calculado na mesma passada das notas por `max(array[fit, job_id])` — agregado de fluxo, sem ordenação nem segunda leitura de `job_score`.

### Corrigido

- Os números do cockpit saem com separador de milhar em todos os cards; "sem bloqueio", "últimos 3 dias" e "no funil" saíam crus.

## pt-BR

### Novidade

- Os números do topo do cockpit agora são clicáveis: cada um abre a lista que ele conta, com o filtro correspondente já ligado. "Melhor fit" abre a própria vaga e "no funil" abre o funil. Passe o mouse para ver de que conjunto cada número fala.

### Corrigido

- Todos os números do cockpit aparecem com separador de milhar.

## en

### New

- The numbers at the top of the cockpit are now clickable: each one opens the list it counts, with the matching filter already on. "Best fit" opens that job and "in pipeline" opens the pipeline. Hover to see which set each number describes.

### Fixed

- Every cockpit number now shows a thousands separator.
