# Regras de matching e score

Referência normativa do score. Resumo crítico em
[AGENTS.md](../../../AGENTS.md); índice e procedimento de conflito em
[README.md](README.md). Fórmula, pesos e componentes vigentes estão em
[scoring.md](../../scoring.md) e no código (`src/core/scoring/score.ts`).

A regra de evidência profissional — só citar `evidence:`, nunca `growth:` — é de
segurança/reputação e mora em [security.md](security.md#g09). Ela vale também
para qualquer explicação de score que fale pela pessoa.

---

<a id="g08"></a>
## G08 — Mexeu no scorer ou no perfil? Bump `SCORER_VERSION` e rescore (regra 6)

**Obrigação.** Mudança semântica em `src/core/scoring/` ou em `profile.yaml`
exige bump de `SCORER_VERSION` (em `src/core/scoring/score.ts`) e depois
`pnpm jho jobs score --all`. Sem o bump, duas gerações de score convivem na
mesma coluna sem sinal visível.

**Versão atual.** Leia no código; não copie o número para documentos (resolve
C09: a entrada comum chegou a dizer `1.3.0` com o código em outra versão).

**O `profile_hash` não dispensa o bump.** O hash do perfil efetivo invalida a
avaliação da trilha quando o perfil muda, mas não marca geração de scorer; a
regra de bump continua valendo para mudança do scorer e do perfil.

Origem: regra 6. Detalhes: [scoring.md](../../scoring.md),
[data-model.md](../../data-model.md) ("Scores são derivados e versionados").
Prova: `SCORER_VERSION` persistido em `job_score`; o gate que compara diff e
bump é trabalho de [#204](https://github.com/andreustimm/master-jobs/issues/204)
— até lá, a obrigação é de revisão.

<a id="g10"></a>
## G10 — Dado faltante pontua neutro, nunca punitivo (regra 8)

**Obrigação.** Vaga sem data de publicação não é vaga velha; vaga sem descrição
não é vaga sem benefício. Punir ausência rebaixa a fonte pela qualidade da API
dela, não pela qualidade do emprego. `freshness` sem data vale 0,5; `benefits`
em texto curto vale 0,5 e **nunca** gera bloqueador.

**Limite.** Neutralidade é para dado **ausente**. Dado presente e negativo
(restrição geográfica declarada, por exemplo) continua pontuando como negativo.

Origem: regra 8. Prova: `tests/freshness.test.ts`,
`tests/cov-score-degenerado.test.ts`.

<a id="g11"></a>
## G11 — O score é rubrica ponderada, não similaridade

**Obrigação.** Sete componentes com teto fixo, casamento léxico por borda de
palavra, curva saturante na keyword e decaimento exponencial no frescor —
nenhum embedding, nenhum vetor, nenhum LLM no caminho do score.

**Por quê.** Sem autorização de trabalho nos EUA, "W2 on-site em Austin" é
**eliminatório**, e cosseno diria 0,91 de similaridade porque o texto de fato se
parece. Similaridade não distingue "combina" de "é possível". Bloqueador
**capa** a nota (penalidade), não a zera; a vaga continua visível e auditável
por `jho jobs show <id>`.

**LLM fica fora do score.** Leitura qualitativa (`jho analyze`) é opcional,
BYOK, pede confirmação antes de enviar e não altera a nota.

Origem: AGENTS (invariante "O score é rubrica ponderada"). Detalhes:
[scoring.md](../../scoring.md), [ADR 0004](../../adr/0004-scoring-deterministico.md).
Prova: `tests/scoring.test.ts`, `tests/track-scoring.test.ts`.
