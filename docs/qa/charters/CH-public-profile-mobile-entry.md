# CH-public-profile-mobile-entry: não revelar cadastro por link inválido

```yaml
charter:
  id: CH-public-profile-mobile-entry
  mission: "Como Visitante do perfil público, abrir em tela móvel um link ausente ou revogado e confirmar que o produto responde 404 sem revelar cadastro."
  mode: charter-with-tour
  persona:
    name: Visitante do perfil público
    device: phone-large
    network: 4g
    locale: en-US
  journey: J-open-public-profile
  scenarios: [PUB-public-profile-mobile-entry]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Abrir um slug ausente ou não publicado em uma sessão sem cookies"
      - "Recarregar e confirmar o mesmo 404 sem identidade, login ou dado privado"
    must_avoid:
      - "Reutilizar a sessão autenticada que publicou o perfil"
```
