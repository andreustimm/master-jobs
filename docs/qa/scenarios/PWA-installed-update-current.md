---
id: PWA-installed-update-current
area: PWA
title: Retomar o aplicativo instalado na geração atual
persona: Candidato em trânsito
journey: J-open-dashboard-direct
expected: Ao voltar ao primeiro plano depois de um deploy, a PWA troca para a geração atual com uma única recarga e deixa de mostrar o visual anterior
entry_points: /; start_url da PWA instalada
qa_status: blocked-verify
bug_ids: BUG-20260827-pwa-stale-style-after-deploy
fix_status: fixed
retest_status: pending
fix_commits: 8d55f90
evidence: tests/service-worker-update.test.ts; tests/pwa.test.ts; tests/pwa-chrome.test.ts; docs/qa/evidence/2026-08-27T162317105000Z-76fc8fc9-pwa-cache-refresh/pwa-installed-stale-header-user-report.jpg
last_report: docs/qa/reports/2026-08-27T162317105000Z-76fc8fc9-pwa-cache-refresh.md
overlaps: PWA-installed-header-safe-area; PWA-direct-load-startup-singleton
---

A troca real entre duas gerações publicadas precisa ser confirmada no aplicativo instalado depois que o commit chegar ao ambiente. O gate automatizado prova a política de atualização, a recarga única e a ausência de recarga na primeira instalação; ele não substitui a retomada física de uma PWA que já estava aberta antes do deploy.
