---
id: PROF-visibility-warning-contrast
area: PROF
title: Confirmar contraste do aviso de perfil público e da faixa de sessão emprestada nos seis ambientes
persona: Andreus no celular
journey: J-toggle-profile-visibility
expected: O aviso "legível por qualquer um" (`/candidate`) e o texto da faixa de sessão emprestada (`--warn-text` sobre `bg-[var(--warn)]/10`) medem pelo menos 4.5:1 contra o fundo REAL, em hp, huly e graphy, claro e escuro
entry_points: /candidate; /jobs (sessão emprestada)
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

**Revisão L1 achou um segundo problema** na faixa de sessão emprestada
(`app/layout.tsx`): o texto senta sobre `bg-[var(--warn)]/10`, e o fundo REAL
ali não é `--card` sólido — é `--warn` a 10% de opacidade composto sobre
`--background`. Medido: com o primeiro valor de `--warn-text` (`#8f640f`),
graphy claro dava 4,27:1 contra esse fundo composto (abaixo de 4,5:1), embora
passasse 6,70:1 contra `--card` sólido. `--warn-text` ficou mais escuro
(`#7a5510`) para passar nos dois contextos, com margem: mínimo 5,44:1 contra
o pior fundo composto (graphy claro) e 6,70:1 contra `--card`.

A medição do fundo composto não é trivial: o Tailwind v4 resolve
`bg-[var(--warn)]/10` para `oklab(L a b / 0.1)`, não `rgba()` — um regex que
só entende `rgba?(...)` (o que a primeira versão deste teste usava) ignora
essa camada silenciosamente e mede contra o fundo sólido de baixo, como se o
`/10` não existisse. `tests/e2e/ui/themes.mjs` agora resolve cada camada por
um canvas de 1×1 (`fillStyle` aceita qualquer sintaxe CSS de cor, inclusive
`oklab`; `getImageData` devolve o `{r,g,b,a}` já em sRGB) e compõe as camadas
manualmente pela fórmula "over" do alfa, subindo a árvore do elemento até
achar um fundo opaco.

Evidência é automatizada, não uma sessão manual: `tests/e2e/ui/themes.mjs`
mede dois elementos em cada uma das seis combinações de tema/modo, num
Chromium real — `[data-testid="visibility-public-warning"]` em `/candidate`
(`✓ todo texto passa em 4.5:1 nos seis ambientes`) e
`[data-testid="impersonation-banner-text"]` em `/jobs`, numa sessão
impersonada de propósito para renderizar a faixa (`✓ faixa de sessão
emprestada passa em 4.5:1 contra o fundo composto (--warn a 10%) nos seis
ambientes`, contexto e login próprios, sem afetar a sessão do dono usada
pelo resto da suíte). Rodado nesta sessão: 19/19 verificações da área
`themes` passaram, incluindo as duas. Reproduzida a reprovação revertendo
`--warn-text` para o valor antigo (`#8f640f`): graphy claro deu 4,26:1,
batendo com o achado da revisão.
