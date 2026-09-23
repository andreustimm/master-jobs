# O contrato de URL da tela Vagas

Todo filtro de `/jobs` vive na URL, nunca em React. Isso é o que torna uma
visão filtrada compartilhável, faz o botão voltar funcionar e deixa a página ser
Server Component. A fonte da verdade é
[`app/filter-state.ts`](../../app/filter-state.ts); esta página existe para
quem precisa montar um link sem ler o código.

Parâmetro inválido **nunca derruba a página**: vira aviso na tela e o filtro é
ignorado.

## Os parâmetros

| Parâmetro | Valor | Ausente significa |
|---|---|---|
| `fit` | 0 a 100 | corte padrão de 45 |
| `fitMax` | 0 a 100 | sem teto de nota |
| `q` | palavra inteira sobre cargo, empresa e descrição | sem busca |
| `company` | trecho do nome do empregador, até 80 caracteres | sem filtro de empresa |
| `source` | **repetido**, uma vez por fonte | todas as fontes |
| `cluster` | nome do cluster | todos |
| `workMode` | `remote`, `hybrid`, `onsite` | todas as modalidades |
| `pay` | piso, 1 a 2.000.000 | sem piso |
| `payMax` | teto, 1 a 2.000.000 | sem teto |
| `cur` | ISO de três letras | a moeda da trilha principal |
| `per` | `month` ou `year` | o período da trilha principal |
| `disclosed` | `1` | mostra também quem não informa salário |
| `notApplied` | `1` | mostra também o que já foi enviado |
| `ungrouped` | `1` | agrupa vagas repetidas por país |
| `unblocked`, `fresh`, `paid`, `named`, `described` | `1` | sem aquele recorte |
| `track` | id da trilha, ou `all` | a trilha principal |
| `by` | id de um termo salvo | qualquer origem |
| `status` | estado do funil, `unfiled` ou `any` | esconde arquivadas |
| `sort` | `fit`, `recent`, `comp` | por aderência |

## As decisões que um leitor precisa saber

**`source` repete, não usa vírgula.** É o que uma lista de checkboxes envia
naturalmente, e por isso `toParams` devolve pares em vez de objeto — um objeto
por nome só consegue guardar a última fonte. Um `source=x` sozinho, o formato
antigo que ainda circula em links salvos, continua valendo como uma fonte.

**A URL carrega a exceção, não a regra.** O agrupamento por país é o padrão,
então o parâmetro é `ungrouped=1`: o link comum fica curto, e um link antigo
sem o parâmetro continua significando o que significava.

**Faixa invertida é trocada, com aviso.** `pay=12000&payMax=6000` vira 6.000 a
12.000 e a tela diz que a troca aconteceu. O slider não produz isso; URL escrita
à mão e campo digitado produzem.

**Campo vazio é escolha, campo ausente é padrão.** `fit=` (vazio) significa
"toda nota" — zero. `fit` ausente mantém o corte de 45. É a diferença entre
"não pedi nada" e "pedi tudo".

**`fit` e `fitMax` só cortam vaga que tem nota.** Vaga ainda sem nota para o
candidato da sessão aparece com qualquer faixa, no fim da ordenação por
aderência; sem nenhuma nota na trilha principal, a tela avisa que o cálculo está
pendente (`scores_pending`). Detalhe em [`../scoring.md`](../scoring.md).

**Os limites são presos, não confiados.** O Score fica entre 0 e 100 na leitura
e na digitação; `fit=abc` já derrubou a página com 500 quando `NaN` chegou ao
PostgreSQL.

**O teto salarial é 2.000.000**, e não os 10.000.000 do editor de trilha. Acima
disso não é salário, e um zero a mais deve ser recusado em vez de esvaziar o
quadro em silêncio. A escala do slider é bem menor — ela é leitura, e estica
para caber o que for digitado.

## A rota do grupo

`/jobs/<id>/paises` reúne as publicações da mesma vaga em países diferentes. A
âncora é **qualquer publicação do grupo**, não um id de grupo: o agrupamento é
de apresentação e não há registro para apontar. O link vale enquanto aquela
publicação estiver aberta e devolve **404** quando ela fecha.

**Todo caminho que pergunta "quais são os outros países" leva aqui.** São dois:
o link do título da linha agrupada e o `+N` da fileira de bandeiras. O `+N`
apontava para `/jobs/<id>`, que é a publicação canônica — o menor id do grupo, e
portanto o mesmo destino da primeira bandeira: clicar em "+34" abria a vaga na
Holanda, que é o "país que ninguém pediu" que esta rota existiu para remover. A
tela de detalhe não lista país nenhum, então ela nunca é a resposta dessa
pergunta. Fixado em `UT-093`.

## Quem entra num grupo, e qual publicação representa ele

Duas regras, as duas com prova em `tests/cov-db-repo.test.ts`, porque as duas
erraram uma vez e as duas escondiam vaga aberta:

**Empregador anônimo não agrupa.** A chave é (ATS, título, empregador), e onde a
fonte oculta o empregador — Jobgether, 92% do acervo — `company_name` é o rótulo
da própria fonte, e o primeiro elemento é o ATS (`lever`), não o board. Sobrava
o título: duas vagas de empresas parceiras DIFERENTES com o mesmo título viravam
a mesma vaga em dois países, a de id maior saía do quadro, e o hub apresentava o
empregador de uma como o segundo país da outra. Publicação de empregador anônimo
é, por definição, o próprio grupo.

**A publicação que representa o grupo é escolhida entre as que passam pelos
filtros.** Era a de menor id entre todas as abertas, decidida por um anti-join
que não conhecia `minFit`, `hideBlocked`, `term` nem `freshDays` — esses moram no
`where` de fora. Quando a de menor id falhava um filtro, todas as irmãs falhavam
o teste de canônica e **o grupo inteiro desaparecia**, mesmo com uma irmã
casando tudo; e como a contagem compartilha o predicado, o rodapé concordava com
a lista e nada parecia errado. Hoje é `row_number()` sobre o conjunto já
filtrado, então filtro novo entra sem precisar ser repetido na escolha.

## Exemplos

```
/jobs?fit=60&fitMax=80                       nota entre 60 e 80
/jobs?pay=8000&payMax=15000&cur=USD&per=month  8k a 15k por mês em dólar
/jobs?source=lever&source=ashby              duas fontes
/jobs?company=Shopify                        só o empregador, não quem o cita
/jobs?notApplied=1                           esconde o que já foi enviado
/jobs?ungrouped=1                            uma linha por publicação
```
