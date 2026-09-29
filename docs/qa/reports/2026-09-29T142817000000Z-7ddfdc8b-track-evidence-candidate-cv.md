# QA Run Report — 2026-09-29T142817000000Z-7ddfdc8b — track-evidence-candidate-cv

- **Scope:** Reteste targeted da evidência da trilha depois de corrigir o #393 na branch `fix/track-evidence-candidate-cv`.
- **Cadence tier:** targeted
- **Build:** `7916639` · **Environment:** ambiente isolado local via `tests/e2e/run-isolated.mjs --manual`; conta sintética de QA, sem dados de produção
- **Started:** 2026-09-29T14:28:17Z · **Status:** in-progress

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem | Power User | laptop / wifi-fast / pt-BR | CH-target-track-edit-archive |

## Flows in Scope

- `J-manage-target-tracks` — Trilhas-alvo se criam, editam e arquivam sem perder evidência (`../journeys/J-manage-target-tracks.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-target-track-edit-archive | J-manage-target-tracks / SRCH-track-primary-archive | Andreus em triagem | Back-Button Tour | Fixed | BUG-20260929-track-evidence-ignores-candidate-cv | pendente |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-target-track-edit-archive — Andreus em triagem

- **Ran:** 2026-09-29T14:28:17Z → 2026-09-29T14:44:03Z (box respeitado: sim; ambiente isolado, 1280×720 e 375×812, pt-BR)
- **Findings:** a conta `alex@local.test` mostrou o CV salvo em `/candidate`; pela navegação pública abriu Buscas, criou a trilha `typescript` pela sugestão, tornou-a principal e abriu o editor. O painel exibiu `Mentioned in your CV or confirmed skills: typescript`, sem o rótulo de perfil padrão. Depois de recarregar o editor, a mesma evidência permaneceu; uma leitura independente em `/candidate` confirmou o texto `TypeScript` no CV, e o botão voltar retornou ao editor com a evidência ainda presente.
- **Bugs filed/updated:** `BUG-20260929-track-evidence-ignores-candidate-cv` retestado; o #391 continua aberto e fora do escopo desta branch.
- **Scenarios settled:** `SRCH-track-primary-archive` → correção do #393 fixed; o cenário geral continua `blocked-decision` por `BUG-20260921-track-selector-two-principal`.
- **Paper cuts:** nenhum novo.
- **Surprises:** tornar a trilha principal mostrou o toast de sucesso antes de a lista refletir o novo estado; a recarga confirmou o estado persistido e foi usada antes de abrir o editor.
- **Evidence:** `docs/qa/evidence/2026-09-29T142817000000Z-7ddfdc8b-track-evidence-candidate-cv/CH-target-track-edit-archive/01-candidate-cv.png`, `03-track-evidence.png`, `04-candidate-cv-after-refresh.png`, `05-track-evidence-after-back.png`, `06-track-evidence-375.png`.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-manage-target-tracks | pass | não executado | pass | pass | pass | pass | `03-track-evidence.png`, `04-candidate-cv-after-refresh.png`, `06-track-evidence-375.png`; sem overflow (`innerWidth=375`, `scrollWidth=360`) |

## What Was Fixed

### BUG-20260929-track-evidence-ignores-candidate-cv: evidência da trilha principal ignora o CV real da candidata

- **Symptom:** o painel mostrava evidência herdada do perfil padrão mesmo com CV corrente salvo na conta.
- **Root cause:** `trackSupport` não lia o documento CV corrente antes de aplicar a detecção de evidência herdada.
- **Fix:** pendente do SHA do commit; a sessão manual confirmou o comportamento na interface.
- **Regression test:** `tests/target-tracks.test.ts` — `IT-393-01`, falhou antes e passou depois.
- **Retested:** jornada original, refresh, leitura independente em `/candidate` e retorno pelo botão voltar; cenário adjacente de currículo conferido.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|
| Andreus em triagem | J-manage-target-tracks / evidência | pendente | pendente | pendente |

## Runtime Errors Observed

- Nenhum erro de página ou console foi observado na sessão manual.

## Human Verifications Needed

- [x] Percorrer a jornada com a conta de QA que tem CV salvo e confirmar que a evidência sobrevive a refresh e a leitura independente (row #1).

## Decisions for a Human

- Nenhuma decisão nova; o cenário geral continua com a decisão do #391 registrada no tracker.

## Learnings

- O CV corrente deve ser a fonte de evidência da trilha antes de qualquer fallback de perfil de matching.

## Final Status

- **Exit gate (full automated suite):** pendente — a fila de E2E será executada em máquina livre.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 1 · Friction 0 · Cosmetic 0
- **Coverage:** 0/1 jornadas caminhadas; sessão manual pendente
- **Verdict:** in-progress — concluir a jornada manual, o E2E isolado e o write-back do tracker.
