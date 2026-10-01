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

- **Root cause:** `app/jobs/(lista)/page.tsx` escolhia a mensagem de zero resultados só por `state.query` existir, sem olhar se havia recorte ativo — uma frase só para "0 com este filtro" e "termo ausente no acervo", os dois casos que o produto promete distinguir. Duas correções intermediárias (`7f69ab7`, `04e3560`) nunca foram lançadas e decidiam pelos filtros presentes na URL, o que continuava errado: o corte padrão de fit (45) e o status padrão (esconde candidatura arquivada) são recorte tanto quanto um filtro escolhido, e `status=any`/`fit=0` (o card "vagas abertas" do cockpit) não restringem nada.
- **Fix commit:** `882e4877` adiciona `termExistsInOpenCorpus` (`src/core/db/repo.ts`), que casa o termo como `listBoardPage`, sem fit, status, trilha, fonte, modalidade nem faixa; e `19282c3f` faz `loadJobsView` (`app/jobs/jobs-data.ts`) consultá-la SEMPRE que a lista vem vazia com termo, escolhendo `jobs.emptyTermFiltered` (o termo existe numa vaga aberta, o recorte zerou) ou `jobs.emptyTermAbsent` só por esse resultado. `hasFilterBeyondTerm` saiu.
- **Regression test:** `tests/jobs-board.test.ts` ("recorte implícito contra ausência no acervo": termo abaixo do corte padrão, termo só em candidatura arquivada, termo de fato ausente, filtro explícito com termo existente e com termo ausente, `fit=0&status=any&ungrouped=1`, resultado sem vazio, mais a unidade de `termExistsInOpenCorpus`); `tests/jobs-empty-term.test.ts` (as duas frases); `tests/e2e/ui/searches.mjs` (`laravel&workMode=onsite` recorte, `zzqxunmatched` ausência, `zyxquantumcut` abaixo do corte padrão recorte, E2E-023 vaga arquivada com reload, E2E-024 acervo inteiro com termo ausente; PT e EN).

## Verification

- **Retested:** 2026-10-01, jornada em navegador real (`run-isolated.mjs --manual`, `agent-browser`, 375px, pt-BR e en), relatório `docs/qa/reports/2026-10-01T210000Z-fixer-busca-vazia-com-filtros-jornada.md`, mais a suíte automatizada (`pnpm vitest run tests/filter-state.test.ts tests/jobs-empty-term.test.ts tests/jobs-board.test.ts` e `node tests/e2e/run-isolated.mjs --areas searches`).
- **Result:** `typescript&workMode=onsite` e a vaga arquivada (`quokkaprobe`, status padrão) dizem recorte, também depois de `reload` e de leitura nova; `zzqxunmatched`, com ou sem filtro e no acervo inteiro (`fit=0&status=any&ungrouped=1`), diz ausência; arquivar e restaurar devolve a vaga à busca. Evidência em `docs/qa/evidence/2026-10-01T210000Z-fixer-busca-vazia-com-filtros-jornada/` (local, fora do git).
