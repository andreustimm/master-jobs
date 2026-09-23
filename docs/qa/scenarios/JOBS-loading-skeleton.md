---
id: JOBS-loading-skeleton
area: JOBS
title: Ver o esboço de Vagas enquanto a lista carrega
persona: Andreus no celular
journey: J-switch-workspace-screen
expected: Ao entrar em Vagas vindo de outra tela, o título e um esboço da lista aparecem na hora e anunciam a espera; mudar filtro, ordem ou página mantém a lista anterior até a nova chegar; a lista final respeita os filtros da URL
entry_points: /jobs; /jobs?fit=45; /jobs/<id>
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: NAV-switch-screen-ready; NAV-same-screen-soft-transition; JOBS-filter-fields-follow-url
---

Cobertura: fronteira `app/jobs/(lista)/loading.tsx` (issue #217) e seções em
streaming no detalhe da vaga.

Percorrer em 375 px e em desktop, nos três temas claro e escuro, com rede
lenta simulada pelo devtools:

1. Do Cockpit, abrir Vagas pelo menu: o splash sai quando o esboço aparece; o
   esboço tem o título "Vagas", nenhum dado de vaga e nenhum estouro lateral.
2. Aplicar um filtro, trocar a ordem e a página: o esboço **não** volta; a
   lista anterior fica esmaecida até a nova chegar, a URL já traz o filtro e a
   lista final bate com o total do rodapé. Recarregar mantém tudo.
3. Com leitor de tela, confirmar o anúncio "Carregando as vagas…" (ou "Loading
   jobs…" em inglês) uma vez, e `aria-busy` só durante a espera.
4. Abrir uma vaga com candidatura e mais de uma trilha: cabeçalho e formulário
   do funil aparecem antes; nota por trilha e histórico chegam em seguida, com
   o aviso "Carregando esta seção…" durante a espera.
5. Abrir `/jobs/999999999`: continua 404 canônico, sem esboço.
6. Sair da conta e entrar com outra: o esboço nunca mostra dado da sessão
   anterior.
