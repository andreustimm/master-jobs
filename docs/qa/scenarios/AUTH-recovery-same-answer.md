---
id: AUTH-recovery-same-answer
area: AUTH
title: Pedir recuperação de senha não revela quem tem conta
persona: Candidato após falha
journey: J-manage-own-account
expected: Endereço cadastrado e não cadastrado recebem a mesma URL e o mesmo texto de "se existir uma conta"; o link local leva à troca de senha, funciona uma vez só e derruba as sessões abertas
entry_points: /login; /login/forgot
qa_status: fail
bug_ids: BUG-20260922-local-reset-link-https
fix_status: pending
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s2-forgot-daniel.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: AUTH-canonical-transition-boundaries; AUTH-recovery-link-withheld-hosted
---

No ambiente local sem `RESEND_API_KEY` o link vai para o terminal do servidor,
que é o caminho legítimo de processo local.

Full 1.22.0 (2026-09-22): Mesma URL (/login/forgot?sent=1) e mesmo texto para conta existente e inexistente; link de uso único e sessões derrubadas confirmados. Falha: no build local o link impresso é https e não abre (BUG-20260922-local-reset-link-https).
