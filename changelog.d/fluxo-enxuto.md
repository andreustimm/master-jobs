## Técnico

### Alterado

- Fluxo de entrega enxuto (#319): validação local com `typecheck` e `vitest related`, PR draft logo após o primeiro verde e suíte completa no CI; orçamento de tempo por gate (check 10 min, E2E 8, deep-review L1 10, L2 30).
- `deep-review` em três níveis por caminho do diff: L0 (só Markdown) dispensa, L1 é passada única sem polish nem subagentes, L2 (auth, `/p/`, schema, promoção/deploy, scorer, segredos) segue completo. `review_level.py` classifica, `build_jobs.py --level L1` recusa diff L2 e o nível não cai entre rodadas; rodada 2+ só delta, teto de 3.
- G53, G54, G57 e G84 emendadas: só Critical/Major bloqueiam, um revisor por diff; R24 ganha o tamanho S/M/L da tarefa.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
