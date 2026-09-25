## Técnico

### Adicionado

- Roteamento de agentes por papel × complexidade × modo de assinatura (#318): `config/model-routing.json` (modos `claude_only`, `codex_only` e `multi_provider`; política inválida falha fechado), `pnpm route <papel> <complexidade> [--session <harness>] [--author <modelo>]… [--unavailable <provedor,…>]` e as regras G86 (cinco papéis; o juiz nunca é modelo que escreveu o delta) e G87 (modelo e effort pela política; o agente não rebaixa o modelo do turno principal) em `docs/engineering/rules/orchestration.md`.
- O agente canônico em `.claude/agents/` declara `role`, `model` e `effort`; os espelhos do Codex recebem `model` e `model_reasoning_effort` e os do OpenCode, `model`, todos da política; `pnpm check:harness` reprova agente cujo modelo diverge dela.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
