---
id: JOBS-term-filter-descriptions
area: JOBS
title: Filtrar Vagas por um termo que só aparece na descrição
persona: Andreus em triagem
journey: J-save-term-search
expected: A busca encontra a palavra inteira no título, na empresa e na descrição, e não encontra pedaço de palavra
entry_points: /jobs?q=laravel
qa_status: untested
bug_ids: BUG-20260929-search-term-false-negative-laravel
fix_status: fixed
retest_status: pending
fix_commits: 7f69ab7; 04e3560
evidence: evidence/2026-09-22-rc-1.22.0/log.txt
last_report: docs/qa/reports/2026-10-01T162051Z-fixer-busca-vazia-com-filtros.md
overlaps: JOBS-work-mode-continuity
---

"go" não traz "Google"; "c++" e "node.js" funcionam. Termo inválido na URL
mostra aviso e a lista sem filtro, em vez de erro. Com poucas vagas aparece
a oferta de salvar o termo em Buscas.

Full 1.22.0 (2026-09-22): typescript e observabilidade acham vagas só pela descrição; type e java não acham pedaço; empresa (Aurora) e título (architect) acham; termo acentuado e frase funcionam; o termo sobrevive ao reload.

**Reset 2026-09-23 (#223, tarefa 05):** a busca passou a olhar também a localização, e texto entre aspas virou frase exata. Conferir de novo que um termo que não aparece em nenhuma localização devolve o mesmo conjunto de antes, e que "go" continua sem trazer "Google".

Reteste #402 (29/09): Pass no escopo do vazio com filtros, commit 7f69ab7. TypeScript encontrou duas vagas; presencial zerou a lista com orientação correta PT/EN após refresh; remover modalidade recuperou ambas. Leitura independente do detalhe confirmou o termo e o trabalho remoto. E2E searches 86/86 passou, incluindo Laravel. Relatório: `docs/qa/reports/2026-09-29T144500Z-codex402-busca-filtrada.md`. O estado global permanece untested porque a sintaxe completa deste cenário não foi reexecutada manualmente.

**Correção da revisão (01/10):** o reteste de 29/09 confirmou que a frase
deixou de afirmar ausência falsa, mas a revisão da PR #419 achou que ela
virou uma frase ÚNICA para os dois casos ("0 com este filtro" e "termo
ausente") — a distinção que a #402 pede continuava sem existir, e o caso
`zzqxunmatched` (sem filtro nenhum) passou a mandar "remova filtros" sem ter
o que remover. `hasFilterBeyondTerm` (`app/filter-state.ts`) agora decide
entre `jobs.emptyTermFiltered` e `jobs.emptyTermAbsent`; `tests/e2e/ui/searches.mjs`
confirma as duas frases, pt-BR e en (86/86). O estado global continua
`untested`: a distinção da #402 tem evidência automatizada nova, mas o
restante do cenário (palavra inteira, `c++`, `node.js`, acento, frase exata,
localização) segue sem sessão de QA de jornada que o repercorra por inteiro.
