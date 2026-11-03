---
id: AUTH-account-sign-in-methods
area: AUTH
title: A conta mostra e controla as formas de entrar, sem nunca ficar sem porta
persona: Andreus em triagem noturna
journey: J-manage-own-account
expected: Em Minha conta, "Formas de entrar" mostra senha e provedores com datas, origem e termos aceitos; conectar o Google pelo provedor liga e chega o aviso por e-mail; desligar com senha some e avisa que entrar de novo religa; conta só social não desliga o último provedor e define a primeira senha; o admin vê os provedores em /admin/users e desliga, e a dona vê que sumiu
entry_points: /account, /admin/users, /login/oauth/google?intent=link, jho auth methods, jho auth unlink
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: AUTH-social-sign-in-linked
---

#464, task_04. Local com as credenciais de teste dos provedores e
`JHO_SESSION_SECRET` no `.env`: entrar com senha, abrir `/account`, conectar o
Google e conferir a linha "Ligado em … · Último uso: nunca" depois de
recarregar; desligar e ler o aviso de religação. Numa conta só com LinkedIn,
"Desligar LinkedIn" recusa com "Defina uma senha ou conecte outro provedor";
definir a primeira senha e entrar com ela noutra janela. Como admin, em
`/admin/users`, desligar o Google de outra conta e conferir na conta dela.
`jho auth methods <email>` e `jho auth unlink <email> google` repetem o mesmo
pela CLI.

O E2E `account-methods` cobre o percurso contra o emissor falso; este cenário
é o do provedor real e do e-mail real (Resend), que só o dono configura.
