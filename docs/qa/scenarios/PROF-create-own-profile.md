---
id: PROF-create-own-profile
area: PROF
title: Criar o próprio perfil a partir de uma conta sem candidato
persona: Candidato convidado sem perfil
journey: J-create-own-profile
expected: O formulário cria um candidato novo e privado com o nome digitado, e a área do candidato sobrevive ao refresh em 375 px e em inglês
entry_points: /candidate
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s1-created-nina.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: PROF-create-own-profile-double-submit; PROF-create-own-profile-identity
---

Percurso feliz da #234. Conferir que o link Criar meu perfil aparece na navegação do celular, que o texto está todo em inglês com a interface em inglês e que Privado vem marcado depois de criar.

Full 1.22.0 (2026-09-22): Nina (conta de papel candidato sem candidato) criou o perfil em 375 px e em inglês; Private marcado; sobreviveu ao reload; link Create my profile no menu do celular.
