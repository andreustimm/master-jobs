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
que é o caminho legítimo de processo local. Desde a #378, "local" é o processo
que **se declara** local (`JHO_ENV=local`): `pnpm dev` declara sozinho quando
o `.env` não declara `JHO_ENV`, e `node tests/e2e/run-isolated.mjs --manual`
sobe o servidor com `JHO_ENV=local` e `JHO_PUBLIC_URL` apontando para a própria
porta. Sem a declaração, o link não aparece no terminal (vira o caso de
AUTH-recovery-link-withheld-hosted).

A igualdade de resposta só prova alguma coisa se os dois pedidos passaram pelo
ramo que consulta a conta. Sem origem confiável, a action grava
`reset_send_failed` para qualquer endereço sem olhar o cadastro, e as duas
respostas ficam iguais por construção. O E2E automático
(`tests/e2e/ui/password-reset.mjs`) confere no banco: o endereço inexistente
precisa ter `reset_requested_unknown`, que só o ramo real grava, e o existente
não pode ter o detalhe "origem pública não configurada". No QA manual, confira
o mesmo em `auth_event`, ou confira que o link chegou ao terminal para a conta
existente.

Full 1.22.0 (2026-09-22): Mesma URL (/login/forgot?sent=1) e mesmo texto para conta existente e inexistente; link de uso único e sessões derrubadas confirmados. Falha: no build local o link impresso é https e não abre (BUG-20260922-local-reset-link-https).
