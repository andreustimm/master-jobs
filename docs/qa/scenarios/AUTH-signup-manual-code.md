---
id: AUTH-signup-manual-code
area: AUTH
title: Cadastro com e-mail e senha confirmado pelo código, sem revelar e-mail já cadastrado
persona: Pessoa nova que se cadastra sozinha
journey: J-sign-up-alone
expected: O envio leva a "Confira seu e-mail" com o aviso de 15 minutos; o código certo cria a conta e entra, o errado diz quantas tentativas restam; reenviar só depois de 60 s; e-mail já cadastrado vê a mesma tela e recebe o aviso de conta existente, sem código; Termos e Política abrem sem sessão em português e inglês
entry_points: /signup, /signup/verify, /terms, /privacy
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: AUTH-recovery-same-answer
---

#464, task_03. Local com `JHO_SIGNUP_IP_SECRET` no `.env` e sem Resend (o
código sai no terminal do `pnpm dev`): em `/signup`, escolher Candidato,
colar o currículo, informar e-mail e senha de 12+ caracteres, aceitar os
termos e enviar. Em `/signup/verify`, errar o código uma vez (aparece
"Restam 4 tentativa(s)"), ver o reenvio desabilitado com contagem, e digitar o
código certo: cai no cockpit. Sair e entrar com a senha. Repetir com o e-mail
de uma conta existente: a mesma tela de código, e o terminal mostra o aviso de
conta existente, sem código. Abrir `/terms` e `/privacy` deslogado, nos dois
idiomas.

No Preview (sem Resend), `/signup` avisa que o cadastro com e-mail e senha não
está disponível ali. O E2E `sign-up` cobre o percurso com o sink de e-mail
(E2E-025 a E2E-029) e a área `legal` cobre E2E-031.
