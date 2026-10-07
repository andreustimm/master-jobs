---
id: AUTH-social-sign-in-linked
area: AUTH
title: Entrar com Google ou LinkedIn reconhece a conta e volta ao endereço pedido
persona: Andreus em triagem noturna
journey: J-manage-own-account
expected: Com o provedor configurado, "Continuar com Google" entra na conta já ligada (ou liga sozinho pelo e-mail verificado e manda o aviso), cai na tela do papel ou no deep link pedido, e quem já entrou e abre /login vai direto à sua tela
entry_points: /login, /login/oauth/google, /login/oauth/linkedin
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: AUTH-canonical-transition-boundaries
---

#464, task_02. Local com as credenciais de teste dos dois provedores e
`JHO_SESSION_SECRET` no `.env`: abrir `/jobs/<id>` sem sessão, entrar pelo
Google e conferir que volta à vaga; sair e entrar pelo LinkedIn. Numa conta
criada por admin sem senha, o primeiro login pelo Google de e-mail verificado
liga sozinho e chega o aviso de provedor ligado. Recarregar `/login` já dentro
manda à tela do papel.

O E2E `social-sign-in` cobre o mesmo percurso contra o emissor falso; este
cenário é o do provedor real, que só o dono configura (registro dos apps OAuth
e variáveis na Vercel Production).
