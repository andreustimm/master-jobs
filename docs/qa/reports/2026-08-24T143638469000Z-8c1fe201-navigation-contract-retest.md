# QA Run Report — 20260824T143638469000Z-8c1fe201 — navigation contract retest

- **Scope:** `bfd27a9` — contratos de transição, autorização da navegação, contenção responsiva e localização integral do estado vazio do Funil.
- **Cadence tier:** targeted
- **Build:** `bfd27a9` · **Environment:** `http://127.0.0.1:3015`, build Next de produção e banco SQLite isolado; URL final confirmada na sessão.
- **Started:** 2026-08-24T14:36:38.469Z · **Status:** closed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Candidato por teclado | `docs/qa/personas.md` | desktop Chromium 1280×900 / wifi local / en | CH-keyboard-screen-transition |
| Andreus em triagem | `docs/qa/personas.md` | desktop Chromium 1280×900 / wifi local / pt-BR | CH-first-party-navigation-inventory, CH-direct-startup-canary |

## Flows in Scope

- `J-switch-workspace-screen` — chegar à próxima área com feedback verdadeiro e sem operar conteúdo obsoleto (`../journeys/J-switch-workspace-screen.md`).
- `J-open-dashboard-direct` — abrir diretamente uma superfície autorizada sem camadas duplicadas (`../journeys/J-open-dashboard-direct.md`).

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-keyboard-screen-transition | J-switch-workspace-screen / NAV-switch-screen-ready | Candidato por teclado | Accessibility Tour | Fixed | BUG-20260823-pipeline-empty-state-mixed-locale | bfd27a9 |
| 2 | CH-keyboard-screen-transition | J-switch-workspace-screen / NAV-accessible-mobile-transition | Candidato por teclado | Accessibility Tour | Pass | | |
| 3 | CH-first-party-navigation-inventory | J-switch-workspace-screen / NAV-first-party-navigation-contract; AUTH-canonical-transition-boundaries (adjacente, não terminal) | Andreus em triagem | Feature Tour | Pass | | |
| 4 | CH-direct-startup-canary | J-open-dashboard-direct / PWA-direct-load-startup-singleton (adjacente, não terminal) | Andreus em triagem | Feature Tour | Pass | | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-keyboard-screen-transition — Candidato por teclado

- **Ran:** 2026-08-24T14:38:00Z → 2026-08-24T14:42:00Z (box respected: yes)
- **Findings:** o bug conhecido de idioma não reapareceu; o candidato chegou ao Funil por Tab/Enter, leu apenas inglês e repetiu o resultado após recarga, voltar e avançar.
- **Bugs filed/updated:** BUG-20260823-pipeline-empty-state-mixed-locale → verified.
- **Scenarios settled:** NAV-switch-screen-ready → Fixed; NAV-accessible-mobile-transition → Pass.
- **Paper cuts:** nenhum.
- **Surprises:** a primeira sequência de Tab ativou um filtro porque o foco inicial não era o primeiro item do menu; ao iniciar no menu como faria um usuário de teclado, a ordem Cockpit → Jobs → Compare job → Pipeline foi coerente.
- **Suggested next charter:** VoiceOver e PWA instalada em iPhone físico no Full QA de staging.

### CH-first-party-navigation-inventory — Andreus em triagem

- **Ran:** 2026-08-24T14:42:00Z → 2026-08-24T14:46:30Z (box respected: yes)
- **Findings:** nenhum finding de produto. Cockpit, Vagas, Comparar vaga, Funil, Referrals, Candidato e Usuários chegaram às URLs canônicas; filtro `fit=45`, densidade `dense=1` e página 2 persistiram em URL.
- **Bugs filed/updated:** nenhum novo.
- **Scenarios settled:** NAV-first-party-navigation-contract → Pass. AUTH-canonical-transition-boundaries permanece `untested` até ser percorrido por Candidato após falha.
- **Paper cuts:** nenhum.
- **Surprises:** um clique automatizado em “Próxima” não disparou enquanto o link estava fora da viewport; após `scrollintoview`, a mesma interface navegou corretamente para `page=2`, classificando o primeiro resultado como artefato do driver e não produto.
- **Suggested next charter:** repetir o inventário completo no Full QA de staging com Safari/Firefox reais.

