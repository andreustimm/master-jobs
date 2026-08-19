# Fluxo — pontuação de uma vaga

`scoreJob(input, profile, fx)` — puro, sem rede, sem banco.

```mermaid
flowchart TD
  input([vaga + perfil + tabela de câmbio]) --> title

  subgraph componentes["cinco componentes, somam 100"]
    title[["title · 35<br/>casamento com clusters-alvo"]]
    kw[["keyword · 30<br/>curva saturante em 35%"]]
    geo[["geo · 15<br/>LATAM > worldwide > remoto"]]
    sen[["seniority · 12<br/>anos exigidos"]]
    comp[["comp · 8<br/>moeda + período"]]
  end

  title --> avoid{título em<br/>avoid_titles?}
  avoid -->|sim| zero[title = 0<br/>cluster = other]
  avoid -->|não| match[exato → 1.0<br/>contém → 0.9<br/>todas as palavras → 0.75<br/>quase todas → 0.45]

  comp --> cur{tem moeda?}
  cur -->|não| neutro[metade do peso<br/>'não comparável']
  cur -->|sim| per{período<br/>reconhecido?}
  per -->|não| neutro
  per -->|sim| proj{é projeto?}
  proj -->|sim, sem duração| neutro2[0.4 do peso<br/>'sem duração']
  proj -->|não| faixa{faixa para<br/>essa moeda?}
  faixa -->|exata| grade[compara direto]
  faixa -->|outro período| annual[anualiza e compara]
  faixa -->|nenhuma| conv{tem câmbio?}
  conv -->|sim| convert[converte para a<br/>moeda de referência]
  conv -->|não| neutro3[metade do peso<br/>'sem cotação']

  match --> soma
  kw --> soma
  geo --> soma
  sen --> soma
  grade --> soma
  annual --> soma
  convert --> soma
  neutro --> soma
  neutro2 --> soma
  neutro3 --> soma
  zero --> soma

  soma[soma dos componentes] --> blk[blockers × 12<br/>+ 5 se houver termo off-axis]
  blk --> fit[["fit = clamp(soma − penalidade, 0, 100)"]]
  fit --> out([fit + reasons + blockers<br/>+ matched/missing keywords])

  style zero fill:#fee,stroke:#b3262b
  style fit fill:#eef,stroke:#024ad8
```

## Por que blockers limitam em vez de zerar

Uma vaga excelente que diz "US preferred" ainda merece ser vista — só não no
topo. Cada bloqueio custa 12 pontos. Zerar esconderia oportunidades onde a
restrição é negociável, e a única pessoa capaz de julgar isso é o candidato.

## Por que a curva de keywords satura

A pontuação satura ao atingir 35% do peso alcançável. Sem isso, descrições
longas venceriam por serem verbosas, não por serem aderentes — e agregadores
publicam descrições muito mais longas que boards de empresa.

## Por que recusar comparar é uma resposta

Quando não há moeda, período reconhecível ou cotação, o componente devolve
metade do peso e uma razão legível — não zero. Zero significaria "paga mal";
metade significa "não sei", que é a verdade.
