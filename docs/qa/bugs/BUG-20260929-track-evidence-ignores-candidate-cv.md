# BUG-20260929-track-evidence-ignores-candidate-cv: evidência da trilha principal ignora o CV real da candidata

- **Status:** verified <!-- open | fixed | verified | wont-fix | invalid -->
- **Impact (user-side):** Trust-Damage
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-manage-target-tracks, passo de tornar uma trilha principal
- **Scenarios:** SRCH-track-primary-archive
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Depois de tornar uma trilha principal, o painel de evidência mostra “perfil
padrão” em vez do CV real da candidata que está logada e tem CV cadastrado em
`/candidate`. A evidência que deveria justificar o ranking daquela trilha
contradiz o que a própria conta mostra em outra tela.

## Reproduction

- **Charter:** CH-target-track-edit-archive · **Tour:** Back-Button Tour
- **Environment:** `next dev` local (127.0.0.1:3210), 1280×900, pt-BR, conta
  `qa-full-candidate` com CV cadastrado

1. Entrar como a candidata com CV salvo em `/candidate`.
2. Em Buscas, tornar uma trilha diferente da padrão a principal.
3. Abrir o painel de evidência da trilha principal.
4. Comparar com o CV mostrado em `/candidate`.

**Expected:** a evidência reflete o CV real da candidata logada.
**Actual:** a evidência mostra “perfil padrão”, contradizendo `/candidate`.

## Evidence

- `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-target-track-edit-archive/03-principal-sem-evidencia-com-cv.png`

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** `trackSupport` usava as linhas de evidência do perfil de matching persistido. Quando esse perfil herdava o perfil padrão, `evidenceInherited` descartava as linhas mesmo quando a conta tinha um CV corrente; uma conta sem perfil derivado também não lia o documento corrente.
- **Fix commit:** `4181667`
- **Regression test:** `tests/target-tracks.test.ts` — `IT-393-01` reprova antes e passa depois.

## Verification

<!-- filled when status moves to verified -->
- **Retested:** 2026-09-29, com `alex@local.test`, pela jornada pública `/candidate` → `/searches` → trilha principal → editor, refresh, leitura independente do CV e volta do navegador.
- **Result:** o painel exibiu `Mentioned in your CV or confirmed skills: typescript`, a leitura persistiu após refresh e a conta continuou mostrando o mesmo CV em `/candidate`; evidência em `docs/qa/evidence/2026-09-29T142817000000Z-7ddfdc8b-track-evidence-candidate-cv/CH-target-track-edit-archive/`.
