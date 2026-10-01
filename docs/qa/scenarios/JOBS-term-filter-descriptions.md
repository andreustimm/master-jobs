---
id: JOBS-term-filter-descriptions
area: JOBS
title: Filtrar Vagas por um termo que só aparece na descrição
persona: Andreus em triagem
journey: J-save-term-search
expected: A busca encontra a palavra inteira no título, na empresa e na descrição, e não encontra pedaço de palavra
entry_points: /jobs?q=laravel
qa_status: pass
bug_ids: BUG-20260929-search-term-false-negative-laravel
fix_status: fixed
retest_status: pass
fix_commits: 7f69ab7; 04e3560; 882e4877; 19282c3f
evidence: evidence/2026-10-01T210000Z-fixer-busca-vazia-com-filtros-jornada/arquivada-recorte-pt-375-apos-reload.png
last_report: docs/qa/reports/2026-10-01T210000Z-fixer-busca-vazia-com-filtros-jornada.md
overlaps: JOBS-work-mode-continuity
---

"go" não traz "Google"; "c++" e "node.js" funcionam. Termo inválido na URL
mostra aviso e a lista sem filtro, em vez de erro. Com poucas vagas aparece
a oferta de salvar o termo em Buscas.

Full 1.22.0 (2026-09-22): typescript e observabilidade acham vagas só pela descrição; type e java não acham pedaço; empresa (Aurora) e título (architect) acham; termo acentuado e frase funcionam; o termo sobrevive ao reload.

**Reset 2026-09-23 (#223, tarefa 05):** a busca passou a olhar também a localização, e texto entre aspas virou frase exata. Conferir de novo que um termo que não aparece em nenhuma localização devolve o mesmo conjunto de antes, e que "go" continua sem trazer "Google".

Reteste #402 (01/10, relatório `docs/qa/reports/2026-10-01T210000Z-fixer-busca-vazia-com-filtros-jornada.md`): Pass. Cenário percorrido por inteiro em navegador real (`run-isolated.mjs --manual`, `agent-browser`), com leitura nova e `reload`: "go" não traz "Google"; `c++` e `node.js` funcionam; `typescript` e `observabilidade` acham pela descrição; `type` e `java` não acham pedaço; empresa (Aurora), título (architect), termo acentuado, frase exata e localização (Lisboa) acham; termo inválido mostra aviso e a lista sem filtro; a oferta de buscar nas plataformas aparece com poucas vagas; o termo sobrevive ao refresh. A frase do vazio sai do EXISTS (`termExistsInOpenCorpus`), nunca dos filtros da URL: recorte (modalidade, nota acima do corte, vaga só arquivada com o status padrão) diz "corresponde com os filtros atuais"; ausência de verdade, inclusive no acervo inteiro (`fit=0&status=any&ungrouped=1`, o card "vagas abertas"), diz "Nenhuma vaga do acervo tem". Vale em pt-BR, en e 375px. Automação: `tests/jobs-board.test.ts`, `tests/e2e/ui/searches.mjs` (E2E-020, 022, 023 e 024).
