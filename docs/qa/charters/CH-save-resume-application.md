# CH-save-resume-application: retomar uma candidatura sem perder a decisão

```yaml
charter:
  id: CH-save-resume-application
  mission: "Como Andreus em triagem noturna, registrar uma decisão e retomá-la após navegação e novo login sem perder status ou nota."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem noturna
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-preserve-application-decision
  scenarios: [PIPE-save-resume-decision]
  tour: Back-Button Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Entrar pelo login real, abrir uma vaga sintética e salvar status e nota identificáveis"
      - "Voltar, abrir o funil e recarregar antes de considerar a gravação confirmada"
      - "Sair, entrar novamente e confrontar a decisão com a leitura pública da CLI da mesma identidade"
      - "Abandonar uma edição sem salvar e verificar que a decisão confirmada permanece"
    must_avoid:
      - "Consultar SQL, mocks ou endpoints internos para atribuir Pass"
      - "Enviar candidatura externa ou alterar dados reais de produção"
```
