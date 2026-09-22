---
id: AUTH-account-wrong-current-password
area: AUTH
title: Senha atual errada não troca nada e o limite de tentativas vale
persona: Operador somente por teclado
journey: J-manage-own-account
expected: Senha atual errada mostra alerta sem trocar a senha; depois de cinco tentativas em quinze minutos nem a senha certa troca, e a mensagem pede para esperar
entry_points: /account
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps:
---

Errar a senha atual cinco vezes pelo teclado e conferir o alerta anunciado.
Na sexta, com a senha certa, a tela avisa do limite. A senha antiga continua
entrando no login.
