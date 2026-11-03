---
id: AUTH-recruiter-invite-accept
area: AUTH
title: A recrutadora convidada cria a conta pelo link e cai no candidato; outro e-mail não ganha acesso
persona: Recrutadora convidada
journey: J-accept-recruiter-invite
expected: O link sem sessão nomeia quem convidou e mostra o endereço mascarado; "Criar conta de recrutador" abre /signup com Recrutador marcado e "Convidado por", mesmo depois do Google; cadastro com o e-mail convidado cai em /recruiter/<id>, a candidata vê "Ativo" e "Convite aceito" e chega o e-mail de acesso; cadastro pelo link com outro e-mail cai em /recruiter com o aviso de descompasso e sem o candidato; link cancelado, vencido, reenviado ou inventado mostra a mesma página neutra; com sessão de outra conta, a página só diz "Este convite é para <mascarado>. Saia para continuar."; 375 px sem rolagem lateral
entry_points: /signup/invite, /signup, /login, /recruiter, /recruiter/[id], /account
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: AUTH-recruiter-access-grant-revoke, AUTH-signup-social, AUTH-signup-manual-code
---

#465, task_03. Duas janelas: a candidata em `/account` e uma janela anônima
para quem foi convidado. A candidata convida um endereço sem conta; abrir o
link do e-mail na janela anônima e conferir o nome e o endereço mascarado.
"Criar conta de recrutador", conferir Recrutador marcado e a linha "Convidado
por"; cadastrar-se pelo Google (ou com código) com o mesmo endereço e conferir
a chegada na página do candidato; recarregar. Na janela da candidata,
recarregar `/account` e conferir "Ativo" e o histórico.

Repetir com outro endereço pelo link de um segundo convite: a conta nasce, mas
`/recruiter` avisa o descompasso e não lista o candidato; o convite segue
pendente na lista da candidata. Cancelar um terceiro convite e abrir o link:
a mesma página de um token inventado. Logada como outra conta de recrutador,
abrir um link válido: só o aviso com o endereço mascarado, sem o nome da
candidata nem botão. Em 375 px, cada estado cabe sem rolagem lateral.

O E2E `recruiter-invite` cobre o percurso contra o emissor falso e o sink de
e-mail (E2E-010 – E2E-015); este cenário é o do e-mail e do provedor reais.
