---
id: AUTH-account-rename
area: AUTH
title: Trocar o nome de exibição muda o topo sem novo login
persona: Andreus no celular
journey: J-manage-own-account
expected: Em 375px o nome salvo aparece confirmado, sobrevive a refresh, aparece no topo em largura maior e o e-mail aparece só para leitura com a orientação de pedir a troca a um admin
entry_points: /account
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s2-daniel-rename-375.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps: NAV-full-width-shell
---

Em 375×812, abrir Minha conta pelo menu, trocar o nome e salvar. Recarregar e
conferir o nome no campo e no topo (largura maior). Nenhum controle estoura a
largura da tela.

Full 1.22.0 (2026-09-22): Nome salvo em 375 px, sobrevive ao reload e aparece no topo em 1280; nome em branco recusado sem apagar o anterior.
