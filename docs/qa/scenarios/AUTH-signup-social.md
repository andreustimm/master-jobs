---
id: AUTH-signup-social
area: AUTH
title: Cadastro pelo Google ou LinkedIn cria conta e perfil num envio só
persona: Pessoa nova que se cadastra sozinha
journey: J-sign-up-alone
expected: E-mail verificado sem conta volta do provedor para /signup com o e-mail só para leitura; Candidato com PDF cai no cockpit com o próprio perfil e currículo, Recrutador cai no estado vazio de /recruiter; uma boas-vindas no idioma da tela; quarto cadastro do mesmo IP na hora vê o limite
entry_points: /signup, /login/oauth/google, /login/oauth/linkedin, /recruiter
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: AUTH-social-sign-in-linked
---

#464, task_03. Local com as credenciais de teste dos provedores,
`JHO_SESSION_SECRET` e `JHO_SIGNUP_IP_SECRET` no `.env`: em `/signup`,
"Continuar com Google" com uma conta Google sem cadastro no Master Jobs; na
volta, conferir o e-mail só para leitura e que só Candidato e Recrutador são
oferecidos. Como Candidato, enviar um PDF de currículo e aceitar os termos:
cai no cockpit e `/candidate` mostra o texto extraído. Repetir pelo LinkedIn
como Recrutador: cai na explicação de que quem concede acesso é o candidato.
Em 375 px, a tela e o estado vazio cabem sem rolagem lateral.

O E2E `sign-up` cobre o percurso contra o emissor falso (E2E-011, E2E-014,
E2E-015); este cenário é o do provedor real, que só o dono configura.
