---
id: PROF-create-own-profile-double-submit
area: PROF
title: Duplo envio não cria dois perfis
persona: Candidato convidado sem perfil
journey: J-create-own-profile
expected: Dois toques rápidos em Criar perfil (ou rede lenta com reenvio) terminam com um único perfil e, se houver currículo colado, uma única versão
entry_points: /candidate
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s1-created-nina.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: PROF-create-own-profile
---

Rodar com rede lenta (throttling 3G) e tocar duas vezes no botão. A garantia é a trava da linha da conta em createOwnCandidate; a prova automatizada está em tests/candidate-onboarding.test.ts.

Full 1.22.0 (2026-09-22): Dois toques no mesmo instante: um candidato só (#7, sem id pulado) e uma versão de CV. Rede lenta não foi simulada.
