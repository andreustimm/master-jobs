# Extração de skills

Rotina que lê um documento do candidato e produz **candidatos a skill**, com
evidência e justificativa, para auditoria humana.

Vive em `src/contexts/skills/` — o primeiro módulo escrito na estrutura de
destino da [ADR 0007](../adr/0007-arquitetura-hexagonal-monolito-modular.md),
conforme o `MIGRATION.md` manda para código novo.

## Estrutura

```
src/contexts/skills/
  domain/          puro — sem banco, sem rede, sem relógio
    types.ts       SkillDefinition, Mention, Detection, ExtractionStrategy
    text.ts        limites de palavra e mapa de seções
    strategies.ts  alias, declared, applied
    extractor.ts   compõe as estratégias e calcula confiança
  ports.ts         SkillCatalogPort, CandidateSkillPort
  app/
    extract-skills.ts   caso de uso — orquestra, não decide
  infra/
    drizzle-adapters.ts o único arquivo que sabe que SQL existe
  index.ts         composição: uma função, nenhuma porta exposta
```

> **Invariante:** `domain/` não importa nada de `infra/` nem de `core/db`. É o
> que torna o extrator testável sem banco — e é onde estão os 19 testes.

## As três estratégias

Separadas porque **onde** uma skill aparece muda o que ela significa:

| Estratégia | Peso | O que reporta |
|---|---:|---|
| `alias` | 1.0 | Toda menção, em qualquer lugar |
| `declared` | 0.8 | Só dentro de uma lista de tecnologias — é uma *afirmação* |
| `applied` | 1.3 | Só em bullet que descreve trabalho feito — é uma *demonstração* |

Uma tecnologia listada em "Key Technologies" é uma alegação de capacidade. A
mesma palavra dentro de *"Built X using Y"* é evidência mais forte: mostra a
coisa sendo usada. Uma menção solta no resumo é o sinal mais fraco dos três.

Adicionar uma estratégia — um passe por LLM, um parser de formato específico,
um leitor de perfil do LinkedIn — é acrescentar um arquivo e registrá-lo. Não é
reescrever o pipeline. É por isso que existe a interface.

## Confiança

Três sinais, na ordem em que merecem crédito:

```
base                          0.35   menção existe, é evidência fraca
+ usada em bullet             0.40   demonstração
+ listada em tecnologias      0.15   afirmação deliberada
+ repetição (saturante)     ≤ 0.15   log2 — a décima menção diz pouco
```

Tudo abaixo de 0.55 sai marcado como "apenas menção solta — verifique o
contexto". No CV real, 48 das 77 detecções passaram de 0.75.

A justificativa é gerada em português e guardada junto da evidência, porque
**ninguém audita um número que não consegue interrogar**.

## O que a rotina não faz

> **Invariante:** a extração produz `detected`. Nunca `confirmed`. O sistema
> afirma que *encontrou* uma skill; só um humano afirma que o candidato *tem*
> uma. É a regra 6 do `CLAUDE.md` expressa no schema — um detector que lê
> "migrating away from Kafka" e deixa um agente citar experiência em Kafka é
> exatamente a falha que essa separação impede.

E re-executar nunca desfaz auditoria: linhas já `confirmed` ou `rejected` são
preservadas; só as `detected` têm evidência e contagem atualizadas.

## Uso

```ts
import { skillExtraction } from "./contexts/skills/index.ts";

const result = await skillExtraction({
  candidateId,
  text: cvContent,
  source: "cv",
});
// result.detections — com confiança, evidência e rationale
// result.added / refreshed / preserved
```

Para testar sem banco, use o extrator puro direto:

```ts
import { extractSkills } from "./contexts/skills/domain/extractor.ts";
const detections = extractSkills(texto, catalogo, { minConfidence: 0.7 });
```

Pela CLI: `jho skills seed`, `jho skills detect`, `jho skills list`,
`jho skills confirm|reject <id>`, `jho skills demand`.

## Por que aliases são o coração disso

O CV do Andreus **nunca escreve "observability"** — escreve *"Integrated
monitoring… using Datadog, Rollbar"*. E 51% das vagas do alvo pedem
"observability". Sem alias, a skill some; com alias, ela aparece e o gap fica
visível: a experiência existe, o vocabulário é que não.
