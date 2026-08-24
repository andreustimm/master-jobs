# CH-direct-startup-canary: proteger a abertura conhecida

```yaml
charter:
  id: CH-direct-startup-canary
  mission: "Como Andreus em triagem, abrir e recarregar o produto procurando splash duplicado, mudança visual e shell indisponível."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-open-dashboard-direct
  scenarios: [PWA-direct-load-startup-singleton]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Abrir pela URL raiz e recarregar"
      - "Comparar startup com a primeira navegação interna"
      - "Confirmar que a tela aceita interação depois da hidratação"
    must_avoid:
      - "Medir o startup pela duração do splash de transição"
```
