# BUG-20261007-primary-button-hover-contrast-dark: no tema escuro, o botão primário sob o ponteiro cai para 4,31:1

- **Status:** open
- **Impact (user-side):** Cosmetic
- **Severity:** Low · **Priority:** P3
- **Persona Affected:** Andreus em triagem noturna (tema escuro)
- **Journey Step:** J-preserve-application-decision, ao passar o ponteiro sobre "Buscar" ou "ampliar busca" em `/pipeline`; o mesmo em "Aplicar" de `/jobs`
- **Scenarios:** PIPE-filter-applications
- **Found:** 2026-10-07 · **Report:** docs/qa/reports/2026-10-07-qa-494-funil-atritos.md
- **Issue:** [#501](https://github.com/andreustimm/master-jobs/issues/501)

## Summary

Depois da #494, o botão primário em repouso passa no AA no tema escuro
(`#4d8bff` com texto `#0b0d10`). Sob o ponteiro, porém, o preenchimento vira
`hover:bg-primary/80` — 80% de opacidade sobre o fundo escuro, que dá
`#4274d2` — e o contraste do texto cai para 4,31:1, abaixo dos 4,5:1. O texto
continua legível e o estado dura só enquanto o ponteiro está em cima, por isso
Cosmetic. O hover vem da variante do botão, não da troca de token da #494;
o contraste do hover com o `#296ef9` anterior não foi medido.

## Reproduction

- **Charter:** CH-filter-pipeline · **Tour:** Back-Button Tour
- **Environment:** `tests/e2e/run-isolated.mjs --manual`, 1280 px,
  `prefers-color-scheme: dark`, Aparência "Sistema" (sem escolha explícita),
  axe-core 4.12.1 via `agent-browser a11y`

1. Abrir `/pipeline?stage=applied&q=engenheiro&channel=referral&fit=75&semantic=1`.
2. Pôr o ponteiro sobre "Buscar" (ou sobre "ampliar busca" ligado).
3. Rodar a auditoria axe.

**Expected:** nenhuma violação `color-contrast`, também no hover.
**Actual:** 1 nó `color-contrast`: "4.31 (foreground #0b0d10, background
#4274d2)". Com o ponteiro fora, zero. Em `/jobs?q=engenheiro`, o mesmo em
`filters-submit` sob o ponteiro.

## Evidence

- `docs/qa/evidence/2026-10-07-qa-494-funil-atritos/07-hover-primario-4-31.png`
- Saída do axe registrada no relatório (seção Lentes).

## Fix

<!-- filled when status moves to fixed -->

## Verification

<!-- filled when status moves to verified -->
