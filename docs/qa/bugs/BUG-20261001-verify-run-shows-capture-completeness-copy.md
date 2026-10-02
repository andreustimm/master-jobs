# BUG-20261001-verify-run-shows-capture-completeness-copy: o detalhe de uma execução de verificação diz "janela parcial: não fecha por ausência"

- **Status:** fixed
- **Impact (user-side):** Friction
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem (admin)
- **Journey Step:** J-operate-source-catalog, passo 3 (ler o detalhe da execução depois de pedir)
- **Scenarios:** ADMN-source-runs-partial-retry
- **Found:** 2026-10-01, durante a verificação de JOBS-availability-last-check · **Report:** docs/qa/reports/2026-10-01-qa-223-verificacoes.md

## Summary

Numa execução de "Atualizar status" (verificação de links) cortada pelo limite
do operador, o detalhe mostra "Completude: janela parcial: não fecha por
ausência". Essa frase descreve a captura de uma fonte. A verificação não fecha
vaga por ausência (só 404 e 410 fecham), então quem lê fica sem saber o que
"janela parcial" quer dizer aqui nem se algo deu errado.

## Reproduction

- **Charter:** CH-relevance-and-availability-catch-up · **Tour:** Feature Tour
- **Environment:** laptop, wifi-fast, pt-BR; `pnpm dev` local, PostgreSQL
  descartável, uma fonte real de baixo volume (`lever:epoch-ai`, 9 vagas)

1. Como admin, abrir `/admin/plataformas/lever%3Aepoch-ai` e clicar em
   "Atualizar status" (cria a execução de verificação na fila).
2. No terminal do operador: `jho jobs verify --run <id> --limit 3` (3 vagas
   verificadas, 3 vivas).
3. Recarregar `/admin/execucoes/<id>` e ler "Completude".

**Expected:** texto próprio da verificação, por exemplo "conferência cortada
pelo limite", sem falar de fechamento por ausência.
**Actual:** "janela parcial: não fecha por ausência" (o texto da captura).

## Evidence

- `docs/qa/evidence/2026-10-01-qa-223-verificacoes/CH-admin-source-catalog-first-walk-verificacao-completude.png`
- Leitura independente: o mesmo detalhe depois de recarregar mostra o mesmo
  texto; as contagens (3 lidas, 3 vivas, 0 fechadas) estão corretas.
- Só a variante "parcial" foi vista no navegador; a "completa" (lista
  completa: fecha por ausência) sai pelo mesmo mapeamento e não foi percorrida.
- Issue: #439.

## Fix

- **Root cause:** `app/admin/execucoes/[id]/page.tsx` traduzia
  `run.completeness` sempre por `platforms.snapshotComplete` e
  `platforms.snapshotPartial`, qualquer que fosse o escopo da execução. O campo
  é o mesmo na captura e na verificação, mas só na captura ele fala da
  listagem da fonte (e de fechar por ausência).
- **Fix commit:** `38805d7d` (PR `fix/verify-run-completeness-copy`, `Closes #439`).
  `completenessKey(scopeKind, sourceId, completeness)` em
  `app/admin/execucoes/run-completeness.ts` escolhe a chave. Para `verify` o
  universo depende do escopo: por plataforma (`sourceId` preenchido, `minFit:
  0`) saem `runs.verifyComplete`/`runs.verifyPartial` ("…vagas abertas da fonte
  com link público…"); global (`sourceId` nulo, piso de fit 55) saem
  `runs.verifyAllComplete`/`runs.verifyAllPartial` ("…vagas elegíveis (nota 55
  ou mais, com link público)…"). `partial` é "cortada pelo limite ou pelo
  orçamento de requisições" (`checked < due` ou `budgetExhausted`). pt-BR e en.
  O que é gravado em `source_run.completeness` não muda; a captura mantém o
  texto de antes. O "N de M" sugerido na issue não entrou: o total vencido
  (`due`) não é gravado na execução e gravá-lo seria mudar o dado; fica na
  issue #447.
- **Regression test:** `tests/run-completeness.test.ts` (chaves por escopo, com
  `sourceId` preenchido e nulo; texto da verificação sem
  "ausência"/"janela"/"lista" e o global citando "55" e "elegíveis", nos dois
  idiomas) e `tests/e2e/admin-catalog.mjs` (E2E-003: verificação por plataforma
  completa e cortada com `--limit` 1 sobre duas vagas abertas; verificação
  global completa e cortada, com as vagas de outras áreas estacionadas
  enquanto roda; refresh e 375 px; a captura segue com o texto da listagem).
  A primeira versão do E2E reprovou sem a correção ("lista completa: fecha por
  ausência" e "janela parcial: não fecha por ausência" no detalhe da
  verificação); as variantes globais e a leitura em inglês foram acrescentadas
  depois, na revisão, e passam com a correção.

## Verification

- **Retested:** 2026-10-01, `node tests/e2e/run-isolated.mjs --areas
  admin-catalog` (build standalone, Postgres descartável, pt-BR, viewport
  375 × 812), com o executor rodando em processo a mesma `executeSourceRun` que
  `jho jobs verify --run` chama.
- **Result:** PASS: 39/39 verificações. O detalhe da execução de verificação
  mostra "conferência completa…" e, cortada, "conferência cortada pelo limite
  ou pelo orçamento…", por plataforma ("da fonte") e global ("elegíveis"), sem
  falar de fechamento por ausência; o texto sobrevive a `reload` e cabe em
  375 px. Em inglês, o E2E abre as quatro execuções (plataforma e global,
  completa e cortada), confere o início ("full check" ou "check cut by the
  limit"), "eligible" na global e "of the source" na de plataforma, e que
  nenhum texto da interface vaza português. Não houve nova passada manual no
  navegador real com `lever:epoch-ai`.
