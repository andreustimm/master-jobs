# BUG-20261006-pipeline-swapped-score-fields-stale: no Funil, a faixa de score invertida é trocada com aviso, mas os campos continuam invertidos

- **Status:** open
- **Impact (user-side):** Trust-Damage
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem noturna
- **Journey Step:** J-preserve-application-decision, ao ajustar a faixa de score de `/pipeline` já filtrada
- **Scenarios:** PIPE-filter-applications
- **Found:** 2026-10-06 · **Report:** docs/qa/reports/2026-10-06-qa-478-funil-filtros.md
- **Issue:** [#492](https://github.com/andreustimm/master-jobs/issues/492)

## Summary

Com uma faixa de score já aplicada (75–80), digitar o par invertido (mínimo
80, máximo 75) e aplicar mostra o aviso "O mínimo estava acima do máximo; os
dois foram trocados." e a lista certa (75–80), mas os campos continuam em
80/75 e os polegares do controle deslizante se cruzam. Aplicar de novo reenvia
o par invertido: o aviso nunca sai e a URL fica `fit=80&fitMax=75`. Só o
refresh mostra 75/80. Partindo de campos vazios a troca aparece certa; o
defeito surge quando a faixa trocada é igual à já aplicada. Em Vagas o mesmo
gesto não chega a inverter (o campo mínimo é ajustado ao máximo).

É o caminho 1 de `JOBS-filter-fields-follow-url`, agora no Funil.

## Reproduction

- **Charter:** CH-filter-pipeline · **Tour:** Back-Button Tour
- **Environment:** `tests/e2e/run-isolated.mjs --manual` (build standalone de
  `origin/dev` 4f62a49a), 1280 px, pt-BR, conta `alex@local.test`

1. Abrir `/pipeline?fit=75&fitMax=80`.
2. Digitar 80 em "mínimo" e 75 em "máximo"; clicar Aplicar do score.
3. Ler o aviso, os campos e a lista; clicar Aplicar outra vez.

**Expected:** aviso de troca e campos em 75/80; o Aplicar seguinte não
reenvia o par invertido.
**Actual:** aviso, lista de 75–80, campos em 80/75; o segundo Aplicar mantém
`fit=80&fitMax=75` e o aviso. Reproduzido 2/2.

## Evidence

- `docs/qa/evidence/2026-10-06-qa-478-funil-filtros/04-faixa-invertida.png`
- Leituras de DOM da sessão no relatório (seção 4).

## Fix

<!-- filled when status moves to fixed -->

## Verification

<!-- filled when status moves to verified -->
