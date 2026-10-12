# BUG-20261007-job-history-day-in-utc: o histórico da vaga mostra o dia em UTC, e à noite diverge do "aplicado em" do Funil

- **Status:** fixed
- **Impact (user-side):** Trust-Damage
- **Severity:** Medium · **Priority:** P2
- **Persona Affected:** Andreus em triagem noturna
- **Journey Step:** J-preserve-application-decision, ao abrir o detalhe de uma candidatura a partir do Funil
- **Scenarios:** PIPE-read-application-history; PIPE-filter-applications; JOBS-availability-last-check
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

- **Root cause:** `app/jobs/[id]/page.tsx` cortava o instante com
  `firstSeenAt.slice(0, 10)` e `event.at.slice(0, 10)`, que devolvem o dia em
  UTC; o Funil e o histórico do recrutador já liam o dia pela ilha `LocalDate`
  (#494), no fuso do navegador.
- **Fix commit:** `039a373`; o "conferido em" entra no commit seguinte da
  mesma PR.
- **Fix:** as três datas do detalhe (o "visto em", o "conferido em" da linha de
  disponibilidade e cada linha do histórico) saem pela mesma ilha `LocalDate`
  (`testId` `job-first-seen`, `job-checked-at` e
  `application-timeline-event-date`). O formato muda de `2026-10-07` para o dia
  por extenso do idioma da tela ("7 de out. de 2026", "Oct 7, 2026"), igual ao
  do Funil.
- **Regression test:** `tests/job-detail-local-date.test.ts` (reprova sem a
  correção: a página não importa `LocalDate` e ainda corta em `slice`) e, no
  E2E, a área `pipeline-filters` com `timezoneId: "America/Sao_Paulo"`
  (E2E-500): vaga vista às 22:30 e candidatura às 23:45 de São Paulo, ambas já
  no dia seguinte em UTC, e o histórico igual ao "aplicado em" do Funil. O
  "conferido em" tem a prova na área `job-availability` (E2E-004 e E2E-500),
  também em `America/Sao_Paulo`: a checagem de 00:00 UTC de 1/1 tem de aparecer
  como 31/12. As áreas E2E não rodaram na sessão da correção (Docker sem
  escrita na máquina); rodam no CI.

## Verification

<!-- filled when status moves to verified -->
