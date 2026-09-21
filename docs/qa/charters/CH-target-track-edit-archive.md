# CH-target-track-edit-archive: criar, editar, promover e arquivar uma trilha sem perder o que foi escrito

```yaml
charter:
  id: CH-target-track-edit-archive
  mission: "Criar uma trilha a partir da sugestão, editá-la, torná-la principal e arquivá-la, voltando no histórico a cada passo — o formulário não pode perder campo nem prometer experiência que o currículo não tem."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-manage-target-tracks
  scenarios: [SRCH-track-create-edit, SRCH-track-primary-archive, SRCH-track-without-evidence]
  tour: Back-Button Tour
  time_box_minutes: 60
  guidance:
    must_try:
      - "Abrir /searches/tracks/new?term=laravel e conferir o que a sugestão preenche."
      - "Salvar, recarregar e conferir títulos, palavras, senioridade e faixas."
      - "Voltar no histórico a partir do editor salvo e da trilha arquivada."
      - "Arquivar a trilha e conferir o seletor de Vagas; restaurar e conferir os termos dela."
    must_avoid:
      - "Arquivar a única trilha principal da conta sem outra para promover — fica para charter própria se a tela permitir."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
