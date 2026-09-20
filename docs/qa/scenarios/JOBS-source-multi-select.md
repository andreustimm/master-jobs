---
id: JOBS-source-multi-select
area: JOBS
title: Escolher várias fontes de uma vez e voltar ao acervo inteiro
persona: Andreus em triagem
journey: J-find-jobs-by-work-mode
expected: Marcar duas fontes e aplicar uma vez mostra só as vagas delas; a lista de fontes continua oferecendo todas, e limpar devolve o acervo
entry_points: /jobs?source=ashby&source=lever
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: JOBS-pay-filter
---

A fonte deixou de ser uma fileira de chips e virou uma lista de seleção
múltipla que abre no lugar, empurrando as linhas abaixo — ela não pode ficar
cortada em resolução nenhuma. O "Aplicar" fica dentro da lista, junto da
escolha.

A conferir: a lista oferece TODAS as fontes mesmo com duas já escolhidas;
recarregar mantém as marcas; a URL repete `source=`; um `source=x` sozinho,
formato antigo que ainda circula em link salvo, continua valendo; desmarcar
tudo e aplicar volta ao acervo inteiro, não a um quadro vazio.
