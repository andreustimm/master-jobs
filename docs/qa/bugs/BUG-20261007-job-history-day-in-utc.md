# BUG-20261007-job-history-day-in-utc: o histórico da vaga mostra o dia em UTC, e à noite diverge do "aplicado em" do Funil

- **Status:** open
- **Impact (user-side):** Trust-Damage
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem noturna
- **Journey Step:** J-preserve-application-decision, ao abrir o detalhe de uma candidatura a partir do Funil
- **Scenarios:** PIPE-read-application-history; PIPE-filter-applications
- **Found:** 2026-10-07 · **Report:** docs/qa/reports/2026-10-07-qa-494-funil-atritos.md
- **Issue:** [#500](https://github.com/andreustimm/master-jobs/issues/500)

## Summary

Depois da #494, o Funil mostra "aplicado em" no fuso de quem lê, mas o
histórico do detalhe da vaga (`/jobs/<id>`) continua mostrando o dia em UTC
(`2026-10-07 · registrada em Candidatura enviada`), assim como "visto pela
primeira vez em". Quem aplica entre 21:00 e 23:59 em São Paulo lê no Funil o
dia certo e, ao abrir a vaga, o dia seguinte para o mesmo evento: duas telas
discordam da data da mesma decisão. A severidade fica em Medium (e não High)
porque a janela é de três horas por dia e nenhum dado muda.

## Reproduction

- **Charter:** CH-filter-pipeline · **Tour:** Back-Button Tour
- **Environment:** `tests/e2e/run-isolated.mjs --manual`, Chromium do
  `agent-browser`, 1280 px. Como a hora da candidatura não é controlável pela
  CLI, o navegador rodou com `TZ=Pacific/Kiritimati` (UTC+14), em que uma
  candidatura das 09:56 BRT (12:56 UTC) já cai no dia seguinte — o mesmo
  mecanismo de uma candidatura às 23:45 BRT.

1. `jho track 9 applied --channel referral` (aplicada às 12:56:27 UTC de 07/10).
2. Com o navegador em `Pacific/Kiritimati`, abrir `/pipeline`: a linha da vaga
   9 diz "applied on Oct 8, 2026".
3. Clicar em "Go Platform Engineer" (`/jobs/9`).

**Expected:** o histórico mostra o mesmo dia do Funil (8 de outubro, no fuso de
quem lê).
**Actual:** "2026-10-07 · registered at Applied" e "first seen 2026-10-07" —
o dia em UTC.

## Evidence

- `docs/qa/evidence/2026-10-07-qa-494-funil-atritos/05-aplicado-em-fuso-kiritimati.png` (Funil, 8 de outubro)
- `docs/qa/evidence/2026-10-07-qa-494-funil-atritos/10-detalhe-historico-dia-utc-kiritimati.png` (detalhe, 2026-10-07)
- Na mesma sessão, em `America/Sao_Paulo`, as duas telas dizem 7 de outubro
  (horário diurno; a divergência só aparece à noite).

## Fix

<!-- filled when status moves to fixed -->

## Verification

<!-- filled when status moves to verified -->