### CH-direct-startup-canary — Andreus em triagem

- **Ran:** 2026-08-24T14:46:30Z → 2026-08-24T14:48:05Z (box respected: yes)
- **Findings:** abertura direta e recarga em `/` terminaram no Cockpit utilizável, sem camada órfã, erro de página ou console.
- **Bugs filed/updated:** nenhum.
- **Scenarios settled:** nenhum; PWA-direct-load-startup-singleton permanece `untested` até ser percorrido por Candidato em trânsito.
- **Paper cuts:** nenhum.
- **Surprises:** nenhuma.
- **Suggested next charter:** smoke pós-deploy em staging pela `start_url` da PWA instalada.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-switch-workspace-screen | pass | pass | pass | pass | pass | pass com lacunas qualificadas | screenshots desktop/mobile; `tests/e2e/ui.mjs`; 178/178 browser checks |
| J-open-dashboard-direct | pass | pass | pass | pass | pass | pass com lacunas qualificadas | vídeo e screenshot do startup; E2E direto e soft navigation |

## What Was Fixed

### BUG-20260823-pipeline-empty-state-mixed-locale: Funil vazio mistura idiomas
- **Symptom:** o candidato em inglês via o estado vazio do Funil em português.
- **Root cause:** os textos do estado vazio eram literais JSX fora do dicionário tipado.
- **Fix:** `bfd27a9`.
- **Regression test:** `tests/e2e/ui.mjs` — prova transição e recarga em `en`, com presença do inglês e ausência do português.
- **Retested:** persona original no desktop em inglês, recarga, histórico e canária móvel iPhone 15 emulada; jornadas adjacentes de inventário e abertura direta também passaram.

## Paper Cuts

| Persona | Where (journey/step) | Felt | Sharpness | Outcome |
|---|---|---|---|---|
| — | — | Nenhum paper cut novo | — | — |

## Runtime Errors Observed

- Nenhum erro de produto ou console. O servidor registrou apenas mensagens esperadas de conexões de navegação abandonadas durante o E2E automatizado; não reapareceram nas sessões públicas.

## Human Verifications Needed

- [ ] No Full QA de staging, confirmar VoiceOver e PWA instalada em iPhone físico; é uma lacuna de paridade não bloqueante desta rodada, não uma linha funcional pendente.

## Decisions for a Human

- Nenhuma.

## Learnings

- Um link abaixo da viewport deve ser rolado antes do clique no driver de QA; ausência de request nessa condição é artefato de automação, não evidência suficiente para abrir bug.
- A autorização precisa ser verificada pela composição: o recrutador mostrou apenas Vagas, entrou nessa superfície e recebeu o 403 canônico ao abrir `/candidate`.

## Final Status

- **Exit gate (full automated suite):** `rtk pnpm check` — exit 0, 148/148 arquivos, 2.082 testes aprovados, 6 pulados, 97,45% de cobertura de linhas e 13/13 contratos QA; `rtk pnpm test:e2e` — exit 0, 178/178 verificações e 8/8 páginas sem violações axe WCAG 2.2 AA; `rtk pnpm test:pwa-browser` — exit 0, 22/22.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 abertos (1 verificado) · Friction 0 · Cosmetic 0
- **Coverage:** 2/2 jornadas exercitadas; 2/4 linhas terminais sob a persona planejada e 2 canários adjacentes não terminais, desktop Chromium 1280×900 e iPhone 15 emulado 393 px; WebKit móvel, zoom 200%, temas e reduced motion no E2E do mesmo build. Firefox, Safari físico, extensões reais e rede 3G ficaram como lacunas qualificadas.
- **Verdict:** ready para o escopo targeted — o bug conhecido foi verificado como corrigido e não há finding aberto; os dois canários executados sob persona distinta continuam `untested` no tracker até o Full QA de staging.
