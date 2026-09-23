---
id: SRCH-mobile-layout
area: SRCH
title: Usar Buscas e o editor de trilha no celular
persona: Andreus no celular
journey: J-save-term-search
expected: Buscas, nova trilha, editor de trilha e saúde das capturas não rolam na horizontal em 375px e os controles são tocáveis
entry_points: /searches; /searches/tracks/new; /searches/tracks/<id>; /admin/captures
qa_status: blocked-verify
bug_ids: BUG-20260919-mobile-searches-overflow
fix_status: fixed
retest_status: pending
fix_commits: 4ef5e79; 3ff3f1f; 5e6d6aa
evidence: evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-searches-one-hand-retest-1-termo-longo.png; evidence/2026-09-21T175034729239Z-e901131e-qa-buscas/CH-searches-one-hand-retest-1-vagas-chip-320.png
last_report: docs/qa/reports/2026-09-21T175034729239Z-e901131e-qa-buscas.md
overlaps: NAV-full-width-shell
---

Salvar um termo e editar uma faixa de pagamento com toque, em retrato e
paisagem. Os estados por plataforma quebram linha em vez de estourar.

Conferir com dados reais: vários termos numa trilha e um termo com busca pedida
hoje, cujo botão diz "de novo a partir de…" — ele quebra linha dentro do cartão.
Focar o seletor de trilha no iPhone não dá zoom na página.

Full 1.22.0 (2026-09-22): três termos salvos (um de 44 caracteres) e uma segunda trilha; /searches, /searches/tracks/1, /searches/tracks/2, /searches/tracks/new e /admin/captures sem rolagem horizontal em 375 px. O link "0 novas · ver vagas" tem 19 px de altura (abaixo dos 24 px do WCAG 2.5.8). Toque real, nome de trilha longo e zoom do iPhone seguem sem prova: continua blocked-verify.
