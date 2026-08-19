# Fluxo — o funil de candidaturas

A máquina de estados de `application`, e quem pode movê-la.

```mermaid
stateDiagram-v2
  [*] --> backlog: vaga entra no acervo

  backlog --> shortlisted: vale aplicar
  backlog --> archived: descartada na triagem

  shortlisted --> preparing: montando CV e carta
  shortlisted --> archived: reavaliada

  preparing --> applied: enviada

  applied --> screening: RH respondeu
  applied --> rejected: recusa
  applied --> archived: ghosting (10–14 dias)

  screening --> interviewing: avançou
  screening --> rejected

  interviewing --> offer: proposta
  interviewing --> rejected

  offer --> [*]: aceita
  offer --> withdrawn: recusada

  rejected --> [*]
  withdrawn --> [*]
  archived --> [*]
```

## Quem escreve aqui

```mermaid
flowchart LR
  cli[CLI<br/>jho track] --> sas
  ui[Dashboard<br/>formulário] --> sas
  mail[E-mail<br/>após aceite humano] --> sas
  sas[["setApplicationStatus()<br/>único caminho de escrita"]] --> app[(application)]
  sas --> ev[(application_event<br/>append-only)]

  sync[jobs sync] -.->|nunca| app
  imp[jobs import] -.->|nunca| app
  ver[jobs verify] -.->|nunca| app

  style sas fill:#eef,stroke:#024ad8,stroke-width:2px
  style app fill:#efe,stroke:#0e7c63
```

> **Invariante:** existe **um** caminho de escrita. As três interfaces passam
> por `setApplicationStatus`, então uma mudança feita no navegador é
> indistinguível de uma feita no terminal em `application_event`. Ingestão de
> qualquer tipo — sync, import, verify, e-mail — nunca toca esta tabela.

`application_event` é append-only de propósito: é o que permite reconstruir a
conversão por etapa, que é a métrica que a auditoria pede na §14 e a única
forma de responder "onde meu funil vaza".

## Por que `archived` e não deletar

Uma candidatura encerrada continua sendo histórico. E vagas que somem da fonte
recebem `closedAt` em vez de `DELETE`, justamente porque a foreign key levaria
a candidatura junto.
