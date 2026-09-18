# QA Run Report — 2026-09-18T005713795033Z-a768f97c — Full do release candidate prospectivo (dev + PR #87)

- **Scope:** o que `staging` passa a conter quando a PR #87 promover. O código percorrido é o head da branch `codex/application-draft-on-rejected-transition` (`6d81387`), que é `origin/dev` mais os commits da correção — o mesmo conteúdo que o fast-forward levará. Antecipa o Full que a regra 20 exige do RC, para ele não virar caminho crítico depois do merge.
- **Cadence tier:** full
- **Build:** 6d81387 · **Environment:** build standalone do harness E2E em http://127.0.0.1:65020, PostgreSQL isolado, login de runtime sem privilégio administrativo; sem mocks.
- **Started:** 2026-09-18T00:20:00Z · **Status:** closed <!-- in-progress | closed -->

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus em triagem noturna | Power User | laptop 1280×900 / wifi local / pt-BR e en | funil: gravar, retomar e recusar |
| Andreus em triagem | Power User | laptop 1280×900 / wifi local / en | abertura direta, modalidade |
| Candidato em trânsito | Mobile User | telefone 375×812 / wifi local | shell móvel (rodada anterior, mesmo código de layout) |
| Candidato sem currículo | New User | laptop 1280×900 / en | estado vazio do ranking |
| Candidato após falha | Recovering User | laptop 1280×900 / en | falha do ranking, fronteiras sem sessão |
| Recrutadora convidada | Restricted User | laptop 1280×900 / en | fronteira de papel |

## Flows in Scope

Todas as jornadas P0 e P1. `J-open-public-profile` é P2 e fica fora do conjunto do Full pela prioridade armazenada.

- `J-preserve-application-decision` (P0)
- `J-switch-workspace-screen` (P0)
- `J-recover-offline-access` (P0)
- `J-find-jobs-by-work-mode` (P1)
- `J-open-dashboard-direct` (P1)
- `J-refresh-candidate-ranking` (P1)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-refused-transition-draft | J-preserve-application-decision / PIPE-refused-transition-keeps-draft | Andreus em triagem noturna | Back-Button Tour | Pass | | 9bb7fc0 |
| 2 | CH-save-resume-application | J-preserve-application-decision / PIPE-save-resume-decision | Andreus em triagem noturna | Back-Button Tour | Blocked (human decision) | BUG-20260917-transition-note-never-readable | |
| 3 | CH-save-resume-application | J-preserve-application-decision / PIPE-note-on-unchanged-stage | Andreus em triagem noturna | Back-Button Tour | Blocked (human decision) | BUG-20260917-transition-note-never-readable | 03ac0f6 |
| 4 | CH-direct-startup-canary | J-open-dashboard-direct / — | Andreus em triagem | Landmark Tour | Pass | | |
| 5 | CH-work-mode-continuity | J-find-jobs-by-work-mode / JOBS-work-mode-continuity | Andreus em triagem | Back-Button Tour | Pass | | |
| 6 | CH-no-cv-ranking-state | J-refresh-candidate-ranking / PROF-rescore-status-no-cv | Candidato sem currículo | Empty-State Tour | Pass | | |
| 7 | CH-failed-ranking-refresh | J-refresh-candidate-ranking / PROF-rescore-status-visibility | Candidato após falha | Error-Recovery Tour | Pass | | |
| 8 | CH-recruiter-private-boundary | J-switch-workspace-screen / PROF-rescore-status-privacy | Recrutadora convidada | Boundary Tour | Pass | | |
| 9 | CH-auth-boundary-recovery | J-switch-workspace-screen / AUTH-canonical-transition-boundaries | Candidato após falha | Back-Button Tour | Skipped | | |
| 10 | CH-offline-installed-recovery | J-recover-offline-access / PWA-installed-offline-recovery | Candidato em trânsito | Offline Tour | Blocked (needs human verify) | | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### Funil — Andreus em triagem noturna

- **Ran:** 2026-09-18T00:20Z → 2026-09-18T00:40Z (box respeitado: sim)
- **Findings:**
  - A recusa provocada por duas abas mantém a nota digitada, nomeia os dois estágios e devolve o seletor ao estágio gravado. As três propriedades na mesma tentativa.
  - Gravar e retomar: o estágio sobrevive a refresh, aparece no funil, resiste a sair e entrar de novo e bate com `jho jobs show 1` e `jho pipeline`.
  - Salvar uma nota sem mudar de estágio conclui sem erro. Que ela agora fique gravada é afirmado por teste de unidade — não por esta sessão, porque continua sem leitura pública.
- **Bugs filed/updated:** nenhum novo
- **Scenarios settled:** PIPE-refused-transition-keeps-draft → pass; PIPE-save-resume-decision e PIPE-note-on-unchanged-stage seguem bloqueados pela decisão
- **Paper cuts:** nenhum novo
- **Surprises:** nenhuma
- **Suggested next charter:** quando houver leitura da nota, uma sessão que a escreva e a releia em duas superfícies.

