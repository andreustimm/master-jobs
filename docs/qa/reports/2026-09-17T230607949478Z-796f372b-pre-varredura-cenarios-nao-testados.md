# QA Run Report — 2026-09-17T230607949478Z-796f372b — pré-varredura dos cenários nunca andados

- **Scope:** preparação do QA Full do release candidate 1.7.x. Os três cenários que estavam `untested` no tracker foram procurados em persona, para o Full começar sabendo o que já se sustenta e o que exige instrumento que o driver de jornada não tem. Não substitui o Full: o RC ainda não existe em `staging`.
- **Cadence tier:** targeted
- **Build:** 507c33b · **Environment:** build standalone do harness E2E em http://127.0.0.1:54220, PostgreSQL isolado, login de runtime sem privilégio administrativo.
- **Started:** 2026-09-17T23:06:07Z · **Status:** closed <!-- in-progress | closed -->

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Candidato em trânsito | Mobile User | telefone 375×812 / wifi local / en | pré-varredura NAV e PWA |
| Candidato após falha | Recovering User | telefone 375×812 / wifi local / en | pré-varredura AUTH |

## Flows in Scope

- `J-open-dashboard-direct` — abrir o produto direto e chegar a uma tela operável (`../journeys/J-open-dashboard-direct.md`)
- `J-switch-workspace-screen` — trocar de tela sem vazar conteúdo de outra sessão (`../journeys/J-switch-workspace-screen.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-mobile-direct-startup | J-open-dashboard-direct / NAV-full-width-shell | Candidato em trânsito | Landmark Tour | Pass | | |
| 2 | CH-mobile-direct-startup | J-open-dashboard-direct / PWA-direct-load-startup-singleton | Candidato em trânsito | Landmark Tour | Skipped | | |
| 3 | CH-auth-boundary-recovery | J-switch-workspace-screen / AUTH-canonical-transition-boundaries | Candidato após falha | Back-Button Tour | Skipped | | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

As duas linhas `Skipped` são cortes declarados, não verdes emprestados: cada uma
diz abaixo o que foi confirmado e o que falta para um veredito.

## Session Debriefs

### CH-mobile-direct-startup — Candidato em trânsito

- **Ran:** 2026-09-17T23:00Z → 2026-09-17T23:06Z (box respeitado: sim)
- **Findings:**
  - Em 375×812 o topo ocupa a largura inteira da viewport de layout (360 px com a barra de rolagem do harness) e o conteúdo fica com 341,25 px entre calhas de 9,375 px por lado — exatamente 2,5% de 375. É o contrato do cenário; a diferença de 15 px é a barra de rolagem clássica do Chrome headless, que não existe no telefone.
  - A carga direta não empilha overlay de transição: `[data-testid=navigation-transition]` some da página em zero ocorrências durante a hidratação.
  - O splash de 900 ms não foi medido. O driver de jornada não expõe cronometragem, e afirmar "curto" de olho seria inventar o veredito. A metade de camada única já é afirmada pela suíte automatizada (`task-04 E2E-013`).
- **Bugs filed/updated:** nenhum
- **Scenarios settled:** NAV-full-width-shell → pass; PWA-direct-load-startup-singleton permanece untested
- **Paper cuts:** nenhum
- **Surprises:** nenhuma
- **Suggested next charter:** medir o splash com instrumento de tempo, ou aceitar a cobertura automatizada e retirar a metade temporal do cenário.

### CH-auth-boundary-recovery — Candidato após falha

- **Ran:** 2026-09-17T23:02Z → 2026-09-17T23:06Z (box respeitado: sim)
- **Findings:**
  - Sem sessão, `/candidate` termina em `/login` sem exibir conteúdo do candidato, e `/api/export` faz o mesmo — o acervo inteiro não responde sem sessão.
  - `/p/alex` devolve "Page not found". 404 e não 403: a existência do slug não é confirmada a quem não pode vê-lo.
  - O gatilho de Novidades não existe antes de uma sessão válida, nos dois idiomas.
  - As pernas de recovery, callback, token expirado/consumido/disputado e recurso revogado não foram andadas: o seed manual não cria esses tokens, e forjá-los sairia da via pública. A suíte automatizada as cobre (`task-04 E2E-018`), o que é prova diferente da jornada em persona.
- **Bugs filed/updated:** nenhum
- **Scenarios settled:** AUTH-canonical-transition-boundaries permanece untested
- **Paper cuts:** nenhum
- **Surprises:** nenhuma
- **Suggested next charter:** no Full, andar as pernas de token com o seed que as cria, e só então assentar este cenário.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-open-dashboard-direct | pass | pass | não medido | pass (375×812) | pass | pass | docs/qa/evidence/2026-09-17T222310262016Z-5e419094-application-draft-on-rejected-transition/NAV-full-width-shell-mobile.png |

## What Was Fixed

Nada. Esta rodada não encontrou defeito.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|

## Runtime Errors Observed

- Nenhum.

## Human Verifications Needed

- Nenhuma nesta rodada. As seis jornadas instaladas/offline que exigem aparelho físico continuam `blocked-verify` no tracker e entram no Full.

## Decisions for a Human

Nenhuma nova. A decisão pendente sobre a nota da candidatura está no relatório anterior desta data.

## Learnings

- Dois cenários guardavam, dentro do mesmo `expected`, uma metade verificável pela jornada e outra que só instrumento mede. Separar essas metades — ou aceitar explicitamente a prova automatizada para uma delas — evita que o cenário fique `untested` para sempre.

## Final Status

- **Exit gate (full automated suite):** herdado da rodada anterior desta data, no mesmo commit: `pnpm check` com 2.207 testes e 7 skips; `pnpm test:e2e` com 231/231 e axe 8/8. Nenhuma alteração de runtime nesta rodada.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 · Friction 0 · Cosmetic 0
- **Coverage:** 1 cenário assentado de 3 procurados; os outros dois declarados acima com o que falta.
- **Verdict:** ready — esta rodada é preparação e não altera o veredito do release candidate, que continua dependendo do Full sobre `staging`.
