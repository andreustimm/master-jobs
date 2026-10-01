---
id: PROF-import-existing-cv-pdf
area: PROF
title: Recusar PDF inválido e importar um CV válido no perfil existente
persona: Candidato revisando o currículo
journey: J-refresh-candidate-ranking
expected: Arquivo renomeado para PDF recebe razão localizada sem substituir o CV; uma tentativa válida posterior persiste no editor e no histórico após refresh
entry_points: /candidate
qa_status: pass
bug_ids: BUG-20260929-import-non-pdf-500; BUG-20260929-obsolete-pdf-upload-text
fix_status: fixed
retest_status: pass
fix_commits: 053a5d8
evidence: docs/qa/evidence/2026-09-29T143500Z-codex388-importacao-pdf/versao-independente.png
last_report: docs/qa/reports/2026-09-29T143500Z-codex388-importacao-pdf.md
overlaps: PROF-create-own-profile-pdf
---

Em 375px, selecionar texto renomeado para PDF e ler a razão em pt-BR/en.
Recarregar: CV e versão anteriores permanecem. Importar PDF com texto real,
recarregar e abrir a versão no histórico para reler o conteúdo salvo.
A tela não afirma que upload de PDF inexiste.
