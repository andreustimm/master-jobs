---
id: NAV-same-screen-soft-transition
area: NAV
title: Refinar a lista de Vagas sem perder a tela de vista
persona: Andreus em triagem
journey: J-switch-workspace-screen
expected: Filtro, ordem, página e densidade atualizam a lista sem o splash de tela cheia; a lista esmaece, continua clicável e o último clique vence
entry_points: /jobs; /jobs?fit=60&unblocked=1&named=1; /jobs?size=200&page=2
qa_status: pass
bug_ids: BUG-20260929-pwa-filter-overlay-blocks-same-screen
fix_status: fixed
retest_status: pass
fix_commits: bc6d7e5
evidence: evidence/2026-09-22-rc-1.22.0/s4-workmode-remote-375.png
last_report: docs/qa/reports/2026-09-29T144400Z-filtros-394.md
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
4. Com a rede lenta no devtools (acima de 3 s), alternar Não triadas, Com salário
   e Recém-publicadas: a tela continua operável, sem splash opaco, e a região
   de status anuncia a demora. Offline, confirmar a tela de falta de conexão
   com "Tentar novamente".
5. Trocar para Pipeline ou abrir uma vaga: o splash de troca de tela continua.
6. Recarregar depois de cada passo: a URL mantém o filtro e a lista bate com ela.

Full 1.22.0 (2026-09-22): Modalidade, ordem, densidade, tamanho, preset, voltar e avançar em /jobs a 375 px: nenhum overlay nem inert; aria-busy e data-navigation=soft; main esmaece para ~0,8; 'Updating this screen' anunciado; pronto em ~460 ms. Clique rápido Remote→On-site terminou em On-site.

Reteste #394: docs/qa/reports/2026-09-29T144400Z-filtros-394.md. Percurso público em 375px; espera real de 4,2s coberta pelo E2E isolado em ambos os viewports.
