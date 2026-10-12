# BUG-20261007-primary-button-hover-contrast-dark: no tema escuro, o botão primário sob o ponteiro cai para 4,31:1

- **Status:** fixed (verificação em navegador pendente)
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

- **Root cause:** a variante `default` do botão (`components/ui/button.tsx`) e
  a do selo-link (`components/ui/badge.tsx`) pintavam o hover com
  `bg-primary/80`. O fundo real passava a depender do que havia atrás do botão
  e não de um token do tema, e o contraste com `--primary-foreground` caía
  abaixo de 4,5:1 em cinco dos seis tema/modo. Medido sobre `--background`
  (alfa 80% composto em sRGB): HP escuro 4,25:1, Huly claro 4,04:1, Huly escuro
  3,66:1, Graphy claro 3,59:1, Graphy escuro 3,93:1; só o HP claro passava
  (4,71:1). Sobre `--card` o HP escuro dá 4,32:1, o valor que o axe leu
  (`#4274d2`). O defeito era mais largo que o da ficha original, que só viu o
  HP escuro.
- **Fix:** token opaco `--primary-hover` em cada tema e modo de
  `app/themes.css` (o bloco do escuro herdado do sistema leva o mesmo valor do
  escolhido), exposto como `--color-primary-hover` em `app/globals.css`;
  `hover:bg-primary-hover` no botão e no selo-link. O valor é o `--primary`
  12% em direção ao preto (claro) ou ao branco (escuro): afasta o fundo do
  texto, então o hover não contrasta menos que o repouso. Contraste do hover
  com `--primary-foreground`: HP claro 8,39:1, HP escuro 6,97:1, Huly claro
  7,40:1, Huly escuro 6,10:1, Graphy claro 6,00:1, Graphy escuro 6,50:1. Nos
  temas claros o hover agora escurece, em vez de clarear.
- **Fix commit:** `629d2233` (PR #517, issue #501).
- **Regression test:** `tests/design.test.ts` ("keeps primary-foreground on
  primary-hover at WCAG AA, and never below the resting button (#501)", nos
  três estados de cada tema, e "paints the primary hover from the theme token,
  not from a translucent primary (#501)"). Sem a correção os dois reprovam.

## Verification

<!-- filled when status moves to verified -->
