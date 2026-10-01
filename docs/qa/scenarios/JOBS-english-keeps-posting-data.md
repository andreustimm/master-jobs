---
id: JOBS-english-keeps-posting-data
area: JOBS
title: Interface em inglês mantém o texto do anúncio como ele veio
persona: Recrutadora convidada
journey: J-trust-the-filtered-board
expected: Com a interface em inglês, a localização e o nome da vaga continuam como o anúncio escreveu — inclusive com acento — e nada da interface aparece em português
entry_points: /jobs; /jobs/<id>; /jobs/<id>/paises
qa_status: pass
bug_ids: BUG-20260921-job-detail-labels-untranslated; BUG-20260929-jobs-list-english-ui-shows-portuguese; BUG-20260929-jobs-row-title-missing-user-content-mark
fix_status: fixed
retest_status: pass
fix_commits: 23fa064; 52ba067; d433dcf5
evidence: docs/qa/reports/2026-09-21-execucao-ingles-detalhe.md; tests/e2e/ui/i18n.mjs
last_report: docs/qa/reports/2026-09-29T143300Z-d433dcf-vagas-idioma-395.md
overlaps: JOBS-country-hub; JOBS-group-repeated-countries
---

Nasce de um defeito achado por uma guarda nova, no primeiro uso dela.

A verificação de vazamento de português reprova por dois critérios: texto que **é**
valor do dicionário português, e texto com acento. Dado do anúncio fica de fora
por `data-user-content` — o currículo tem "São Paulo" e continua tendo em inglês.

A localização da vaga **não tinha a marca**, em dois lugares: na linha da lista
quando a vaga não é agrupada, e no popover de detalhe, que está no DOM mesmo
fechado e portanto aparece em toda tela com lista. Nenhuma das rotas varridas
tinha fixture com acento na localização, então os dois passaram desde que
existem. Bastou `/jobs/<id>/paises` entrar na varredura para os dois caírem.

A conferir, com a interface em inglês:

- A localização de uma vaga com acento — "São Paulo, State of São Paulo, Brazil" —
  aparece **como veio**, sem tradução e sem ser sinalizada.
- O mesmo dentro do popover da vaga, que a varredura enxerga mesmo fechado.
- Nada da INTERFACE aparece em português: rótulo, botão, aviso, cabeçalho.
- No hub dos países, o mesmo vale para o título, o empregador e a localização de
  cada publicação.
- O contraste que dá sentido à regra: se alguém traduzir mal um rótulo, a
  verificação tem de reprovar — a isenção é para dado do usuário, não para
  esconder tradução faltando.

## O terceiro lugar, achado em 2026-09-21

A primeira execução deste cenário acrescentou `/jobs/<id>` aos pontos de entrada,
porque a jornada passa por lá: quem filtra o quadro clica numa vaga. E a tela de
detalhe tinha as duas metades do problema ao mesmo tempo — três textos de
interface como literal no JSX (`← vagas`, `Ver vaga na origem`, `visto em`,
servidos em português com a interface em inglês) e o dado do anúncio sem
`data-user-content` no nome da empresa, na localização e no rótulo da fonte.

Sem a marca, a rota não podia entrar na varredura (o acento legítimo do acervo
reprovaria); fora da varredura, ninguém mediria a tela. E mesmo dentro dela, a
varredura só reprova texto acentuado ou já presente no dicionário — `Ver vaga na
origem` passaria. A varredura é rede; a defesa é a regra 9. `docs/qa/bugs/BUG-20260921-job-detail-labels-untranslated.md` tem a
medição.

O que este cenário passou a exigir, por isso:

- Todo ponto de entrada da jornada entra na verificação — inclusive o que só se
  alcança clicando, não digitando a URL.
- Ausência de acento na tela **não** é prova de nada: a rota precisa de fixture
  com localização acentuada, senão a verificação passa por não ter o que medir.
- A recíproca também: rota em que o dado do usuário não está marcado só pode
  entrar depois da marca, e pular esse passo troca um defeito por um falso
  positivo permanente.

## O quarto lugar, achado em 2026-09-29

QA full do release candidate 1.29 achou a mesma classe de defeito numa
terceira tela: a lista de vagas (`/jobs`), fora do detalhe já corrigido.
Com a interface em inglês, `aria-label="Fechar"` no modal de publicação e a
paginação "51–100 de 5.273" continuam em português
(`BUG-20260929-jobs-list-english-ui-shows-portuguese`). O título da linha
também não tem `data-user-content`
(`BUG-20260929-jobs-row-title-missing-user-content-mark`) — ainda sem falso
positivo porque nenhum título de teste tem acento, mas é a mesma lacuna
estrutural que já fez a tela de detalhe passar despercebida. `qa_status`
volta de `pass` para `fail`: o cenário promete que nada da interface aparece
em português, e a lista quebra essa promessa.

## O quinto lugar, revalidado em 2026-09-29/30 (#395, PR #408)

A correção (commit d433dcf5) trocou `aria-label="Fechar"` por `t("common.close")`,
passou `locale` para `Pagination` (que usa `t("grid.of")` em vez de " de "
literal) e marcou o título da linha com `data-user-content="true"`. Revisão
L1 da PR achou um quarto literal fora do dicionário na mesma classe — o mapa
`{ month: "mês", ... }` dentro de `formatMoney` (`src/core/money.ts`) — e a
correção subsequente moveu as palavras para `jobs.moneyPeriod*` em `pt-BR.ts`
e `en.ts`, com `app/joblist.tsx` passando os rótulos.

Reteste por browser (QA dirigido, `docs/qa/reports/2026-09-29T143300Z-d433dcf-vagas-idioma-395.md`):
interface em inglês mostrou `Close` no modal e `1–6 of 6`/`PER PAGE` na
paginação, sobrevivendo à recarga; trocando para pt-BR pelo seletor, o rodapé
voltou a `1–6 de 6`/`POR PÁGINA`; os seis títulos mantiveram o texto original
com a marca de dado do usuário confirmada por leitura independente do DOM. A
fixture manual não tinha vaga com salário — esse caso ficou só na automação.

`node tests/e2e/run-isolated.mjs --areas i18n` (sessão 2026-09-30, build de
produção, PostgreSQL descartável): as 15 verificações da área passaram,
incluindo `lista de vagas em inglês mantém a rota e os nomes acessíveis`,
`lista de vagas em inglês usa números e texto de paginação traduzidos` e
`lista de vagas em pt-BR localiza o período do salário` (o caso do quarto
literal, em `/jobs?...&cur=BRL&per=month`). `qa_status: pass`.
