# QA Run Report — 2026-08-26T174227129000Z-c759d603 — responsive header artifact skew

- **Scope:** cabeçalho responsivo resiliente a HTML e CSS publicados fora de sincronia, sem links empilhados nem dois menus simultâneos
- **Cadence tier:** targeted
- **Build:** `a56a0c1` · **Environment:** build Next.js de produção limpo e isolado, banco temporário e navegador real; comparação de artefatos com `jobs.mastertimm.com.br`
- **Started:** 2026-08-26T17:42:27Z · **Status:** closed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus no celular | `docs/qa/personas.md` | 375×812 e 812×375 / 4g / pt-BR | CH-mobile-responsive-regression |
| Andreus em triagem | `docs/qa/personas.md` | 768×1024 e 1280×900 / wifi-fast / pt-BR | canário de navegação |

## Flows in Scope

- `J-switch-workspace-screen` — trocar de tela com um único modo de navegação visível e operável (`../journeys/J-switch-workspace-screen.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-mobile-responsive-regression | J-switch-workspace-screen / NAV-first-party-navigation-contract | Andreus no celular | Feature Tour | Fixed | BUG-20260826-responsive-header-artifact-skew | a56a0c1 |
| 2 | canário de navegação | J-switch-workspace-screen / NAV-first-party-navigation-contract | Andreus em triagem | Feature Tour | Pass | | a56a0c1 |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-mobile-responsive-regression — Andreus no celular

- **Ran:** 2026-08-26T17:46Z → 2026-08-26T17:55Z (box respected: yes)
- **Findings:** no artefato `standalone`, 375×812 e 812×375 mostraram apenas o hambúrguer; 768×1024 manteve o modo compacto porque a fileira não cabe. O cabeçalho mediu 57px e o documento não teve overflow horizontal. O primeiro toque abriu o menu e o segundo fechou.
- **Bugs filed/updated:** `BUG-20260826-responsive-header-artifact-skew` → verified.
- **Scenarios settled:** `NAV-first-party-navigation-contract` → pass.
- **Paper cuts:** nenhuma nova.
- **Surprises:** o traço `standalone` local omitiu o pacote nativo opcional de libSQL para Darwin; ele foi restaurado da mesma instalação antes da sessão, sem alterar HTML, CSS ou JavaScript do build.
- **Suggested next charter:** smoke do deploy publicado depois da promoção para confirmar que HTML e CSS compartilham a mesma versão.

### Canário de navegação — Andreus em triagem

- **Ran:** 2026-08-26T17:55Z → 2026-08-26T17:58Z (box respected: yes)
- **Findings:** em 1280×900 a navegação completa permaneceu horizontal e o hambúrguer ficou oculto. O cabeçalho mediu 57px e não houve overflow.
- **Bugs filed/updated:** nenhum novo.
- **Scenarios settled:** `NAV-first-party-navigation-contract` → pass.
- **Paper cuts:** nenhuma.

### Reteste do fix loop — Andreus no celular e em triagem

- **Ran:** 2026-08-26T19:11Z → 2026-08-26T19:18Z (box respected: yes), depois dos commits visíveis `cce67ae` e `a56a0c1`.
- **Findings:** no build limpo `a56a0c1`, 375×812, 812×375 e 768×1024 mostraram somente o hambúrguer; 1280×900 mostrou somente a fileira horizontal. O cabeçalho permaneceu em 57px, sem overflow próprio ou do documento. O menu abriu, fechou no segundo toque e permaneceu fechado depois de recarregar.
- **Adjacent journey:** `/jobs` em retrato e paisagem e `/` em tablet e desktop mantiveram a mesma geometria, direção e exclusão mútua.
- **Edge probe:** um nome de conta no limite permitido foi salvo pela interface. Antes de `a56a0c1`, o nome alargava o documento; depois, ficou limitado a 24 caracteres tipográficos, com o valor completo no conteúdo e no título, zero overflow e resultado preservado após refresh.
- **Evidence:** `docs/qa/evidence/2026-08-26T174227129000Z-c759d603-responsive-header-artifact-skew/final-retest-a56a0c1/{mobile-portrait-closed,mobile-portrait-open,mobile-landscape,tablet,desktop,desktop-long-name-fixed}.png` (diretório local ignorado pelo git).
- **Console / page errors:** nenhum.
- **Bugs filed/updated:** `BUG-20260826-responsive-header-artifact-skew` → verified.
- **Scenarios settled:** `NAV-first-party-navigation-contract` → pass.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-switch-workspace-screen | pass | pass | pass | pass | pass | pass with disclosed local native-package restoration | screenshots nos quatro viewports; `tests/e2e/ui.mjs`; `tests/nav-mobile.test.ts` |

## What Was Fixed

### BUG-20260826-responsive-header-artifact-skew: cabeçalho empilha os links e exibe os dois menus

- **Symptom:** links globais apareciam empilhados dentro de um cabeçalho gigante ao mesmo tempo que o hambúrguer.
- **Root cause:** o HTML dependia exclusivamente de seletores CSS novos e medição no cliente; quando produção combinou esse HTML com CSS anterior, o `nav` voltou ao `display: block` padrão.
- **Fix:** `062eb64` restaura guards utilitários no HTML e mantém a medição como aprimoramento progressivo; `cce67ae` preserva o painel quando uma tela larga ainda precisa do modo compacto; `055af8a` e `a56a0c1` limitam visualmente nomes de conta longos sem alterar o valor salvo.
- **Regression tests:** `tests/nav-mobile.test.ts` falhou antes e passa depois para o fallback, o painel largo e o truncamento aplicável; `tests/e2e/ui.mjs` verifica altura, direção, exclusão mútua e abertura do painel compacto em 1280px.
- **Retested:** `J-switch-workspace-screen` desde `/admin/users`, `/jobs` e `/`, em retrato, paisagem, tablet e desktop, com sessões frescas no build limpo `a56a0c1`.

## Paper Cuts

Nenhum registrado antes da sessão.

## Runtime Errors Observed

- A primeira tentativa de iniciar o traço `standalone` local respondeu 500 por ausência de `@libsql/darwin-arm64` no diretório traçado. O pacote já instalado pelo lockfile foi copiado para o traço e o servidor foi reiniciado antes das sessões; nenhum erro de aplicação ou console foi observado durante os percursos válidos.
- O E2E registrou `The destination stream closed early` durante as sondas que abandonam navegações; as 205 verificações, inclusive as de recuperação dessas transições, terminaram verdes.

## Human Verifications Needed

Nenhuma prevista para este contrato de layout.

## Decisions for a Human

Nenhuma.

## Learnings

- Um layout crítico precisa de um estado HTML seguro antes de qualquer medição no cliente; CSS dinâmico pode melhorar o breakpoint, mas não pode ser o único guard de visibilidade.

## Final Status

- **Exit gate (full automated suite):** `rtk pnpm check` — 152 arquivos, 2.135 testes passaram, 6 ignorados; cobertura Statements 95,96%, Branches 92,75%, Functions 96,16%, Lines 96,85%. `rtk pnpm test:e2e` — 205/205 verificações e 8/8 páginas sem violações axe WCAG 2.2 AA.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 · Friction 0 · Cosmetic 0
- **Coverage:** 1 / 1 jornada percorrida; quatro viewports, três rotas, alternância abrir/fechar, refresh e nome no limite permitido
- **Verdict:** ready — o fallback estrutural, o build limpo, o reteste fresco após o último fix, os quatro viewports e os gates automatizados confirmam um único modo de navegação sem empilhamento ou overflow.
