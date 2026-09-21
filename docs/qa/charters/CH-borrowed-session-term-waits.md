# CH-borrowed-session-term-waits: na sessão emprestada, o termo espera a varredura e nenhuma plataforma é chamada

```yaml
charter:
  id: CH-borrowed-session-term-waits
  mission: "Assumir a identidade de um candidato e salvar um termo por ele, com uma aba do admin aberta ao lado — a tela precisa dizer que o termo espera a varredura, e nada pode buscar na hora."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-save-term-search
  scenarios: [SRCH-borrowed-session-waits-sweep]
  tour: Multi-Tab Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Em /admin/users, assumir a identidade de um candidato e abrir /searches."
      - "Salvar um termo e ler o estado de cada plataforma."
      - "Numa segunda aba, abrir /admin/captures e conferir que a sessão emprestada é recusada ali."
      - "Encerrar a identidade emprestada e recarregar a aba de Buscas."
    must_avoid:
      - "Ações de administração em bloco durante a sessão emprestada — são recusadas por desenho e não são o alvo."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
