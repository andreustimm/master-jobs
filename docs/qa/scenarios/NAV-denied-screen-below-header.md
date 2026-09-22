---
id: NAV-denied-screen-below-header
area: NAV
title: Tela de acesso negado e 404 começam logo abaixo do cabeçalho
persona: Candidato convidado sem perfil
journey: J-open-dashboard-direct
expected: Uma rota negada (403) ou inexistente (404) mostra o painel logo abaixo do cabeçalho, sem vão de uma tela inteira, com o botão de voltar ao início centralizado e tocável, em 375 px e em 1280 px, em português e em inglês
entry_points: /admin/users; /jobs/999999999; /rota-inexistente
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s1-nav-renata-lap-1280-_candidate.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: AUTH-canonical-transition-boundaries
---

Regressão visual reportada pelo dono em produção (#244): `min-block-size: 100dvh`
dentro do layout com cabeçalho empurrava o painel para o meio de uma segunda
tela. Medir a distância entre o fim do cabeçalho e o topo do painel e o
`scrollWidth` em 375 px.

Full 1.22.0 (2026-09-22): 403 e 404 com o título 32 px abaixo do cabeçalho em 375 e 1280, pt-BR e en; botão Voltar ao início com 44 px de altura, flex centralizado; sem estouro horizontal.
