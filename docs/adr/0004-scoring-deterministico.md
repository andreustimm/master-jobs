# ADR 0004 — Scoring determinístico em vez de LLM

**Status:** Aceita · 2026-08-18

## Contexto

O sistema precisa ranquear milhares de vagas contra um perfil. O reflexo
natural em 2026 é mandar cada vaga para um LLM e pedir uma nota de aderência.

Três problemas com isso nesta posição do pipeline:

1. **Escala e custo.** O primeiro sync trouxe 4.824 vagas. Uma chamada de LLM
   por vaga, a cada sync, é caro e lento — e o sync roda todo dia.
2. **Reprodutibilidade.** Um LLM dá notas diferentes para a mesma vaga em
   execuções diferentes. Isso torna impossível testar o ranqueador, e
   impossível saber se uma mudança no perfil melhorou ou piorou o resultado.
3. **Auditabilidade.** A pergunta que importa não é "qual a nota" — é
   "**por que** essa vaga está em primeiro lugar". Um número vindo de um LLM
   não responde isso de forma verificável.

## Decisão

Scoring **determinístico**, em `src/core/scoring/score.ts`, com cinco
componentes que somam 100 antes das penalidades:

| Componente | Peso | O que mede |
|---|---:|---|
| `title` | 35 | Aderência do cargo aos clusters-alvo |
| `keyword` | 30 | Densidade de termos do perfil, com curva saturante |
| `seniority` | 12 | Anos exigidos vs. senioridade real |
| `geo` | 15 | Elegibilidade a partir do Brasil |
| `comp` | 8 | Faixa salarial vs. piso e alvo |

Toda vaga pontuada guarda um array `reasons` legível e um array `blockers`.
`jho jobs show <id>` imprime o breakdown completo — cada componente, cada
keyword casada, cada keyword ausente de alto valor.

Duas escolhas de projeto valem registro:

**Curva saturante nas keywords.** A pontuação satura ao atingir 35% do peso
possível. Sem isso, descrições de vaga longas venceriam por serem verbosas,
não por serem aderentes.

**Blockers limitam, não zeram.** Uma vaga excelente que diz "US preferred"
ainda merece ser vista — só não no topo. Cada blocker custa 12 pontos, em vez
de eliminar a vaga.

`SCORER_VERSION` versiona a lógica. Mudou peso ou fórmula, sobe a versão, e
`jho jobs score` sabe o que precisa recalcular.

## Consequências

**Positivas**

- Roda sobre milhares de vagas em segundos, custo zero.
- Testável com testes de regressão comuns.
- Totalmente explicável — o usuário lê `reasons` e entende o ranking.
- Ajustável sem prompt engineering: editar `profile.yaml` muda o resultado
  de forma previsível.

**Negativas**

- Não entende nuance semântica. Uma vaga que descreve exatamente o trabalho
  do usuário sem usar nenhuma das palavras do perfil pontua baixo.
- Exige manutenção do vocabulário em `profile.yaml` conforme o mercado muda.
- Casamento por palavra é literal — sinônimos precisam ser listados.

## Alternativas consideradas

**LLM pontuando tudo.** Rejeitado pelos três motivos acima.

**Embeddings + similaridade de cosseno.** Considerado. Resolveria parte da
nuance semântica, mas perde a auditabilidade (por que 0,82?) e ainda exigiria
regras determinísticas por cima para os blockers geográficos, que são a
restrição mais dura do usuário. Continua sendo um bom candidato para reforçar
o componente de keywords no futuro.

## Evolução planejada

A saída natural é **híbrida**: o scorer determinístico filtra os milhares
para as dezenas, e só então um LLM re-ranqueia o topo e escreve a análise
qualitativa. Isso preserva custo, reprodutibilidade e auditabilidade onde
importa, e usa o LLM onde ele é de fato melhor. Ver `docs/roadmap.md`, fase 2.
