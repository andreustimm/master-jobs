---
id: JOBS-anonymous-employer-never-groups
area: JOBS
title: Vagas de fonte que oculta o empregador não são fundidas numa linha
persona: Andreus em triagem
journey: J-trust-the-filtered-board
expected: Duas vagas de empresas diferentes com o mesmo título, numa fonte anônima, continuam sendo duas linhas — nenhuma fica inalcançável
entry_points: /jobs?source=lever; /jobs
qa_status: pass
bug_ids:
fix_status:
retest_status:
fix_commits:
evidence: docs/qa/evidence/2026-09-21-quadro-com-fixtures-de-agrupamento.txt
last_report: docs/qa/reports/2026-09-21-execucao-concorrencia.md
overlaps: JOBS-group-repeated-countries; JOBS-country-hub
---

Nasce da revisão profunda de 2026-09-21.

A chave do grupo é (ATS, título, empregador). Onde a fonte oculta o empregador —
Jobgether, que é 92% do acervo e anuncia "on behalf of a partner company" — o
nome da empresa gravado é o **rótulo da própria fonte**, e o primeiro elemento é
o ATS (`lever`), não o board. Sobrava o título: **duas vagas de empresas
parceiras diferentes que compartilhassem um título viravam a mesma vaga em dois
países.** A de id maior era escondida do quadro, e o hub apresentava o
empregador de uma como o segundo país da outra.

Não era teórico, e a medição que justificou o recurso não podia separar os dois
casos: "cada publicação do grupo tem uma localização distinta" é verdade tanto
para uma vaga real em 42 países quanto para vagas diferentes de empresas
diferentes em remoto.

A conferir:

- Numa vaga cuja empresa aparece como o nome da fonte (o quadro a marca como
  empregador não nomeado): a linha **não** mostra fileira de bandeiras.
- Duas dessas vagas com o mesmo título continuam sendo duas linhas, e cada uma
  abre a sua.
- O hub de uma delas lista **só ela**.
- O contraste continua funcionando: com empregador nomeado de verdade, a mesma
  forma agrupa normalmente.
- O filtro "empregador nomeado" segue coerente com o que a linha mostra.

## Verificado no ambiente manual em 2026-09-21, depois das fixtures

Com uma vaga cujo `companyName` é o rótulo da fonte (`Grupo QA`):

```
- link "Staff Engineer Anonymous Fixture"
- StaticText "Grupo QA · employer hidden"
- StaticText "Remote · Europe"
```

**Sem `group "posted in N countries"`** — nenhuma fileira de bandeiras, que é o que o
charter exige. O quadro a marca `employer hidden` e a mantém sozinha; a localização
aparece como texto da própria publicação, não como país agrupado.

É o caso em que agrupar seria errado: juntar por nome de empregador quando o nome é
o da fonte colocaria empresas diferentes na mesma linha.

Evidência: `docs/qa/evidence/2026-09-21-quadro-com-fixtures-de-agrupamento.txt`.
