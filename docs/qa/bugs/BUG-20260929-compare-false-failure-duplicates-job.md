# BUG-20260929-compare-false-failure-duplicates-job: /compare diz que falhou mas cadastra a vaga e apaga o formulário

- **Status:** open
- **Impact (user-side):** Data-Loss
- **Severity:** High · **Priority:** P1
- **Persona Affected:** Andreus em triagem
- **Journey Step:** J-trust-the-filtered-board, ao cadastrar uma vaga manual em `/compare`
- **Scenarios:** (nenhum cenário existente cobre `/compare` hoje — lacuna de
  cobertura; abrir um `J-`/`COMPARE-` dedicado é trabalho futuro de
  `qa-report`)
- **Found:** 2026-09-29 · **Report:** docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md

## Summary

Em `/compare`, clicar em "Cadastrar e comparar" mostra "A comparação não
pôde ser concluída. Tente novamente." e apaga o formulário preenchido — mas a
vaga foi cadastrada mesmo assim (vaga 17842 confirmada no acervo). Quem
confia na mensagem de erro e tenta de novo cadastra a mesma vaga duas vezes.
É perda de confiança dupla: a mensagem mente sobre o resultado, e seguir a
orientação óbvia (tentar de novo) duplica o dado.

## Reproduction

- **Charter:** CH-first-party-navigation-inventory · **Tour:** Feature Tour
- **Environment:** `next dev` local (127.0.0.1:3210), conta `qa-full-candidate-a`
  sem CV

1. Abrir `/compare` e preencher os dados de uma vaga manual.
2. Clicar em "Cadastrar e comparar".
3. Ler a mensagem de erro e conferir o acervo (`/jobs`) para a vaga recém
   descrita.
4. Tentar de novo com os mesmos dados.

**Expected:** ou a operação falha de verdade (nada cadastrado, formulário
preservado para nova tentativa), ou ela é bem-sucedida e diz isso.
**Actual:** "A comparação não pôde ser concluída. Tente novamente." + vaga
17842 cadastrada + formulário apagado; repetir duplica a vaga.

## Evidence

- `docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-first-party-navigation-inventory/compare-failed.png`

## Fix

<!-- filled when status moves to fixed -->
- **Root cause:**
- **Fix commit:**
- **Regression test:**

## Verification

<!-- filled when status moves to verified -->
- **Retested:**
- **Result:**
