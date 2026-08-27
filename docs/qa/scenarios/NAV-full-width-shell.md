---
id: NAV-full-width-shell
area: NAV
title: Conteúdo ocupa a largura integral com calha fixa do celular ao monitor
persona: Candidato em trânsito
journey: J-open-dashboard-direct
expected: Em 375px o conteúdo usa 100% da largura menos calhas de 16px; no tablet 24px; acima de lg, 32px; acima de 1760px o shell para de crescer e centra. Nenhuma margem percentual, nenhum overflow horizontal.
entry_points: /
qa_status: untested
fix_commits: codex/header-safe-area-web
evidence: tests/e2e/ui.mjs; tests/mobile.test.ts
overlaps: PWA-installed-header-safe-area; SKIL-mobile-layout
---

O container da página era um tripé: 95vw no celular, 90% depois de `sm`, e uma
classe CSS que zerava o padding para o percentual dominar. Três regras
sincronizadas eram três chances de um CSS de geração errada no build deixar a
página sem margem — foi o que a produção serviu em 2026-08-26, com o HTML novo
e o CSS da geração anterior.

O shell agora é uma regra só: `max-w-[1760px]` com calha fixa da escala do
DESIGN.md (`px-4` / `sm:px-6` / `lg:px-8`) nas quatro superfícies — cabeçalho,
banner de sessão emprestada, conteúdo e rodapé. No modo instalado, o recorte
físico substitui a calha quando é maior, nunca soma a ela.

Cenário novo; aguarda rodada targeted de QA (celular, tablet, desktop e uma
janela acima de 1760px conferindo o teto e o centramento).
