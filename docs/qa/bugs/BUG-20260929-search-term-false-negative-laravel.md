# BUG-20260929-search-term-false-negative-laravel: busca diz "nenhuma vaga menciona" quando existem 43

- **Status:** verified
- **Impact (user-side):** Trust-Damage
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-trust-the-filtered-board, ao combinar termo e modalidade
- **Scenarios:** JOBS-term-filter-descriptions
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Com `q=laravel&workMode=onsite`, a tela diz "Nenhuma vaga do acervo menciona
'laravel'" — mas 43 vagas do acervo mencionam o termo (a combinação com o
filtro de modalidade é que reduz a zero, não a ausência do termo). A
mensagem confunde "0 resultados com este filtro" com "termo não existe no
acervo", levando a pessoa a desconfiar da busca em vez de ajustar o filtro.

## Reproduction

- **Charter:** CH-release-regression-sweep · **Tour:** Landmark Tour
- **Environment:** `next dev` local (127.0.0.1:3210)

1. Buscar `q=laravel&workMode=onsite`.
2. Ler a mensagem de zero resultados.
3. Remover `workMode=onsite` e contar as vagas que mencionam "laravel".

**Expected:** mensagem distingue "0 vagas com este filtro" de "termo ausente
no acervo".
**Actual:** "Nenhuma vaga do acervo menciona 'laravel'", mas 43 vagas
mencionam o termo sem o filtro de modalidade.

## Evidence

- Contagem direta nesta sessão (lane jobsnav, charter CH-release-regression-sweep,
  candidato C2); ver debrief "Lane jobsnav" no relatório desta rodada.

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** `app/jobs/(lista)/page.tsx` escolhia a mensagem de zero resultados só por `state.query` existir, sem olhar se havia recorte ativo — uma frase só para "0 com este filtro" e "termo ausente no acervo", os dois casos que o produto promete distinguir.
- **Fix commit:** 7f69ab7 (`fix(vagas): descreve filtros no vazio da busca por termo`) trocou a frase que afirmava ausência por uma neutra ("filtros atuais"), mas não fez a distinção — a frase neutra passou a aparecer também sem filtro nenhum escolhido (achado da revisão da PR #419, 01/10). A correção da revisão adiciona `hasFilterBeyondTerm` (`app/filter-state.ts`), que decide pelos mesmos campos que entram na consulta do quadro (`toBoardFilters`, `payFilterActive`, `track`), e `app/jobs/(lista)/page.tsx` escolhe `jobs.emptyTermFiltered` ou `jobs.emptyTermAbsent` por ela.
- **Fix commit (continuação):** `hasFilterBeyondTerm` só vê filtro ESCOLHIDO na URL — o corte padrão de fit (45) e o status padrão (esconde candidatura arquivada) são recorte tanto quanto qualquer outro, e um termo que só existisse abaixo do corte ou só numa vaga arquivada voltava a receber a frase de ausência, falsa (re-revisão da PR #419, 01/10). `termExistsInOpenCorpus` (`src/core/db/repo.ts`) confirma a ausência com o mesmo casamento de termo de `listBoardPage`, sem fit, status, trilha, fonte, modalidade nem faixa — chamada por `loadJobsView` (`app/jobs/jobs-data.ts`) só quando a lista já veio vazia.
- **Regression test:** `tests/filter-state.test.ts` (`hasFilterBeyondTerm` unitário: `fit` padrão e `fit=0` não contam, `fit` acima do padrão e cada outro campo contam); `tests/jobs-empty-term.test.ts` (as duas frases, cada uma pelo lado certo); `tests/jobs-board.test.ts` ("recorte implícito contra ausência no acervo": termo abaixo do corte padrão, termo só em candidatura arquivada, termo de fato ausente, mais a unidade de `termExistsInOpenCorpus`); `tests/e2e/ui/searches.mjs` (`laravel&workMode=onsite` mostra a frase de recorte, `zzqxunmatched` sem filtro mostra a de ausência, `zyxquantumcut` abaixo do corte padrão mostra a frase de recorte — não a de ausência —, PT e EN).

## Verification

<!-- filled when status moves to verified -->
- **Retested:** 2026-10-01, automatizado — `pnpm vitest run tests/filter-state.test.ts tests/jobs-empty-term.test.ts tests/jobs-board.test.ts` e `node tests/e2e/run-isolated.mjs --areas searches` (96/96, PT-BR e EN, inclusive o caso do corte implícito). Sem sessão manual nesta rodada.
- **Result:** a frase de recorte aparece com filtro explícito OU com corte implícito (fit padrão, status padrão) que esconde o termo; a de ausência, só quando o termo de fato não existe em nenhuma vaga aberta — nenhuma das duas aparece fora do seu caso.

Correção 7f69ab7 (histórico): o texto passou a descrever "filtros atuais" em vez de afirmar ausência, mas isso tornou a MESMA frase genérica para os dois casos — a distinção pedida pela #402 continuava sem existir, achado pela revisão da PR #419. Correção 04e3560 (histórico): `hasFilterBeyondTerm` fez a distinção, mas só para filtro ESCOLHIDO — o corte padrão de fit e o status padrão continuavam causando a mesma ausência falsa, achado pela re-revisão da PR #419. Ver Fix/Verification acima para a correção real (EXISTS sem os demais filtros).
