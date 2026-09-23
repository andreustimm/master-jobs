# CH-public-address-change: escolher, recusar e trocar o endereço público no celular

```yaml
charter:
  id: CH-public-address-change
  mission: "No celular, tentar endereços inválidos, reservados e em uso, trocar para um válido e conferir como visitante anônimo que o antigo morre com 404 e que perfil privado nunca confirma existência."
  mode: charter-with-tour
  persona:
    name: Andreus no celular
    device: phone-small
    network: 4g
    locale: pt-BR
  journey: J-choose-public-address
  scenarios: [PUB-public-address-refusals, PUB-change-public-address, PUB-public-address-private-404, PUB-public-cv-protected-content, PUB-public-profile-mobile-entry]
  tour: Antisocial Tour
  time_box_minutes: 45
  guidance:
    must_try:
      - "Endereço com espaço, acento, curto, 'admin', 'login' e o de outra conta."
      - "Trocar o endereço e abrir o antigo e o novo numa sessão anônima, com refresh."
      - "Voltar para Privado e abrir o endereço, o antigo e o id interno."
      - "Publicar o currículo com e-mail, telefone e pretensão salarial escritos nele."
    must_avoid:
      - "Deixar o perfil do dono público ao fim da sessão."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
