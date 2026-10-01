---
id: PROF-create-own-profile-pdf
area: PROF
title: Criar o perfil enviando o currículo em PDF
persona: Candidato convidado sem perfil
journey: J-create-own-profile
expected: O formulário de criação aceita o PDF do currículo; o perfil nasce com o texto extraído no editor e o aviso pede a revisão; arquivo que não é PDF, PDF digitalizado, arquivo acima de 10 MB ou PDF junto com texto colado voltam recusados com a razão, sem criar o perfil
entry_points: /candidate
qa_status: pass
bug_ids: BUG-20260929-import-non-pdf-500; BUG-20260929-obsolete-pdf-upload-text
fix_status: fixed
retest_status: pass
fix_commits: 053a5d8
evidence: tests/e2e/ui/onboarding.mjs
last_report: docs/qa/reports/2026-10-01-pr414-prof-create-own-profile-pdf-retest.md
overlaps: PROF-create-own-profile; PROF-create-own-profile-identity
---

Entrega da #278. Percorrer em 375 px e em inglês: o campo de arquivo cabe, a recusa mantém os campos preenchidos e o PDF escolhido, e depois de criar o editor do currículo mostra o texto do PDF com a versão nomeada pelo arquivo. Conferir no refresh que a área do candidato permanece e que o texto continua lá.

Reteste #388 inclui o perfil já existente: importar arquivo de texto renomeado para PDF deve explicar a recusa, manter o CV e sua versão após refresh e permitir nova tentativa. O formulário não anuncia upload inexistente.

2026-10-01, evidência de navegador pelo E2E hermético `node
tests/e2e/run-isolated.mjs --areas onboarding` (achado 1 da revisão L1 da PR
#414, issue #388): o bloco "Criar o perfil enviando o currículo em PDF
(#278), em 375px" (`tests/e2e/ui/onboarding.mjs:138-229`) é o canário
automatizado deste cenário — cobre a recusa do arquivo renomeado na criação,
o caminho feliz com PDF de verdade e o reteste da #388 nos dois idiomas.
44/44 verificações. Detalhe em `docs/qa/reports/2026-10-01-pr414-prof-create-own-profile-pdf-retest.md`.
