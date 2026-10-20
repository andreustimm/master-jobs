## Técnico

### Alterado

- Promoção para `staging` (#536): "CI de dev ausente" (agendamento) e "Migração exige confirmação humana" (agendamento e evento de CI) deixam de reprovar o job `preparar` e terminam em `skip=true` com `::warning::` e o motivo — e, na migração, o dispatch a fazer — no resumo do run; eram 36 dos 39 vermelhos de 14 dias e escondiam o vermelho novo. É a mesma recusa (sem `validar`, sem escrita, G51 intacta): só muda a cor. Dispatch, evento de CI cujo run a API não encontra, CI em andamento ou reprovado no agendamento e erro de API seguem vermelhos. Todo skip passa a escrever também o resumo do run.
- CI: os artefatos `blob-*` das fatias de teste guardam por 2 dias, não 7; um re-run depois disso refaz todas as fatias.
- Coordenador do GitHub Project: `tasks-project.yml` sem `schedule` `*/10` enquanto `TASKS_WRITER_ENABLED` não existir — a condição do job já o pulava, mas cada agendamento criava um run `skipped` (1.255 em 14 dias). O bloco para religar está comentado no workflow.

## pt-BR

<!-- sem-nota-usuario -->

## en

<!-- sem-nota-usuario -->
