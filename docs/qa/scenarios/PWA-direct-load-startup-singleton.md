---
id: PWA-direct-load-startup-singleton
area: PWA
title: Abrir diretamente com um único splash de startup
persona: Candidato em trânsito
journey: J-open-dashboard-direct
expected: A carga direta conserva o splash de 900 ms e nunca empilha um overlay de transição durante hidratação
entry_points: /
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: tests/e2e/ui.mjs; docs/qa/evidence/20260824T143638469000Z-8c1fe201/CH-direct-startup-canary.webm; docs/qa/evidence/20260824T143638469000Z-8c1fe201/CH-direct-startup-canary-final.png; docs/qa/evidence/2026-08-24T210158000000Z-71293d34-release-1.3.0-full/candidato-transito-direct.png; docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
last_report: docs/qa/reports/2026-08-24T210158000000Z-71293d34-release-1.3.0-full.md
overlaps:
---

Canário adjacente para regressões no renderer inline, hidratação, locale e shell responsivo.

10/09/2026: canária desktop PostgreSQL percorreu abertura direta, reload,
busca e navegação Candidato com back/forward e nova leitura. Sem overlay residual
nas capturas finais da rodada supabase-production. Não mediu os 900 ms nem
repetiu a persona móvel; cenário completo permanece untested.

17/09/2026, pré-varredura em 375×812: a carga direta não empilha overlay de
transição durante a hidratação — a metade de camada única do `expected` se
sustenta pela observação, e a suíte automatizada a afirma em `task-04 E2E-013`.
Os 900 ms continuam sem medição: o driver de jornada não expõe cronometragem, e
"pareceu curto" não é veredito. Enquanto as duas metades viverem no mesmo
`expected`, este cenário não assenta por sessão de persona. Relatório:
docs/qa/reports/2026-09-17T230607949478Z-796f372b-pre-varredura-cenarios-nao-testados.md

Migração PostgreSQL: repetir como canária do novo runtime; os relatos abaixo
registram versões anteriores, não o resultado desta branch.

A URL direta e a recarga chegaram ao mesmo cockpit operável. O Full QA repetiu o percurso em 375×812 pela persona Candidato em trânsito, sem overflow nem camada residual.

Revalidado como canário adjacente no build isolado da Task 03.

Revalidado novamente na Task 04 contra login, recovery, callback e perfil público: carga direta manteve apenas o splash de startup e navegação suave manteve apenas a camada de transição.
