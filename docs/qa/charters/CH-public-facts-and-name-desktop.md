# CH-public-facts-and-name-desktop: fatos opt-in e nome de exibição do perfil público

```yaml
charter:
  id: CH-public-facts-and-name-desktop
  mission: "Como Andreus em triagem, criar uma conta candidata pela CLI (jho auth add-user, sem nome), confirmar que /candidate convida a escrever um nome e que /p/<endereço> não mostra o e-mail em nenhum campo (retest da BUG-20260922-public-profile-shows-email-as-name), depois ligar cada fato opt-in (modelo de trabalho, disponibilidade, nível, área, idiomas, prazo, aceita mudar) um a um e confirmar que só o que está ligado aparece em /p/<endereço> para o visitante anônimo, em desktop e em inglês."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-choose-public-address
  scenarios: [PUB-edit-public-facts, PUB-public-facts-opt-in, PUB-edit-public-name, PUB-public-name-never-email]
  tour: Configuration Tour
  time_box_minutes: 45
  guidance:
    must_try:
      - "Ligar e desligar cada fato individualmente, recarregando /p/<endereço> entre cada mudança."
      - "Tentar telefone e e-mail como se fossem Área ou Idiomas, e confirmar a recusa."
      - "Escrever o nome em /candidate depois de a conta nascer sem nome, e confirmar o título de /p/<endereço> antes e depois."
      - "Repetir a leitura de /p/<endereço> em inglês (troca pelo controle de idioma da interface, não por cookie)."
    must_avoid:
      - "Usar a conta real do dono (cujo nome vem do profile.yaml) para o cenário de conta sem nome."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
