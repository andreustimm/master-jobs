---
id: SRCH-save-term-from-jobs
area: SRCH
title: Salvar numa trilha o termo buscado em Vagas
persona: Andreus em triagem
journey: J-save-term-search
expected: A oferta de Vagas abre Buscas com o termo preenchido, e o termo salvo aparece na trilha com um estado por plataforma
entry_points: /jobs?q=laravel; /searches
qa_status: fail
bug_ids: BUG-20260929-platform-offer-opens-wrong-screen
fix_status: pending
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-target-track-edit-archive/01-sugestao-laravel.png; docs/qa/evidence/2026-09-29T035351654581Z-97f37e1c-full/CH-target-track-edit-archive/02-criar-trilha-termo-ja-salvo.png
last_report: docs/qa/reports/2026-09-29T035351654581Z-97f37e1c-full-release-candidate-1.29-full.md
overlaps: JOBS-term-filter-descriptions
---

Buscar um termo com poucas vagas, aceitar a oferta e salvar. O aviso de
sucesso diz que a busca começou; cada plataforma mostra na fila, buscando,
concluída, aguardando cota ou falhou, com o motivo traduzido. Recarregar
Buscas depois de alguns segundos e conferir que o estado avançou sem
interação. Nenhum texto de termo aparece como HTML interpretado.

Reteste de 29/09 (QA full do release candidate 1.29): a oferta "Buscar nas
plataformas" em Vagas não abre mais Buscas com o termo preenchido — abre
Nova trilha vazia, e salvar manualmente falha com "Esse termo já está
salvo". `qa_status` passa de `blocked-decision` para `fail`; ver
`BUG-20260929-platform-offer-opens-wrong-screen`.
