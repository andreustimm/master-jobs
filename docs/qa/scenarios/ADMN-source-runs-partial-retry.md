---
id: ADMN-source-runs-partial-retry
area: ADMN
title: Buscar em todas com uma fonte falhando e tentar de novo só a falha
persona: Andreus em triagem
journey: J-operate-source-catalog
expected: A execução de todas fica parcial com uma linha por fonte, a que falhou mostra desconhecido nas contagens em vez de zero; Tentar de novo cria outra execução ligada à original, que não muda; a lista de execuções é paginada e cabe em 375 px
entry_points: /admin/execucoes
qa_status: pass
bug_ids: BUG-20261001-verify-run-shows-capture-completeness-copy
fix_status: fixed
retest_status:
fix_commits: 38805d7d
evidence: docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-admin-source-catalog-first-walk-todas-na-fila.png; docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-admin-source-catalog-first-walk-todas-parcial.png; docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-admin-source-catalog-first-walk-todas-parcial-375px.png; docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-admin-source-catalog-first-walk-nova-tentativa.png; docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-admin-source-catalog-first-walk-execucoes-pagina-1-375px.png; docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-admin-source-catalog-first-walk-execucoes-pagina-2-375px.png
last_report: docs/qa/reports/2026-10-01-qa-223-verificacoes.md
overlaps: ADMN-source-catalog-operate
---

Novo em #223 (tarefa 03). A captura por termo não aparece como execução: a
tela aponta para o agregado em /admin/captures.

**2026-09-28** (`CH-admin-source-catalog-first-walk`): só uma execução de UMA
fonte (falha, contagens "desconhecido", "Tentar de novo" ligado à original);
a execução "de todas" ficou bloqueada porque o catálogo local era o
compartilhado, com ~15 fontes reais.

**2026-10-01** (mesma charter, relatório em `last_report`), em Postgres
descartável com catálogo próprio: `lever:epoch-ai` (fonte real de baixo
volume, 9 vagas) e `lever:qa-sem-fonte-223` (handle que não existe, 404),
ambas cadastradas e habilitadas pela tela:

- "Buscar em todas" criou a execução #1 na fila ("Aguardando: sem credencial
  de disparo… rode-a pela CLI com jho jobs sync --run"); `jho jobs sync --run
  1` rodou as duas fontes. `/admin/execucoes/1`: **parcial**, uma linha por
  fonte — `lever:epoch-ai` concluída (lidas 9, novas 9, 0, 0, 0) e
  `lever:qa-sem-fonte-223` falhou ("A fonte falhou nesta execução" e o erro
  `GET https://api.lever.co/v0/postings/qa-sem-fonte-223 -> 404`, sem query)
  com as cinco contagens "desconhecido", nunca zero; o total do pai também
  "desconhecido".
- Detalhe da filha que falhou (#3) → "Tentar de novo": nova execução #4,
  "Nova tentativa da execução #3", na fila, e depois (CLI) falhou de novo. A
  execução #3 e a pai #1 seguem exatamente como estavam (mesmos horários,
  #1 "parcial").
- Lista de execuções: com 25 execuções de topo (21 de preenchimento criadas
  por SQL no banco descartável para passar de uma página; o limite é 20 por
  página),
  "Página 1 de 2" com "Próxima" e 20 linhas, "Página 2 de 2"
  (`?page=2`) com "Anterior" e 5 linhas; sobrevive a `reload`; as duas páginas
  e os detalhes cabem em 375 px.

**Limites desta verificação:** só uma fonte concluiu (a regra desta rodada
permitia uma única fonte real), então o pai fica parcial com 1 sucesso e 1
falha, e não "uma falhando entre várias que sucedem"; "Tentar de novo" do pai
(refaz as duas fontes) não foi acionado, para não repetir a chamada à fonte
real. O texto da completude de uma execução de verificação era o da captura:
`BUG-20261001-verify-run-shows-capture-completeness-copy` (Friction).

**Correção (#439):** o detalhe de uma execução de verificação passou a dizer
"conferência completa…" ou "conferência cortada pelo limite ou pelo orçamento
de requisições…", sem falar de fechar por ausência, e diz o universo: as vagas
abertas da fonte (por plataforma) ou as elegíveis, nota 55 ou mais (verificação
de todas); a captura mantém o texto da listagem da fonte. Coberto por
`tests/run-completeness.test.ts` e por E2E-003 em `tests/e2e/admin-catalog.mjs`
(39/39, com as variantes global e em inglês). Falta a releitura independente no navegador real, que fica para a
próxima passada da charter.
