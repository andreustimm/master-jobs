# QA Run Report — 2026-09-18T014525941159Z-789e70c0 — Full do release candidate integrado (#87 + #89)

- **Scope:** o release candidate que existe quando as duas PRs entram em `dev` e promovem para `staging`. Percorrido sobre a merge local `1535e3a`. É o Full que a regra 20 exige do RC antes da PR humana `staging → main`, executado antes do merge para não virar caminho crítico depois dele.
- **Cadence tier:** full
- **Build:** 1535e3a (`codex/application-draft-on-rejected-transition` + `codex/application-note-history`) · **Environment:** build standalone do harness E2E em http://127.0.0.1:62941, PostgreSQL isolado, login de runtime sem privilégio administrativo; sem mocks.
- **Started:** 2026-09-18T01:35:00Z · **Status:** closed <!-- in-progress | closed -->

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem noturna | Power User | laptop 1280×900 / wifi local / en | funil: gravar, reler, recusar |
| Andreus em triagem | Power User | laptop 1280×900 / en | abertura direta, modalidade |
| Candidato sem currículo | New User | laptop 1280×900 / en | estado vazio do ranking |
| Candidato após falha | Recovering User | laptop 1280×900 / en | falha do ranking |
| Candidato ocioso | Restricted Peer | laptop 1280×900 / en | fronteira entre contas |
| Recrutadora convidada | Restricted User | laptop 1280×900 / en | fronteira de papel |

## Flows in Scope

Todas as jornadas P0 e P1 do tracker; `J-open-public-profile` é P2 e fica fora pela prioridade armazenada.

- `J-preserve-application-decision` (P0) · `J-switch-workspace-screen` (P0) · `J-recover-offline-access` (P0)
- `J-find-jobs-by-work-mode` (P1) · `J-open-dashboard-direct` (P1) · `J-refresh-candidate-ranking` (P1)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-refused-transition-draft | J-preserve-application-decision / PIPE-refused-transition-keeps-draft | Andreus em triagem noturna | Back-Button Tour | Pass | | 9bb7fc0 |
| 2 | CH-save-resume-application | J-preserve-application-decision / PIPE-save-resume-decision | Andreus em triagem noturna | Back-Button Tour | Pass | | cb00cbb |
| 3 | CH-save-resume-application | J-preserve-application-decision / PIPE-read-application-history | Andreus em triagem noturna | Back-Button Tour | Pass | | cb00cbb |
| 4 | CH-direct-startup-canary | J-open-dashboard-direct / — | Andreus em triagem | Landmark Tour | Pass | | |
| 5 | CH-work-mode-continuity | J-find-jobs-by-work-mode / JOBS-work-mode-continuity | Andreus em triagem | Back-Button Tour | Pass | | |
| 6 | CH-no-cv-ranking-state | J-refresh-candidate-ranking / PROF-rescore-status-no-cv | Candidato sem currículo | Empty-State Tour | Pass | | |
| 7 | CH-failed-ranking-refresh | J-refresh-candidate-ranking / PROF-rescore-status-visibility | Candidato após falha | Error-Recovery Tour | Pass | | |
| 8 | CH-recruiter-private-boundary | J-switch-workspace-screen / PROF-rescore-status-privacy | Recrutadora convidada | Boundary Tour | Pass | | |
| 9 | CH-auth-boundary-recovery | J-switch-workspace-screen / AUTH-canonical-transition-boundaries | Candidato após falha | Back-Button Tour | Skipped | | |
| 10 | CH-offline-installed-recovery | J-recover-offline-access / PWA-installed-offline-recovery | Candidato em trânsito | Offline Tour | Blocked (needs human verify) | | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### Funil, ponta a ponta — Andreus em triagem noturna

- **Ran:** 2026-09-18T01:35Z → 2026-09-18T01:41Z (box respeitado: sim)
- **Findings:**
  - Gravar "Preparando" com nota e ver a nota aparecer no histórico na mesma tela: `2026-09-18 · registered at Preparing`, seguida do texto. A decisão e a razão dela ficam juntas.
  - A recusa provocada por duas abas mantém a nota digitada, avisa "The funnel does not go from Archived to Applied" e devolve o seletor a `archived`.
  - Nenhuma linha desta jornada tem achado aberto neste estado — a primeira vez em toda a série.
