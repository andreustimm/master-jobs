---
id: AUTH-social-sign-in-refusals
area: AUTH
title: Recusas do login social voltam ao login com mensagem neutra e nada criado
persona: Candidato após falha
journey: J-manage-own-account
expected: Cancelar no consentimento, provedor fora do ar, retorno repetido, conta ligada a outra identidade, conta desabilitada e e-mail não verificado voltam a /login com a mensagem de cada caso, sem sessão, sem conta e sem vínculo novos; fora de produção e local os botões não aparecem
entry_points: /login, /login/oauth/google/callback, /login/oauth/linkedin/callback
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: AUTH-social-sign-in-linked
---

#464, task_02. No provedor real: cancelar a tela de consentimento do Google
("Login cancelado."); reabrir a URL de retorno antiga ("Esta tentativa de login
expirou"); entrar com LinkedIn cujo e-mail não está verificado (orientação para
ligar pela conta, idêntica com e sem conta para o endereço). Num Preview, a tela
de login fica como sempre, sem botões, e `/login/oauth/google` responde "não
disponível aqui".

O E2E `social-sign-in` prova os mesmos casos contra o emissor falso.
