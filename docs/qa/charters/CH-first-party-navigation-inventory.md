# CH-first-party-navigation-inventory: percorrer todas as portas de navegação

```yaml
charter:
  id: CH-first-party-navigation-inventory
  mission: "Como Andreus em triagem, percorrer menus, filtros, links contextuais e ações redirecionadas procurando telas sem feedback ou mutações repetidas."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-switch-workspace-screen
  scenarios: [NAV-first-party-navigation-contract, NAV-switch-screen-ready, AUTH-canonical-transition-boundaries]
  tour: Feature Tour
  time_box_minutes: 60
  guidance:
    must_try:
      - "Percorrer o menu global no desktop e no celular"
      - "Usar filtro GET, paginação, densidade e link contextual de vaga"
      - "Concluir login, recovery, comparação, cadastro de vaga e impersonação uma vez"
      - "Visitar token inválido, sessão expirada, 404 e perfil revogado"
    must_avoid:
      - "Usar estado interno ou banco para decidir o veredito"
      - "Repetir uma mutação para obter a tela esperada"
```