- **Bugs filed/updated:** nenhum
- **Scenarios settled:** PIPE-refused-transition-keeps-draft, PIPE-save-resume-decision e PIPE-read-application-history → pass
- **Paper cuts:** nenhum
- **Surprises:** nenhuma
- **Suggested next charter:** histórico longo, para ver se a seção continua legível com dezenas de eventos.

### Demais jornadas — outras personas

- **Ran:** 2026-09-18T01:41Z → 2026-09-18T01:45Z (box respeitado: sim)
- **Findings:**
  - Abertura direta leva ao cockpit operável. Modalidade: `remote` traz 1 resultado, `onsite` traz 0 com vazio honesto, e voltar restaura a URL anterior.
  - Ranking sem currículo e após falha dizem o que houve e o que fazer.
  - Recrutadora entra em `/jobs`, recebe "Access denied" em `/pipeline` e **não vê a seção de histórico** no detalhe da vaga. A segunda conta de candidato também não.
  - Sem sessão: `/api/export` termina em `/login` e `/p/alex` devolve "Page not found" — 404, não 403.
- **Bugs filed/updated:** nenhum
- **Scenarios settled:** JOBS-work-mode-continuity, PROF-rescore-status-no-cv, PROF-rescore-status-visibility, PROF-rescore-status-privacy → pass
- **Paper cuts:** nenhum
- **Surprises:** nenhuma
- **Suggested next charter:** as pernas de token de AUTH, que exigem o seed que as cria.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-preserve-application-decision | pass | pass | pass | pass | pass | pass | Sem fricção aberta: a nota é escrita, guardada e relida |
| J-switch-workspace-screen | pass | pass | pass | pass | pass | pass | Fronteiras por papel, por conta e sem sessão respondem canônico |

## What Was Fixed

Nada nesta rodada; ela verifica o que as PRs #87 e #89 entregam juntas. As correções e suas verificações estão nos relatórios anteriores desta data.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|

## Runtime Errors Observed

- Nenhum.

## Human Verifications Needed

- [ ] PWA instalada e offline: instalar num telefone real, ficar offline e reabrir (linha #10 e as cinco jornadas `blocked-verify` do tracker). Navegador headless não instala PWA.

## Decisions for a Human

### Qual opção fica para a nota da candidatura

A #89 implementa a opção 2 — exibir o histórico — e é o que esta rodada percorreu. As outras seguem disponíveis: gravar em `application.notes`, que sobrescreve a nota anterior a cada salvamento, ou retirar o campo. A escolha continua humana; o que mudou é que agora ela pode ser feita olhando o resultado.

### Conflito textual ao mesclar as duas PRs

`src/core/i18n/pt-BR.ts`, `src/core/i18n/en.ts`, `app/jobs/[id]/page.tsx` e os três changelogs conflitam — mesma região, adições diferentes, nenhum é escolha entre versões. Resolução pronta em `1535e3a`.

## Learnings

- Rodar o Full sobre a integração antes do merge respondeu, com o produto na mão, a pergunta que nenhuma leitura de diff responde: o que sobra aberto depois que as duas entram. Sobra o que depende de aparelho físico.

## Final Status

- **Exit gate (full automated suite):** `pnpm check` — `Test Files 163 passed (163)`, `Tests 2211 passed | 7 skipped (2218)`, statements 95,99%, contratos do tracker `Ran 13 tests ... OK`. `pnpm test:e2e` — `232/232 verificações passaram`, `8/8 páginas sem violações axe WCAG 2.2 AA`.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 · Friction 0 · Cosmetic 0
- **Coverage:** 6 jornadas P0/P1 em escopo; 5 andadas, 1 bloqueada por exigir aparelho físico. 8 linhas Pass, 1 cortada com motivo declarado, 1 bloqueada por verificação humana.
- **Verdict:** **ready-with-blocked-items** — nenhum achado aberto nas jornadas percorridas, e o Data-Loss que reprovou os dois Fulls anteriores deixou de existir. O que resta é humano por natureza: instalar a PWA num telefone, e a promoção de produção, que ninguém além do operador decide.
