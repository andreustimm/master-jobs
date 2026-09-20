---
id: JOBS-concurrent-heavy-screens
area: JOBS
title: Abrir a mesma tela pesada duas vezes ao mesmo tempo
persona: Andreus em triagem
journey: J-switch-workspace-screen
expected: Duas requisições simultâneas à mesma tela respondem as duas; nenhuma fica esperando até o limite da função
entry_points: /candidate/skills; /searches/tracks/new?term=Laravel; /searches
qa_status: untested
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence:
last_report:
overlaps: JOBS-pay-filter
---

Nasce de um defeito real de produção, em 2026-09-20. `/candidate/skills`
respondia **200 quando pedida sozinha** e **504 quando pedida duas vezes**. Os
logs da Vercel trazem o par cru: um 200, e 266ms depois um 504 na mesma rota.

A causa: o cliente do banco abre **três** conexões, e o caminho da tela pedia
exatamente três num `Promise.all`. Uma requisição sozinha cabe. Mas a instância
serverless é reaproveitada entre requisições concorrentes, então duas na mesma
instância pedem seis conexões de um pool de três, cada uma espera a outra, e a
Vercel mata as duas aos trinta segundos.

**Por que isto virou cenário:** toda a suíte automatizada — 2.660 testes de
unidade e 272 verificações de browser — pede uma requisição por vez. O defeito
só existe com duas, então nenhum teste podia vê-lo. A régua que deveria pegar,
`tests/db-fan-out.test.ts`, estava calibrada em `<= POOL` contra um pool de
`POOL`, aprovando justamente o caminho que o esgota.

A conferir, em cada tela que faz leitura pesada:

- Duas requisições disparadas juntas respondem as duas, sem uma esperar a outra.
- O tempo da segunda não é o da primeira somado ao dela.
- Vale para `/candidate/skills`, para a criação de trilha por termo e para
  `/searches`, que eram os três caminhos que pediam o pool inteiro.
- Navegar pelo menu com prefetch ligado dispara várias rotas de uma vez; nenhuma
  delas pode derrubar a que o leitor realmente abriu.
