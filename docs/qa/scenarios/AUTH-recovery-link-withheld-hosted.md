---
id: AUTH-recovery-link-withheld-hosted
area: AUTH
title: Em deployment o link de recuperação nunca aparece no log
persona: Candidato após falha
journey: J-manage-own-account
expected: Em deployment sem Resend configurado a tela responde igual ao caso local, e o log do servidor traz só um alerta sem destinatário, assunto, token nem link
entry_points: /login/forgot
qa_status: blocked-verify
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/log.txt
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: AUTH-recovery-same-answer
---

#239: o link de reset é credencial, e o log das funções da Vercel é lido por
outras pessoas. Só se verifica de verdade num deployment (preview ou produção),
lendo o log da função depois de pedir a recuperação de uma conta de teste.

Full 1.22.0 (2026-09-22): Só um deployment mostra o log hospedado. Humano: em preview ou produção sem RESEND_API_KEY, pedir a recuperação de uma conta de teste e ler o log da função na Vercel — deve haver só o alerta, sem destinatário, assunto, token nem link.
