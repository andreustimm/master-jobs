---
id: AUTH-account-change-password
area: AUTH
title: Trocar a própria senha derruba as outras sessões e mantém quem pediu
persona: Andreus em triagem noturna
journey: J-manage-own-account
expected: Com a senha atual certa a troca confirma, a outra sessão cai no login, este navegador continua conectado depois de recarregar e só a senha nova entra
entry_points: /account
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s2-bruno-password-changed.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: AUTH-canonical-transition-boundaries
---

Abrir duas sessões da mesma conta. Na primeira, trocar a senha em Minha conta.
Recarregar a primeira e conferir que continua dentro; abrir a segunda e conferir
que caiu no login. Entrar com a senha antiga (recusa) e com a nova (entra).

Full 1.22.0 (2026-09-22): Sessão A continua após reload; sessão B caiu no login; senha antiga recusada, nova entra.
