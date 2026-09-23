---
id: JOBS-term-filter-descriptions
area: JOBS
title: Filtrar Vagas por um termo que só aparece na descrição
persona: Andreus em triagem
journey: J-save-term-search
expected: A busca encontra a palavra inteira no título, na empresa e na descrição, e não encontra pedaço de palavra
entry_points: /jobs?q=laravel
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/log.txt
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: JOBS-work-mode-continuity
---

"go" não traz "Google"; "c++" e "node.js" funcionam. Termo inválido na URL
mostra aviso e a lista sem filtro, em vez de erro. Com poucas vagas aparece
a oferta de salvar o termo em Buscas.

Full 1.22.0 (2026-09-22): typescript e observabilidade acham vagas só pela descrição; type e java não acham pedaço; empresa (Aurora) e título (architect) acham; termo acentuado e frase funcionam; o termo sobrevive ao reload.

**Reset 2026-09-23 (#223, tarefa 05):** a busca passou a olhar também a localização, e texto entre aspas virou frase exata. Conferir de novo que um termo que não aparece em nenhuma localização devolve o mesmo conjunto de antes, e que "go" continua sem trazer "Google".
