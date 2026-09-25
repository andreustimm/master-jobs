# Regras de papéis, modelos e modo de assinatura

Referência normativa de quem faz o quê quando um agente delega trabalho a
outro. Resumo crítico em [AGENTS.md](../../../AGENTS.md); índice em
[README.md](README.md); paridade dos harnesses em
[delivery.md](delivery.md#g85). A política executável mora em
[`config/model-routing.json`](../../../config/model-routing.json) e é
resolvida por `pnpm route`; aqui fica o que obriga, e por quê.

---

<a id="g86"></a>
### G86 — Cinco papéis, e o juiz nunca é o modelo do autor

**Obrigação.** Trabalho delegado segue cinco papéis, cada um com um agente de
mesmo nome nos três harnesses (`.claude/agents/`, espelhados por
[G85](delivery.md#g85)):

| Papel | Agente | Faz | Não faz |
|---|---|---|---|
| Analista | `task-analyst` | lê a issue e o código, classifica a complexidade (low/medium/high), escolhe o plano e os papéis | editar |
| Executor | `executor` | implementa o plano na worktree, com teste e gate | revisar ou julgar o próprio delta |
| Revisor | `reviewer` | relata achados com evidência e severidade | corrigir |
| Corretor | `fixer` | corrige os achados, só eles, com o menor delta | ampliar o escopo |
| Juiz | `judge` | decide SHIP / FIX_BEFORE_SHIP / REWORK sobre delta, plano e revisão | editar; julgar delta do próprio modelo |

Ordem: analista → executor → revisor → corretor (se houver achado) → juiz. O
orquestrador é a sessão principal: ele analisa sozinho quando a tarefa é
`low`, e delega o analista quando há dúvida sobre a complexidade.

**Juiz ≠ autor.** O "autor" é o modelo que escreveu o delta em julgamento — o
do executor, ou o do corretor quando a rodada julga a correção. A matriz sai
de `pnpm route judge <complexidade> --author <modelo>`, que procura primeiro
outro provedor da ladder e depois outro modelo do mesmo provedor:

| Autor do delta | Juiz em `claude_only` | Juiz em `codex_only` | Juiz em `multi_provider` |
|---|---|---|---|
| modelo Anthropic | o primeiro candidato Anthropic ≠ autor | o primeiro candidato OpenAI | o primeiro candidato OpenAI |
| modelo OpenAI | o primeiro candidato Anthropic | o primeiro candidato OpenAI ≠ autor | o primeiro candidato Anthropic |
| modelo OpenCode | o primeiro candidato Anthropic | o primeiro candidato OpenAI | o primeiro candidato Anthropic |

Por isso toda célula de juiz tem pelo menos dois modelos distintos: com um
só, o modo de um provedor não teria saída quando o autor fosse ele.

**Por quê.** O mesmo modelo que escreveu tende a aprovar o que escreveu; a
independência é a única coisa que o juiz acrescenta à revisão. O `deep-review`
([G53](delivery.md#g53)) continua obrigatório antes da PR — o juiz não o
substitui, e `FIX_BEFORE_SHIP` continua exigindo decisão humana
([G54](delivery.md#g54)).

Prova: `tests/model-routing.test.ts` — em cada modo, para cada complexidade e
cada modelo que pode ser autor, o juiz resolvido é outro modelo.

<a id="g87"></a>
### G87 — Modelo e effort explícitos, por papel e complexidade, dentro do modo de assinatura

**Obrigação.**

- Ao delegar, **sempre** passe modelo e effort explícitos, tirados de
  `pnpm route <papel> <complexidade>` — nunca o padrão do harness.
- O agente **nunca rebaixa o modelo do turno principal** por conta própria:
  trocar o modelo da sessão é decisão da pessoa. O roteador escolhe o modelo
  dos subagentes, não o da sessão.
- O **modo de assinatura** é o campo `subscriptionMode` de
  `config/model-routing.json`: `claude_only`, `codex_only` ou
  `multi_provider`. Ele diz quais provedores podem executar, revisar, corrigir
  e julgar. Modo ausente ou desconhecido, papel sem célula, effort que o
  provedor não aceita, provedor de outro harness num modo de um harness só, ou
  juiz sem alternativa **falham fechado**: `pnpm route` sai com erro e sem rota.
- Em `multi_provider`, a ladder é `anthropic → openai → opencode`: vale o
  primeiro provedor com cota. Provedor sem cota sai da ladder com
  `--unavailable <provedor>`; nunca se troca de modo para contornar cota.
- O effort do OpenCode é `null`: os modelos `opencode-go/*` não recebem
  `reasoningEffort` pelo agente, e mandar o parâmetro seria inventar
  capacidade.

**Por harness.** A sessão principal de cada harness é o orquestrador; ela só
delega para agentes do próprio harness, com o modelo que o roteador der para
o provedor daquele harness.

| Sessão | Orquestrador | Delega para | Modelo do subagente |
|---|---|---|---|
| Claude Code | a sessão (modelo escolhido pela pessoa) | `.claude/agents/*` pelo Agent tool | `model` explícito na chamada, do provedor `anthropic` |
| Codex | a sessão (modelo escolhido pela pessoa) | `.codex/agents/*.toml` | `model` e `model_reasoning_effort` do provedor `openai` |
| OpenCode | o agente primário | `.opencode/agents/*` (`mode: subagent`) | `model` do provedor `opencode` |

Juiz de outro provedor (o caso normal em `multi_provider`) não roda dentro da
sessão: a sessão pede ao harness do provedor do juiz, por exemplo
`codex exec` com o modelo dado pelo roteador, ou devolve à pessoa a
instrução exata. Em `claude_only` e `codex_only` tudo roda no próprio harness.

O `model`/`effort` escrito em cada agente é o **padrão de complexidade
`medium`** do provedor daquele harness; o gate de
[G85](delivery.md#g85) confere que ele bate com `config/model-routing.json`.
Complexidade `low` ou `high` passa o modelo explícito na chamada.

**Trocar modelo, effort ou modo.** Edite `config/model-routing.json` (nunca o
agente), rode `pnpm harness:sync` para regenerar os espelhos e atualize o
`model`/`effort` do agente canônico se o padrão `medium` mudou —
`pnpm check:harness` reprova a divergência. ID de modelo novo precisa existir
no provedor: confira no console/CLI dele antes de escrever; não invente ID.

**Fora do escopo.** Registro de métricas, tokens ou custo por execução não
existe neste projeto (decisão do dono em #317 e #318).

Prova: `tests/model-routing.test.ts` (modo inválido falha; cada modo resolve
todos os papéis e complexidades; effort fora da lista reprova) e
`tests/harness-parity.test.ts` (agentes com o modelo da política).
