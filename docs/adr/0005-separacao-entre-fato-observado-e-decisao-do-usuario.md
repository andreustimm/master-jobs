# ADR 0005 — Separação entre fato observado e decisão do usuário

**Status:** Aceita · 2026-08-18

## Contexto

O sistema tem duas naturezas de dado convivendo no mesmo banco:

- **Fatos observados do mundo:** uma vaga existe, tem este título, esta
  descrição, esta faixa salarial. Vêm de uma API e são reconstituíveis —
  basta rodar o sync de novo.
- **Decisões do usuário:** "eu me candidatei a esta vaga em 18/08",
  "esta empresa me rejeitou", "próximo passo é o follow-up na sexta".
  Não vêm de lugar nenhum. Se forem perdidas, estão perdidas.

O modo mais comum de destruir um sistema desses é deixar a ingestão
sobrescrever a segunda categoria — tipicamente com um `DELETE` seguido de
`INSERT` na tabela de vagas, levando junto o histórico por cascade.

## Decisão

Separação estrita em três camadas, com regras diferentes:

| Tabela | Natureza | Quem escreve | Pode ser recriada? |
|---|---|---|---|
| `job`, `company`, `source` | Fato observado | Ingestão | Sim, rodando sync |
| `job_score` | Derivado | Scorer | Sim, sempre |
| `application`, `application_event` | **Decisão do usuário** | Só o usuário/CLI | **Não** |

Disso decorrem três invariantes:

> **Invariante 1:** ingestão nunca escreve em `application`.
> `src/core/ingest/run.ts` toca `job`, `company` e `source`. Nada mais.

> **Invariante 2:** vaga que some da fonte é marcada com `closedAt`,
> nunca deletada. Deletar levaria junto a candidatura por foreign key.

> **Invariante 3:** `job_score` é descartável por construção. Pode ser
> apagada e recomputada a qualquer momento — é por isso que ela é uma tabela
> separada, e não colunas dentro de `job`.

O único ponto que deleta linhas é `pruneClosed()`, e ele é explicitamente
guardado por `job_id not in (select job_id from application)`.

`application_event` é append-only: cada transição de status vira um registro,
o que permite reconstruir o funil histórico e medir conversão por etapa —
métrica que a auditoria de posicionamento pede na seção 14.

## Consequências

**Positivas**

- O sync pode rodar quantas vezes quiser, inclusive concorrentemente, sem
  jamais corromper histórico.
- Dá para apagar `data/jobs.db` e reconstruir tudo — perdendo apenas as
  decisões, que é exatamente o que se quer proteger e é o que justifica
  backup dessa tabela.
- Recalcular scores é seguro por definição.

**Negativas**

- Uma vaga fechada há muito tempo continua no banco se houve candidatura.
  É intencional — é o histórico.
- O join entre `job`, `job_score` e `application` aparece em toda query de
  listagem. Centralizado em `src/core/db/repo.ts` justamente para que CLI e
  futura UI nunca discordem sobre o que "shortlisted" significa.
