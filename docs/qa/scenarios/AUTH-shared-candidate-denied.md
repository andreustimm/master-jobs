---
id: AUTH-shared-candidate-denied
area: AUTH
title: Conta sem candidato próprio não alcança o perfil do dono
persona: Candidato após falha
journey: J-refresh-candidate-ranking
expected: Conta convidada apontada para o candidato do dono, logada direto ou assumida pelo admin, recebe 403 em /candidate, /candidate/skills e /candidate/vocabulary; o dono continua vendo o próprio perfil; conta criada por /admin/users ou `jho auth add-user` vê um perfil vazio próprio
entry_points: /candidate; /candidate/skills; /candidate/vocabulary; /admin/users
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: PROF-rescore-status-privacy
---

Hotfix do vazamento da v1.20.5: a conta 3 de produção apontava para o
candidato `default` e abria `/candidate` com nome, versões de CV e visibilidade
do dono. Percorrer com login real das duas formas — senha e impersonação —, e
recarregar a página para confirmar o 403.
