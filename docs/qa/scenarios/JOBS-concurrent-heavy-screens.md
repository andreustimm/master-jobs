---
id: JOBS-concurrent-heavy-screens
area: JOBS
title: Abrir a mesma tela pesada duas vezes ao mesmo tempo
persona: Andreus em triagem
journey: J-switch-workspace-screen
expected: Duas requisições simultâneas à mesma tela respondem as duas; nenhuma fica esperando até o limite da função
entry_points: /; /jobs; /jobs?pay=6000&payMax=30000&cur=USD&per=month; /searches; /candidate/skills; /searches/tracks/new?term=Laravel
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-21-concurrent-heavy-screens.txt
last_report: docs/qa/reports/2026-09-21-execucao-concorrencia.md
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

**A primeira correção não bastou, e o motivo é o que este cenário existe para
cobrir.** Em 2026-09-21 a revisão profunda mostrou que a régua media **função**,
não tela: as três telas que compunham as leituras no corpo do Server Component
ficavam fora da medição, e eram as maiores — o cockpit `/` pedia sete conexões, e
`/jobs`, que é a tela mais aberta do produto, cinco (seis com faixa salarial).
Teto por leitura não é teto por requisição, e nenhuma das duas telas do quadro
tinha o aviso pré-timeout, então uma recaída não deixaria rastro.

A conferir, em cada tela que faz leitura pesada:

- Duas requisições disparadas juntas respondem as duas, sem uma esperar a outra.
- O tempo da segunda não é o da primeira somado ao dela.
- Vale para **todas as seis entradas** listadas acima. `/` é a rota que a PWA
  abre e onde o candidato cai depois do login; `/jobs` é a mais aberta; a variante
  com faixa salarial é o caminho mais largo, porque três leituras normalizam
  pagamento.
- Navegar pelo menu com prefetch ligado dispara várias rotas de uma vez; nenhuma
  delas pode derrubar a que o leitor realmente abriu.
- Se alguma travar, o Sentry tem de mostrar o aviso pré-timeout nomeando a rota
  — ele agora existe em `/` e em `/jobs` também, e cobre a requisição inteira,
  inclusive a autenticação.
