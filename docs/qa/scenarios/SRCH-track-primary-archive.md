---
id: SRCH-track-primary-archive
area: SRCH
title: Trocar a trilha principal, arquivar e restaurar
persona: Andreus em triagem
journey: J-manage-target-tracks
expected: Só uma trilha é principal; a arquivada some do seletor de Vagas e volta ao restaurar, com seus termos
entry_points: /searches; /searches/tracks/<id>; /jobs
qa_status: blocked-decision
bug_ids: BUG-20260921-track-selector-two-principal; BUG-20260929-track-evidence-ignores-candidate-cv
fix_status: fixed
retest_status: pending
fix_commits: 4181667; a57fc6a
evidence: evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-target-track-edit-archive-baseline-seletor-dois-principal.png; docs/qa/evidence/2026-09-29T142817000000Z-7ddfdc8b-track-evidence-candidate-cv/CH-target-track-edit-archive/03-track-evidence.png; docs/qa/evidence/2026-09-29T142817000000Z-7ddfdc8b-track-evidence-candidate-cv/CH-target-track-edit-archive/04-candidate-cv-after-refresh.png; docs/qa/evidence/2026-09-29T142817000000Z-7ddfdc8b-track-evidence-candidate-cv/CH-target-track-edit-archive/05-track-evidence-after-back.png; docs/qa/evidence/2026-09-29T142817000000Z-7ddfdc8b-track-evidence-candidate-cv/CH-target-track-edit-archive/06-track-evidence-375.png
last_report: docs/qa/reports/2026-09-29T142817000000Z-7ddfdc8b-track-evidence-candidate-cv.md
overlaps: JOBS-track-selector-fit
---

A trilha principal não pode ser arquivada: a mensagem pede para promover
outra antes. Arquivar pausa os termos da trilha; restaurar os retoma e
recalcula o fit. Vagas abre na trilha principal nova depois da troca.

Registro original do QA full do release candidate 1.29: o seletor de Vagas
ainda mostrava dois botões `PRINCIPAL` depois da troca (sem fix desde 21/09).
Na mesma sessão, o painel de evidência mostrava “perfil padrão” em vez do CV
real da candidata logada e contradizia `/candidate`.

Os dois achados foram corrigidos e retestados em branches separadas:

- **Seletor com dois `PRINCIPAL`** (`BUG-20260921-track-selector-two-principal`):
  a correção a57fc6a passou no percurso público de promoção, seleção,
  voltar/avançar, recarga, arquivamento e restauração. Relatório:
  `docs/qa/reports/2026-09-29T141137897408Z-1d3a7255-trilha-principal-391.md`;
  capturas no diretório de evidências homônimo.
- **Evidência ignora o CV corrente** (`BUG-20260929-track-evidence-ignores-candidate-cv`):
  o reteste da correção 4181667 passou e está documentado no relatório da
  branch `track-evidence-candidate-cv`.

`retest_status` permanece `pending` e `qa_status` continua `blocked-decision`
porque nenhuma sessão percorreu os dois juntos, de ponta a ponta, depois das
duas correções — o reteste desta entrada registra só cada bug isolado.
