---
name: job-triage
description: Triagem diária de vagas — roda o sync, revisa o topo do ranking, separa o que vale aplicar e move as escolhidas para o funil. Use quando o usuário pedir para buscar vagas novas, revisar matches, fazer a varredura do dia, ou perguntar "tem vaga nova?". NÃO use para adaptar currículo (use application-kit) nem para editar o perfil (use candidate-profile).
---

# Triagem de vagas

## Quem decide

A decisão sobre a vaga é do usuário; `application` é o único dado
irrecuperável do sistema (regra 2,
[rules/data-and-sourcing.md](../../../docs/engineering/rules/data-and-sourcing.md#g02)).

- O **sync** só mexe em `job`. Rodar `jobs sync` nunca autoriza `track`.
- O agente **propõe** o veredito de cada vaga. Registra com `jho track` só o
  que o usuário decidiu — seja respondendo à proposta, seja por pedido
  explícito que já delegue a decisão ("marque como shortlisted as que passarem
  nos bloqueios"). Sem essa autorização, a saída é a tabela de sugestões.
- `applied` registra uma candidatura que **o usuário** enviou. Nada aqui envia
  candidatura (regra 13).

## Rotina

```bash
pnpm jho jobs sync                    # busca todas as fontes + pontua
pnpm jho jobs list --min-fit 55       # revisa o topo
pnpm jho jobs show <id>               # aprofunda uma vaga
pnpm jho track <id> shortlisted -n "motivo"   # só com decisão do usuário
```

## Como triar de verdade

O ranking é um ponto de partida, não um veredito. Para cada vaga no topo:

1. **Blockers primeiro.** `jho jobs show` lista bloqueios detectados. Se há
   exigência de autorização de trabalho nos EUA, presença física ou W2,
   descarte e siga — não gaste análise.
2. **Leia o motivo do score.** O array `reasons` explica cada componente.
   Um fit alto puxado só por `geo` e `comp`, com `title` baixo, costuma ser
   falso positivo.
3. **Verifique o cluster.** Se o cluster for `senior_ic` numa vaga que o
   usuário quer como `architect`, isso é sinal de que o título é abaixo do
   alvo — a auditoria §1.2 alerta exatamente sobre esse vazamento.
4. **Cheque a empresa.** Ela contrata contractor internacional? Se a
   informação existir, registre em `company.hiresContractors` /
   `hiresLatam` — evita reanalisar a mesma empresa toda semana.
5. **Feche cada vaga com um veredito.** Toda vaga analisada sai da triagem
   com uma proposta (aplicar / talvez / descartar) e, quando o usuário
   decidir, com um status registrado. Vaga sem status volta na próxima
   varredura e desperdiça atenção.

## Estados do funil

| Status | Significado |
|---|---|
| `backlog` | Vista, ainda não decidida |
| `shortlisted` | Vale aplicar, ainda não preparada |
| `preparing` | Currículo/carta em preparação |
| `applied` | Candidatura enviada |
| `screening` | Triagem de RH em andamento |
| `interviewing` | Entrevistas em andamento |
| `offer` | Proposta recebida |
| `rejected` / `withdrawn` / `archived` | Encerrada |

## Sinais de que o scorer precisa de ajuste

- Vaga claramente boa pontuando baixo → falta keyword em `profile.yaml`.
- Lixo recorrente no topo → falta termo em `keywords.negative` ou em
  `targets.avoid_titles`.
- Muito falso positivo geográfico → o padrão de bloqueio não está pegando a
  redação usada; ajuste `blockers:`.

Depois de qualquer ajuste no perfil: **suba `SCORER_VERSION`** em
`src/core/scoring/score.ts` e rode `pnpm jho jobs score --all` (regra 6,
[rules/matching-and-evidence.md](../../../docs/engineering/rules/matching-and-evidence.md#g08)).

## Cadência recomendada

A auditoria §14 (próximos 60 dias) recomenda **5–8 candidaturas por semana**,
segmentadas por cluster, adaptando o topo do currículo a cada uma. Volume sem
segmentação é o que não vinha funcionando.
