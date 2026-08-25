---
id: NAV-failed-screen-retry
area: NAV
title: Recuperar uma navegação que falhou
persona: Candidato em trânsito
journey: J-switch-workspace-screen
expected: O overlay libera uma mensagem localizada sem detalhe técnico e tentar novamente chega ao destino
entry_points: /jobs
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/mobile-failed-transition.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/mobile-failed-retry-success.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/mobile-failed-recovered.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/mobile-failed-real-route.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/mobile-failed-real-recovered.png; docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
last_report: docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
overlaps:
---

Cobertura: falha, redação de exceção, recuperação e ausência de estado residual.

Além do fixture automatizado, o reteste desligou a rede com o service worker ativo durante a abertura de `/candidate/vocabulary` em 375×812. O fallback localizado preservou a URL e não mostrou conteúdo privado; depois da reconexão, o botão de retry carregou a rota real sem overflow ou camada residual.
