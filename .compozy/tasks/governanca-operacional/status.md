# Evidências de governança operacional

Solicitação de 22/09/2026: verificar SLA/SLO e aplicar métricas adequadas ao Master Jobs.
Faz parte do goal ativo de performance/operações, na tarefa TAREFAS.
Este arquivo guarda evidência técnica local; o estado de execução e entrega
pertence à issue canônica no Project 3. O registro de continuidade desta demanda,
iniciada antes da regra 24, aguarda coordenação; este arquivo não concede claim.

- Worktree: `.claude/worktrees/metricas-governanca`, branch `ci/metricas-governanca`, base `origin/dev`.
- Escopo: SLOs internos, orçamento de erros, incidentes, DORA e coleta reproduzível sem serviço novo.
- Não há SLA contratual. Metas começam como provisórias; não inventar histórico.
- Monitor precisa chegar a main pelo gate humano antes de ser chamado de ativo.
- RULES e GITHUB PROJECT são tarefas independentes; preservar suas worktrees.
- Primeira revisão: `FIX_BEFORE_SHIP`, com dois defeitos no coletor. Correções
  deduplicam deployments entre páginas e recusam reiniciar uma série no retry
  do primeiro run. Testes do CLI passam a cobrir restauração e persistência.
- Segunda revisão (base `origin/dev` 178d016): `SHIP`, sem Critical/Major. Dos
  Minor, foram corrigidos a grade de slots (alinhada ao minuto do cron), o
  stderr do `unzip` fora do log e três pontos da documentação (bloqueio por
  causa desconhecida, recuperação sobre cópia, primeira execução sem artefato).
  O travamento após falha do primeiro run fica documentado como recusa deliberada.
- Base local atualizada para 7457fce, preservando as alterações e a revisão anterior.
- A coleta manual aparece fora do denominador dos SLOs. A janela ainda não existe; taxas de falha/retrabalho permanecem sem dados até cobertura real do ledger.
- Sem mudança visível no produto; não exige sessão de QA de interface. O comando
  real foi validado com três GETs públicos, sem sessão; a nova regressão do CLI
  usa transporte controlado e arquivos temporários, sem acessar produção.
