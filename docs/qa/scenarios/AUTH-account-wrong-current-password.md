---
id: AUTH-account-wrong-current-password
area: AUTH
title: Senha atual errada não troca nada e o limite de tentativas vale
persona: Operador somente por teclado
journey: J-manage-own-account
expected: Senha atual errada mostra alerta sem trocar a senha; depois de cinco tentativas em quinze minutos nem a senha certa troca, e a mensagem pede para esperar
entry_points: /account
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: evidence/2026-09-22-rc-1.22.0/s2-carla-rate-limited.png
last_report: docs/qa/reports/2026-09-22-release-candidate-1.22.0-full.md
overlaps:
---

Errar a senha atual cinco vezes pelo teclado e conferir o alerta anunciado.
Na sexta, com a senha certa, a tela avisa do limite. A senha antiga continua
entrando no login.

Full 1.22.0 (2026-09-22): Cinco senhas atuais erradas pelo teclado dão 'Senha atual incorreta.'; a sexta, certa, recebe 'Tentativas demais. Espere 15 minutos'; a senha antiga continua entrando. Paper cut: depois do envio o foco volta ao body.
