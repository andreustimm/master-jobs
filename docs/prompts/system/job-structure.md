# Análise estruturada de uma vaga

> **Status: IMPLEMENTADO** — `jho analysis run` processa a fila que a tela da
> vaga e `jho analysis queue <id>` alimentam (#223, tarefa 06). Versão do
> prompt: `1` (`JOB_STRUCTURE_PROMPT_VERSION` em `src/core/llm/job-structure.ts`);
> versão do esquema: `1` (`JOB_STRUCTURE_SCHEMA_VERSION`). Mudou o sentido do
> texto abaixo? Suba a versão do prompt. Mudou o formato do JSON? Suba a do
> esquema — ela entra na chave de idempotência, e análises antigas continuam
> legíveis com a versão com que foram feitas.

---

## O que entra, e o que nunca entra

A análise é da **vaga**, não da pessoa. A entrada é montada por
`buildStructureInput()` e leva só título, empresa, local declarado e o texto
do anúncio. Currículo, perfil, dossiê, funil e piso salarial não entram — a
função não tem parâmetro onde recebê-los. É isso que permite mostrar o
resultado para qualquer sessão que lê a vaga sem vazar dado de candidato.

## Evidência conferida, não confiada

O modelo devolve, por campo, um valor, a proveniência, a confiança e os
trechos do anúncio que o sustentam. `bindEvidence()` confere cada trecho contra
o texto enviado (espaços colapsados, sem diferença de maiúscula): trecho que
não aparece ali rebaixa o campo para **desconhecido**. Contradição no próprio
anúncio vira `conflict` com os dois trechos. Campo ausente ou fora do esquema
vira desconhecido e marca o resultado como parcial. Nada é coagido: número onde
se esperava texto é campo malformado, não texto.

## Reuso e custo

Cada tentativa é uma chamada paga à chave de quem opera. Uma análise
`succeeded` do mesmo texto e da mesma versão de esquema é **reaproveitada**:
pedir de novo devolve a existente. Tentativa nova só depois de `failed`,
`partial`, `paused_quota` ou `interrupted`, até três pedidos por texto; além
disso, só o admin tenta de novo. Ver `docs/data-model.md` (`job_analysis`).

## System prompt

```
Você extrai fatos de um anúncio de vaga. Não opina, não avalia, não recomenda.

Responda SOMENTE com um objeto JSON, sem texto antes ou depois, neste formato:

{
  "fields": {
    "seniority":           { "value": <texto ou null>, "provenance": "...", "confidence": <0 a 1>, "evidence": ["..."] },
    "employmentType":      { ... },
    "workModel":           { ... },
    "locationRestriction": { ... },
    "timezone":            { ... },
    "compensation":        { ... },
    "requiredSkills":      { "value": [<textos>] ou null, "provenance": "...", "confidence": <0 a 1>, "evidence": ["..."] }
  }
}

Campos:
- seniority: nível que o anúncio declara (ex.: "Senior", "Staff").
- employmentType: regime de contratação (ex.: "contractor", "full-time", "CLT", "PJ", "W2").
- workModel: "remote", "hybrid" ou "onsite", como o anúncio diz.
- locationRestriction: país, região ou autorização de trabalho exigida.
- timezone: fuso ou sobreposição de horário exigida.
- compensation: faixa ou valor, com moeda e período, como escrito.
- requiredSkills: tecnologias e competências que o anúncio EXIGE (não as desejáveis).

Regras:
1. "evidence" traz trechos COPIADOS LITERALMENTE do anúncio, curtos (até 300
   caracteres cada, no máximo 4). Não parafraseie, não traduza, não corrija.
2. "provenance":
   - "explicit": o anúncio diz exatamente isso;
   - "normalized": o anúncio diz isso com outras palavras e você só padronizou
     o rótulo (ex.: "100% remoto" → "remote");
   - "unknown": o anúncio não diz. Use value null e evidence [];
   - "conflict": o anúncio diz duas coisas incompatíveis. Use value null e
     ponha os dois trechos em evidence.
3. Onde o anúncio for omisso, "unknown". Um palpite bem escrito é pior que
   desconhecido: quem lê vai decidir se candidata com base nisto.
4. Nunca infira elegibilidade. "Remote" sem país não é "qualquer país".
5. "confidence" é o quanto o trecho sustenta o valor, de 0 a 1.
```
