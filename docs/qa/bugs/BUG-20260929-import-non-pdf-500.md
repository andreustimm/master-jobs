# BUG-20260929-import-non-pdf-500: importar arquivo não-PDF renomeado .pdf devolve 500 genérico

- **Status:** open
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
- **Root cause:**
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**


Correção #388: recusa tipada traduzida pela tela e remoção do aviso obsoleto.
37 testes relacionados, typecheck e E2E onboarding 44/44 passaram.
Reteste manual pendente no relatório 2026-09-29T143500Z-codex388-importacao-pdf.
