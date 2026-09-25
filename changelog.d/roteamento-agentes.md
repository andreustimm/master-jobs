## Técnico

### Adicionado

- Roteamento de agentes por papel × complexidade × modo de assinatura (#318): `config/model-routing.json` (modos `claude_only`, `codex_only` e `multi_provider`, que falham fechado), `pnpm route <papel> <complexidade> [--author <modelo>] [--unavailable <provedor>]` e as regras G86 (cinco papéis; o juiz nunca é o modelo do autor) e G87 (modelo e effort explícitos; o agente não rebaixa o modelo do turno principal) em `docs/engineering/rules/orchestration.md`.
- Agentes dos três harnesses passam a declarar papel, modelo e effort; `pnpm check:harness` reprova agente cujo modelo diverge da política.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
