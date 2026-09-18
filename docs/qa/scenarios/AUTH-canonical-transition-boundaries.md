---
id: AUTH-canonical-transition-boundaries
area: AUTH
title: Resolver transições de autenticação e autorização sem conteúdo residual
persona: Candidato após falha
journey: J-switch-workspace-screen
expected: Login, recovery, callback, papéis, sessão expirada e recursos revogados terminam no resultado canônico sem revelar conteúdo anterior nem a modal de Novidades antes de uma sessão válida
entry_points: /login; /login/forgot; /login/reset; /login/callback; /p/[slug]
qa_status: pass
bug_ids: BUG-20260824-canonical-route-splash; BUG-20260827-changelog-visible-before-login
fix_status: fixed
retest_status: verified
fix_commits: 7ba2890; fe5cdbf; 1570ccd
evidence: tests/e2e/ui.mjs; tests/changelog.test.ts; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-repeated-reset-terminal.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-impersonated-target-terminal.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-impersonation-ended-terminal.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-candidate-forbidden-admin.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/auth-candidate-forbidden-admin-goal.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/recruiter-forbidden-candidate.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/recruiter-forbidden-candidate-goal.png; docs/qa/reports/2026-08-27T162317105000Z-76fc8fc9-pwa-cache-refresh.md
last_report: docs/qa/reports/2026-09-18T202222983242Z-8870c32d-release-candidate-1.13.1-full.md
overlaps:
---

Cobertura: candidato, recrutador, administrador, impersonação, sessão expirada, token inválido/repetido, 404 e revogação durante navegação.

Migração PostgreSQL: novo percurso obrigatório para o driver e armazenamento
de sessões; vereditos e correções anteriores permanecem como histórico.

Na rodada 2026-09-10T011143000000Z-8bd417c2-supabase-production, a perna
CH-recruiter-private-english passou em ambiente local: login, negativa privada,
refresh, retorno permitido e logout. Isso não encerra o cenário abrangente;
recovery, callback e demais papéis ainda exigem percurso nesta rodada.

A mesma rodada percorreu depois CH-auth-boundary-recovery: token inválido,
login candidato, recusa administrativa após reload/back/forward e logout
seguido de acesso privado redirecionado ao login. Essas pernas passaram;
callback válido, impersonação, expiração por relógio e rede flaky continuam
sem cobertura manual atual. Não converter o cenário inteiro para pass.

17/09/2026, pré-varredura sem sessão em 375×812: `/candidate` e `/api/export`
terminam em `/login` sem conteúdo do candidato, `/p/alex` devolve 404 — e não
403, que confirmaria a existência do slug —, e o gatilho de Novidades não existe
antes de uma sessão válida, nos dois idiomas. As pernas de recovery, callback e
token expirado/consumido/disputado não foram andadas: o seed manual não cria
esses tokens e forjá-los sairia da via pública. O cenário segue `untested` até o
Full rodar com o seed que os cria. Relatório:
docs/qa/reports/2026-09-17T230607949478Z-796f372b-pre-varredura-cenarios-nao-testados.md

O Full QA confirmou token consumido, impersonação e as respostas canônicas. O primeiro percurso revelou que o layout inserido por Flight deixava o splash inerte sobre 403/404 após reload. A correção passou a remover somente esse splash sem timer ativo; candidato e recrutador foram retestados em build de produção local, com HTTP 403 preservado, tela localizada visível e nenhuma camada residual.
