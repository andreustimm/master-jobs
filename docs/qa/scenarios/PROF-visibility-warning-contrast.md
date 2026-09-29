---
id: PROF-visibility-warning-contrast
area: PROF
title: Confirmar contraste do aviso de perfil público nos seis ambientes
persona: Andreus no celular
journey: J-toggle-profile-visibility
expected: O aviso "legível por qualquer um" (`--warn-text`) mede pelo menos 4.5:1 contra o fundo em hp, huly e graphy, claro e escuro
entry_points: /candidate
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: tests/e2e/ui/themes.mjs
last_report: docs/qa/reports/2026-09-29-aviso-contraste-targeted.md
overlaps:
---

Achado do `/impeccable audit` (#383): `--warn` usado como cor de texto dava
4.06:1 em huly e graphy claros, abaixo do mínimo do WCAG 1.4.3 AA (4.5:1). O
axe do E2E não pegava porque roda só no tema padrão (hp).

Correção: token de texto `--warn-text` (`app/themes.css`), trocado nos quatro
usos (`app/candidate/page.tsx`, `app/layout.tsx` x2, `app/admin/operacoes/page.tsx`)
e guardado por `tests/design.test.ts` (`text-[var(--warn)]` reprova).

Evidência é automatizada, não uma sessão manual: `tests/e2e/ui/themes.mjs`
(`✓ todo texto passa em 4.5:1 nos seis ambientes`) navega para `/candidate`
em cada uma das seis combinações de tema/modo, lê o `color` e o `background-color`
computados do elemento `[data-testid="visibility-public-warning"]` num Chromium
real, e calcula o contraste pela fórmula WCAG — mais preciso do que leitura a
olho para uma medição de contraste. Rodado nesta sessão: 18/18 verificações da
área `themes` passaram, incluindo essa.
