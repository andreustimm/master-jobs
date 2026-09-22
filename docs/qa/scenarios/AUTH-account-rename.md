---
id: AUTH-account-rename
area: AUTH
title: Trocar o nome de exibição muda o topo sem novo login
persona: Andreus no celular
journey: J-manage-own-account
expected: Em 375px o nome salvo aparece confirmado, sobrevive a refresh e o e-mail aparece só para leitura com a orientação de pedir a troca a um admin
entry_points: /account
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: NAV-full-width-shell
---

Em 375×812, abrir Minha conta pelo menu, trocar o nome e salvar. Recarregar e
conferir o nome no campo e no topo (largura maior). Nenhum controle estoura a
largura da tela.
