---
id: AUTH-shared-candidate-denied
area: AUTH
title: Conta sem candidato próprio não alcança o perfil do dono
persona: Candidato após falha
journey: J-refresh-candidate-ranking
expected: Conta convidada apontada para o candidato do dono, logada direto ou assumida pelo admin, recebe 403 em /candidate, /candidate/skills, /candidate/vocabulary e na ação de salvar visibilidade, e não vê trilhas, buscas nem funil do dono; o dono continua vendo o próprio perfil; conta criada por /admin/users ou `jho auth add-user` vê um perfil vazio próprio
entry_points: /candidate; /candidate/skills; /candidate/vocabulary; /searches; /pipeline; /admin/users
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s1-borrowed-nina-candidate.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: PROF-rescore-status-privacy
---

Hotfix do vazamento da v1.20.5: a conta 3 de produção apontava para o
candidato `default` e abria `/candidate` com nome, versões de CV e visibilidade
do dono. Percorrer com login real das duas formas — senha e impersonação —, e
recarregar a página para confirmar o 403.

Full 1.22.0 (2026-09-22): O estado 'conta apontada para o candidato do dono' não é mais criável por nenhuma interface (admin e CLI criam candidato próprio; índice único da 0009); conta sem candidato recebe 403 em /candidate/skills, /candidate/vocabulary, /searches, /pipeline, /referrals e /compare, direto e emprestada; Otto (admin) e Pia (CLI) veem perfil vazio próprio; o dono segue vendo o seu.
