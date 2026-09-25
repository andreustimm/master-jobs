# Regras de papéis, modelos e modo de assinatura

Referência normativa de quem faz o quê quando um agente delega trabalho a
outro. Resumo crítico em [AGENTS.md](../../../AGENTS.md); índice em
[README.md](README.md); paridade dos harnesses em
[delivery.md](delivery.md#g85). A política executável mora em
[`config/model-routing.json`](../../../config/model-routing.json) e é
resolvida por `pnpm route`; aqui fica o que obriga, e por quê.

---

<a id="g86"></a>
### G86 — Cinco papéis, e o juiz nunca é modelo que escreveu o delta

**Obrigação.** Trabalho delegado segue cinco papéis, cada um com um agente de
mesmo nome nos três harnesses (`.claude/agents/`, espelhados por
[G85](delivery.md#g85)). O `id` é o que `pnpm route` e o campo `role:` do
agente aceitam.

| Papel | `id` | Agente | Faz | Não faz |
|---|---|---|---|---|
| Analista | `analyst` | `task-analyst` | lê a issue e o código, classifica a complexidade (low/medium/high), escolhe o plano e os papéis | editar |
| Executor | `executor` | `executor` | implementa o plano na worktree, com teste e gate, e commita | revisar ou julgar o próprio delta |
| Revisor | `reviewer` | `reviewer` | relata achados com evidência e severidade | corrigir |
| Corretor | `fixer` | `fixer` | corrige os achados, só eles, com o menor delta | ampliar o escopo |
| Juiz | `judge` | `judge` | decide SHIP / FIX_BEFORE_SHIP / REWORK sobre delta, plano e revisão | editar; julgar delta que o próprio modelo escreveu |

`fit-analyst` usa o papel `analyst` só para escolher modelo; ele analisa vaga,
não tarefa, e fica fora deste fluxo.

Ordem: analista → executor → revisor → corretor (se houver achado) → juiz. O
orquestrador é a sessão principal: ele analisa sozinho quando a tarefa é
`low`, e delega o analista quando há dúvida sobre a complexidade.

**Juiz ≠ autor.** Os "autores" são **todos** os modelos que escreveram o delta
em julgamento: o do executor e o de cada corretor. O juiz sai de
`pnpm route judge <complexidade> --author <modelo> [--author <modelo>…]`, que
procura primeiro um provedor que não seja de nenhum autor, na ordem da ladder,
e só depois outro modelo dentro do provedor de um autor. Resultado por modo:

| Autores | `claude_only` | `codex_only` | `multi_provider` |
|---|---|---|---|
| só Anthropic | candidato Anthropic que não é autor | primeiro candidato OpenAI | primeiro candidato OpenAI |
| só OpenAI | primeiro candidato Anthropic | candidato OpenAI que não é autor | primeiro candidato Anthropic |
| Anthropic e OpenAI | candidato Anthropic que não é autor | candidato OpenAI que não é autor | primeiro candidato OpenCode |
| só OpenCode | primeiro candidato Anthropic | primeiro candidato OpenAI | primeiro candidato Anthropic |

Em modo de um provedor só, a célula "primeiro candidato" de outro provedor só
acontece quando o delta veio de fora do modo (ex.: escrito à mão em outro
harness). Toda célula de
juiz tem pelo menos dois modelos distintos e um candidato que nunca é
executor nem corretor do provedor: assim o modo de um provedor sempre tem
juiz, mesmo quando executor e corretor foram modelos diferentes.

**Por quê.** O mesmo modelo que escreveu tende a aprovar o que escreveu; a
independência é a única coisa que o juiz acrescenta à revisão. O `deep-review`
([G53](delivery.md#g53)) continua obrigatório antes da PR — o juiz não o
substitui, e `FIX_BEFORE_SHIP` continua exigindo decisão humana
([G54](delivery.md#g54)).

Prova: `tests/model-routing.test.ts` — em cada modo, para cada complexidade e
cada par de modelos que pode escrever um delta, o juiz resolvido não é nenhum
deles.

<a id="g87"></a>
### G87 — Modelo e effort pela política, dentro do modo de assinatura

**Obrigação.**

- Ao delegar, tire o modelo de
  `pnpm route <papel> <complexidade> --session <claude|codex|opencode>` e
  passe-o explicitamente na chamada — nunca deixe o subagente herdar o modelo
  da sessão. O campo `agentModel` da rota é o valor exato do campo de modelo
  da chamada no harness da sessão (no Claude Code, o apelido do Agent tool:
  `opus`, `sonnet`, `haiku`, `fable`); `effort` é o esforço pedido.
- O agente **nunca rebaixa o modelo do turno principal** por conta própria:
  trocar o modelo da sessão é decisão da pessoa. O roteador escolhe o modelo
  dos subagentes, não o da sessão.
- O **modo de assinatura** é o campo `subscriptionMode` de
  `config/model-routing.json`: `claude_only`, `codex_only` ou
  `multi_provider`. Ele diz quais provedores podem executar, revisar, corrigir
  e julgar. A política inteira é validada antes de qualquer rota: modo
  ausente ou desconhecido, papel sem célula, effort que o provedor não aceita,
  modelo do Claude Code sem apelido, provedor de outro harness num modo de um
  harness só ou juiz sem alternativa **falham fechado** — `pnpm route` sai com
  erro e sem rota.
- Em `multi_provider`, a ladder é `anthropic → openai → opencode`: executor,
  analista, revisor e corretor usam o primeiro provedor da ladder com cota e
  do harness da sessão; o juiz usa o primeiro provedor que não seja de nenhum
  autor (G86). Provedor sem cota sai da ladder com
  `--unavailable <provedor>` (nome desconhecido reprova); nunca se troca de
  modo para contornar cota.
- O effort do OpenCode é `null`: os modelos `opencode-go/*` não recebem
  `reasoningEffort` pelo agente, e mandar o parâmetro seria inventar
  capacidade.

**Por harness.** A sessão principal de cada harness é o orquestrador; ela só
delega executor, analista, revisor e corretor a agentes do próprio harness
(`--session`), com o modelo do provedor daquele harness.

| Sessão | Orquestrador | Delega para | Na chamada |
|---|---|---|---|
| Claude Code | a sessão (modelo escolhido pela pessoa) | `.claude/agents/*` pelo Agent tool | `model: <agentModel>` (apelido); o Agent tool não recebe effort — vale o `effort` do frontmatter do agente |
| Codex | a sessão (modelo escolhido pela pessoa) | `.codex/agents/*.toml` | `model` e `model_reasoning_effort` da rota |
| OpenCode | o agente primário | `.opencode/agents/*` (`mode: subagent`) | `model` da rota |

Juiz de outro provedor (o caso normal em `multi_provider`) não roda dentro da
sessão: a sessão pede ao harness do provedor do juiz — por exemplo
`codex exec` com o modelo da rota — ou devolve à pessoa a instrução exata. Em
`claude_only` e `codex_only` tudo roda no próprio harness.

O `model`/`effort` escrito em cada agente é o padrão da complexidade `medium`
do provedor daquele harness; o gate de [G85](delivery.md#g85) confere que ele
bate com `config/model-routing.json`. Em `low` e `high`, o modelo da rota vai
na chamada como em qualquer complexidade.

**Limite conhecido.** No Claude Code o effort por chamada não existe: uma
tarefa `low` ou `high` roda com o effort do frontmatter do agente (o de
`medium`). O modelo da rota continua explícito na chamada.

**Trocar modelo, effort ou modo.** Edite `config/model-routing.json` (nunca o
espelho): o modo em `subscriptionMode`; modelo e effort na célula
`providers.<provedor>.roles.<papel>.<complexidade>`; modelo novo do Claude
Code também em `agentAliases`. Depois rode `pnpm harness:sync` e, se o padrão
`medium` de um papel mudou, atualize `model`/`effort` do agente canônico —
`pnpm check:harness` reprova a divergência. ID de modelo novo precisa existir
no provedor: confira no console/CLI dele antes de escrever; não invente ID.

**Fora do escopo.** Registro de métricas, tokens ou custo por execução não
existe neste projeto (decisão do dono em #317 e #318).

Prova: `tests/model-routing.test.ts` (modo inválido falha; cada modo resolve
todos os papéis e complexidades; sessão restringe a ladder; effort ou apelido
fora da lista reprova) e `tests/harness-parity.test.ts` (agentes com o modelo
da política).
