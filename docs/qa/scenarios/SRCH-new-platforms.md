---
id: SRCH-new-platforms
area: SRCH
title: Encontrar vagas da Jobicy, da Workable e do Hacker News
persona: Andreus em triagem
journey: J-save-term-search
expected: Um termo salvo mostra seis plataformas, incluindo Jobicy, Workable e Hacker News; as vagas delas aparecem em Vagas com empresa nomeada e link para a origem, e a vaga da Jobicy restrita a outro país aparece bloqueada
entry_points: /searches; /jobs?source=jobicy; /jobs?source=workable; /jobs?source=hackernews; pnpm jho sources probe jobicy --term laravel
qa_status: blocked-verify
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-saved-term-reaches-new-jobs-baseline-05-trilha-criada.png
last_report: docs/qa/reports/2026-09-21T175034729239Z-e901131e-qa-buscas.md
overlaps: SRCH-save-term-from-jobs; JOBS-country-only-blocked
---

A vaga do Hacker News abre o comentário no fio do mês e não tem botão "aplicar":
a candidatura é pelo contato que a própria empresa escreveu. A da Jobicy e a da
Workable levam à página original da vaga. O texto de cobertura da tela Buscas
cita as seis plataformas.
