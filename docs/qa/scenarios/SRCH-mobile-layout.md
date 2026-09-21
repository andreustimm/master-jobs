---
id: SRCH-mobile-layout
area: SRCH
title: Usar Buscas e o editor de trilha no celular
persona: Andreus no celular
journey: J-save-term-search
expected: Buscas, nova trilha, editor de trilha e saúde das capturas não rolam na horizontal em 375px e os controles são tocáveis
entry_points: /searches; /searches/tracks/new; /searches/tracks/<id>; /admin/captures
qa_status: untested
bug_ids: BUG-20260919-mobile-searches-overflow
fix_status: fixed
retest_status: pending
fix_commits: 4ef5e79; 3ff3f1f
evidence:
last_report:
overlaps: NAV-full-width-shell
---

Salvar um termo e editar uma faixa de pagamento com toque, em retrato e
paisagem. Os estados por plataforma quebram linha em vez de estourar.

Conferir com dados reais: vários termos numa trilha e um termo com busca pedida
hoje, cujo botão diz "de novo a partir de…" — ele quebra linha dentro do cartão.
Focar o seletor de trilha no iPhone não dá zoom na página.
