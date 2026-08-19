# Fluxo — a semana do candidato

Como as peças se compõem no uso real. As caixas azuis são decisões humanas; o
sistema prepara, o humano decide.

```mermaid
flowchart TD
  subgraph diario["Diário — 15 min"]
    sync[jho jobs sync] --> board[dashboard<br/>preset 'Aplicáveis hoje']
    board --> triagem{vale?}
    triagem -->|sim| short[track shortlisted]
    triagem -->|não| skip[ignora]
  end

  subgraph semanal["Semanal — 1h"]
    fx[jho fx refresh] --> verify[jho jobs verify<br/>fecha os 404]
    verify --> mail[jho mail import<br/>alertas + e-mails de ATS]
    mail --> sug{sugestões<br/>de funil}
    sug --> ref[jho referrals<br/>onde já conhece alguém]
    ref --> rep[jho report + dossiers<br/>snapshot no vault]
  end

  subgraph candidatura["Ao aplicar"]
    short --> gap[jho cv gap<br/>que palavras faltam]
    gap --> prep[adapta o topo do CV<br/>ao cluster da vaga]
    prep --> apply[track applied --channel]
  end

  subgraph posicionamento["Posicionamento — contínuo"]
    tasks[jho tasks list<br/>plano da auditoria] --> engage[jho engage next<br/>2 comentários/dia útil]
    engage --> posts[jho posts<br/>1 original/semana]
    posts --> metrics[jho metrics record<br/>SSI, buscas, visitas]
  end

  apply --> mail
  metrics --> tasks

  style triagem fill:#eef,stroke:#024ad8
  style sug fill:#eef,stroke:#024ad8
  style prep fill:#eef,stroke:#024ad8
```

## O que a auditoria de posicionamento pede, mapeado

| Recomendação (§14) | Comando |
|---|---|
| 5–8 candidaturas/semana, segmentadas por cluster | `jobs list --cluster` + `track --channel` |
| 2 comentários substantivos por dia útil | `engage next` |
| 1 post original por semana | `posts add` |
| Medir o funil semanalmente | `metrics record` + `metrics trend` |
| Mapear 30 contas-alvo | `contacts add -k recruiter\|ai-leader\|peer` |

## O laço que fecha

`apply → mail` não é decorativo. Depois de aplicar, os e-mails de ATS voltam
como evidência: confirmação, triagem, entrevista ou rejeição. É isso que
transforma o funil de memória em dado — e o que permite responder **em qual
estágio** o processo quebra, que é uma pergunta diferente de "não fechou".
