---
id: NAV-same-screen-soft-transition
area: NAV
title: Refinar a lista de Vagas sem perder a tela de vista
persona: Andreus em triagem
journey: J-switch-workspace-screen
expected: Filtro, ordem, página e densidade atualizam a lista sem o splash de tela cheia; a lista esmaece, continua clicável e o último clique vence
entry_points: /jobs; /jobs?fit=60&unblocked=1&named=1; /jobs?size=200&page=2
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: NAV-first-party-navigation-contract; NAV-switch-screen-ready; NAV-slow-screen-truthful; JOBS-filter-fields-follow-url
---

Cobertura: issue #220, transição suave na mesma tela.

Percorrer em desktop e em 375 px, nos temas HP, Huly e Graphy, claro e escuro:

1. Em Vagas, aplicar um filtro, trocar a densidade, o tamanho da página, a
   página e um preset. Nenhum splash de tela cheia aparece. A lista esmaece
   quando a resposta demora mais que um instante, e o cabeçalho continua nítido.
2. Durante a espera, clicar em outro filtro: a tela vai para o último pedido,
   sem voltar ao anterior e sem shell preso em `aria-busy`.
3. Com leitor de tela, ouvir "Atualizando esta tela" (em inglês, "Updating this
   screen") uma vez por atualização.
4. Com a rede lenta no devtools (acima de 3 s), confirmar que a espera vira o
   splash com a mensagem de demora. Offline, confirmar a tela de falta de
   conexão com "Tentar novamente".
5. Trocar para Pipeline ou abrir uma vaga: o splash de troca de tela continua.
6. Recarregar depois de cada passo: a URL mantém o filtro e a lista bate com ela.
