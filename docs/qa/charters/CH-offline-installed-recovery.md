# CH-offline-installed-recovery: recuperar sem expor estado anterior

```yaml
charter:
  id: CH-offline-installed-recovery
  mission: "Como Candidato após falha, perder e recuperar a rede numa aplicação instalada procurando sucesso falso, dado anterior e tentativas que não consultem o servidor."
  mode: charter-with-tour
  persona:
    name: Candidato após falha
    device: laptop
    network: flaky
    locale: pt-BR
  journey: J-recover-offline-access
  scenarios: [PWA-installed-offline-recovery, PWA-offline-private-absence, PWA-offline-no-cache-degradation]
  tour: Interrupt Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Interromper uma troca de tela e tentar novamente após reconectar"
      - "Recarregar destinos diferentes mais de uma vez sem rede"
      - "Abrir sem shell instalado e com armazenamento recusado"
      - "Procurar conteúdo da sessão anterior no resultado persistido"
    must_avoid:
      - "Usar logout como requisito para limpar conteúdo privado"
```