### Ranking, modalidade e fronteiras — demais personas

- **Ran:** 2026-09-18T00:40Z → 2026-09-18T00:56Z (box respeitado: sim)
- **Findings:**
  - Sem currículo: "Save a CV to start refreshing your job ranking." Com falha na fila: "Refresh failed · The ranking could not be refreshed. Save again or try later." Os dois estados dizem o que houve e o que fazer.
  - Modalidade: `?workMode=remote` traz 1 resultado, `onsite` traz 0 com vazio honesto, e o botão voltar restaura a URL anterior.
  - Recrutadora entra em `/jobs` e recebe "Access denied" em `/pipeline`, sem conteúdo do candidato.
  - Sem sessão: `/api/export` termina em `/login`, `/p/alex` devolve "Page not found" — 404, não 403 — e o gatilho de Novidades não existe.
  - O ranking é por candidato: com uma conta sem score, o filtro de modalidade devolve zero. Não é defeito; é o escopo funcionando, e vale como lembrete de que esta jornada exige a persona com acervo pontuado.
- **Bugs filed/updated:** nenhum
- **Scenarios settled:** JOBS-work-mode-continuity, PROF-rescore-status-no-cv, PROF-rescore-status-visibility, PROF-rescore-status-privacy → pass
- **Paper cuts:** nenhum
- **Surprises:** nenhuma
- **Suggested next charter:** as pernas de token de AUTH, que exigem o seed que as cria.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-preserve-application-decision | friction | pass | pass | pass | pass | pass | Recuperação de erro passou a funcionar (9bb7fc0); a fricção que resta é a nota sem leitura |
| J-switch-workspace-screen | pass | pass | pass | pass | pass | pass | Fronteiras por papel e sem sessão canônicas; axe 8/8 na suíte |

## What Was Fixed

Nada nesta rodada. As correções que este RC carrega — `f16c2b4`, `916c531`, `fa1269d`, `03ac0f6`, `9bb7fc0` — foram feitas e retestadas nas rodadas anteriores desta data.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|
| Andreus em triagem noturna | J-preserve-application-decision step 4 | "escrevo uma nota e não tenho onde relê-la" | sharp | BUG-20260917-transition-note-never-readable, aguardando decisão |

## Runtime Errors Observed

- Nenhum.

## Human Verifications Needed

- [ ] PWA instalada e offline (linha #10 e as cinco jornadas `blocked-verify` do tracker): instalar num telefone real, ficar offline e reabrir. Navegador headless não instala PWA.

## Decisions for a Human

### A nota da candidatura continua sem leitura (BUG-20260917-transition-note-never-readable)

- What's broken: a nota é aceita, agora é gravada, e nenhuma superfície pública a mostra. Classificada Data-Loss pela régua ("tornada inacessível sem consentimento"), e Data-Loss aberta bloqueia release.
- Why not auto-fixed: escolher entre gravar em `application.notes`, exibir o histórico de `application_event` ou retirar o campo é decisão de produto.
- Options: 1. `application.notes` — a CLI mostra, mas cada gravação sobrescreve a anterior. 2. Exibir o histórico no detalhe — uma query escopada por candidato, uma seção de UI, chaves de i18n e testes; sem migração, porque `kind` já prevê `note`. 3. Retirar o campo até existir leitura.
- Recommendation: opção 2.
- **Consequência para a PR #80:** mesclar a PR #87 fecha o BUG-20260910, mas **não** torna este RC verde sozinho. Enquanto esta decisão não sair, o Full continua `not-ready` pela régua de impacto.

## Learnings

- Antecipar o Full do RC prospectivo custou uma rodada e tirou o gate do caminho crítico: quando a #87 promover, só a re-execução das pernas afetadas fica pendente, não o ciclo inteiro.
- Uma jornada que depende de score precisa declarar a persona com acervo pontuado no charter; caso contrário a sessão mede o escopo, não a jornada.

## Final Status

- **Exit gate (full automated suite):** `pnpm check` — `Test Files 163 passed (163)`, `Tests 2209 passed | 7 skipped (2216)`, statements 95,95%, contratos do tracker `Ran 13 tests ... OK`. `pnpm test:e2e` — `232/232 verificações passaram`, `8/8 páginas sem violações axe WCAG 2.2 AA`.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 1 (aberta, aguardando decisão humana) · Trust-Damage 0 · Friction 0 · Cosmetic 0
- **Coverage:** 6 jornadas P0/P1 em escopo; 5 andadas, 1 bloqueada por exigir aparelho físico. 7 linhas com veredito Pass, 2 bloqueadas por decisão, 1 por aparelho, 1 cortada com motivo.
- **Verdict:** **not-ready** — o defeito que levou a PR #80 a `not-ready` está fechado e verificado neste código, e nada mais falhou. O que impede o verde é a decisão pendente sobre onde a nota da candidatura é lida: Data-Loss aberta em jornada P0 bloqueia release, e essa escolha não é minha para fazer.
