---
id: PROF-touch-target-44px
area: PROF
title: Confirmar 44px de alvo de toque e ausência de estouro em pointer:coarse real
persona: Andreus no celular
journey: J-tap-primary-controls-mobile
expected: Em contexto com toque real (hasTouch+isMobile), os botões de salvar do candidato e os CTAs do próprio perfil público medem pelo menos 44×44px, e nenhuma rota de OVERFLOW_SWEEP (inclusive /jobs com chips e barra de filtro, e o cabeçalho com idioma/aparência/sessão) ganha rolagem horizontal ou elemento cortado em 375px
entry_points: /candidate; /p/[slug]; OVERFLOW_SWEEP (tests/e2e/routes.mjs)
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: tests/e2e/ui/mobile.mjs
last_report: docs/qa/reports/2026-09-29-alvo-toque-targeted.md
overlaps: JOBS-not-interested
---

Achado do `/impeccable audit` (#403): a regra `@media (pointer: coarse)` de
`app/globals.css` fixava `min-height: 40px`, fora de `@layer`, então vencia
`min-h-11` (44px) do Tailwind v4 — todo botão, `summary` e link `inline-flex`
caía para 40px num aparelho de toque real, inclusive os botões `size="sm"`
sem classe extra (`save-public-facts`, `save-visibility`) que a regra global
"salvava" dos 28px originais, mas só até 40, não até os 44 do DESIGN.md.

A suíte inteira não pegava porque nenhum contexto de navegador rodava com
`hasTouch`/`isMobile`: `pointer: coarse` nunca casava, e `min-h-11` sozinho já
dá 44px sem toque — o mesmo botão media 44px "no papel" e 40px na mão.

Correção: `min-height: 44px` (alinhado ao DESIGN.md, "Touch Targets").

Evidência é automatizada: `tests/e2e/ui/mobile.mjs` abre um contexto próprio
com `hasTouch: true, isMobile: true, viewport: 375×812`, reaproveita a sessão
autenticada por `storageState`, e mede `boundingBox().height` de seis
controles reais num Chromium real: `save-public-facts` e `save-visibility`
(os dois que o achado original mediu em `/candidate`), e `public-profile-linkedin`,
`public-profile-github`, `public-profile-copy-link`, `public-skill-more` em
`/p/<slug>`. Confirmado nesta sessão: os seis mediam 40px antes da correção
(reproduzido revertendo o valor e rerodando — reprovou como esperado) e 44px
depois; nenhuma das duas telas ganhou rolagem horizontal em 375px.

**Revisão L1 pediu mais**: o bump de 40→44px vale para TODO
`button`/`[role="button"]`/`summary`/link `inline-flex` em toque, não só os
seis controles acima — e uma tela de densidade alta como `/jobs` (chips de
filtro, barra de filtro) é onde 4px por linha mais somam. O mesmo contexto de
toque agora percorre `OVERFLOW_SWEEP` inteiro (`tests/e2e/routes.mjs`: `/`,
`/jobs`, `/jobs?track=all`, `/jobs/905000031`, `/searches`, `/compare`,
`/candidate`, `/candidate/skills`, `/pipeline`, `/p/e2e-cv-formatado`) em
375px, reaproveitando a mesma varredura de `scrollWidth` e "elemento além da
borda" já usada no topo do arquivo sem toque — estendida para also olhar
`header *` (idioma, aparência, sessão), não só `main *`. Nada quebrou: as dez
rotas passaram sem rolagem horizontal nem elemento cortado, inclusive o
cabeçalho (presente em todas) e os filtros de `/jobs`/`/jobs?track=all`.
