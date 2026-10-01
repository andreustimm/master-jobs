# BUG-20260929-import-non-pdf-500: importar arquivo não-PDF renomeado .pdf devolve 500 genérico

- **Status:** verified
- **Impact (user-side):** Friction
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Candidato convidado sem perfil
- **Journey Step:** J-create-own-profile, passo de importar CV em PDF
- **Scenarios:** PROF-create-own-profile-pdf
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Um arquivo que não é PDF de verdade, renomeado com a extensão `.pdf`, faz a
importação de CV devolver um erro 500 genérico em vez de uma recusa nomeada
("arquivo inválido" ou equivalente). O caminho normal (PDF de verdade) e o
caminho de arquivo grande já são tratados com mensagem própria; só este
caso cai em erro não tratado.

## Reproduction

- **Charter:** CH-account-isolation-first-entry · **Tour:** Feature Tour
- **Environment:** `next dev` local (127.0.0.1:3210), conta convidada sem
  perfil

1. Renomear um arquivo que não é PDF (ex.: texto puro) para `arquivo.pdf`.
2. Tentar importar esse arquivo como CV.

**Expected:** recusa nomeada, sem erro de servidor.
**Actual:** 500 e mensagem genérica.

## Evidence

- `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/adhoc-prof/01-fake-pdf-refused.png`
- Arquivo de reprodução: `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/not-a-pdf.pdf.txt`

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:** `importPdfAction` lançava exceção ao ler um arquivo que não é PDF de verdade (`readCvPdf` não reconhecia o conteúdo), e a Server Action não capturava esse caminho — a exceção não tratada virava o 500 genérico do Next.js em vez de uma recusa tipada.
- **Fix commit:** `053a5d8`
- **Regression test:** `tests/candidate-pdf-import-action.test.ts` (casos `pdfNotPdf`/`pdfMissing`, que reprovavam antes da correção por lançarem em vez de devolver a recusa); E2E `onboarding` (`tests/e2e/ui/onboarding.mjs`, "PDF inválido recebe recusa sem HTTP 500").

## Verification

<!-- filled when status moves to verified -->
- **Retested:** Manual Pass em `053a5d8`, relatório `docs/qa/reports/2026-09-29T143500Z-codex388-importacao-pdf.md` (importação em perfil existente); E2E `onboarding` 44/44, incluindo a criação inicial de perfil via PDF, cobertura confirmada no retest de `PROF-create-own-profile-pdf` (`docs/qa/reports/2026-10-01-pr414-prof-create-own-profile-pdf-retest.md`, achado 1 da revisão L1 da PR #414).
- **Result:** Pass. Razão localizada (`pdfNotPdf`), sem HTTP 500, CV anterior preservado e recuperação com PDF válido confirmadas após refresh e no histórico, na criação do perfil e na importação em perfil existente.
