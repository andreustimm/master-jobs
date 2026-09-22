---
id: SRCH-track-create-edit
area: SRCH
title: Criar uma trilha a partir da sugestão e editar suas faixas
persona: Andreus em triagem
journey: J-manage-target-tracks
expected: A sugestão preenche o formulário; a trilha salva reaparece com os mesmos títulos, palavras, senioridade e faixas depois da recarga
entry_points: /searches/tracks/new?term=laravel; /searches/tracks/<id>
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-saved-term-reaches-new-jobs-baseline-05-trilha-criada.png
last_report: docs/qa/reports/2026-09-21T175034729239Z-e901131e-qa-buscas.md
overlaps: SRCH-track-primary-archive
---

Faixas escritas como "USD month 7500 12500 18000" são aceitas; faixa com
piso acima do alvo é recusada com mensagem do campo e o texto digitado
permanece. Salvar a mesma trilha em duas abas: a segunda é recusada por
edição concorrente e oferece recarregar. O nome da trilha principal não é
editável. Depois de salvar, o cartão de recálculo aparece até a fila
terminar.
