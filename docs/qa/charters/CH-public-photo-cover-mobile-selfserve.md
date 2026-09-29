# CH-public-photo-cover-mobile-selfserve: enviar foto e capa e revogar o link publicado

```yaml
charter:
  id: CH-public-photo-cover-mobile-selfserve
  mission: "Como Candidato convidado sem perfil, enviar foto e capa em /candidate, ligar 'Mostrar no perfil público' nas duas, ler /p/<endereço> como visitante anônimo, e revogar de cada uma das formas conhecidas (Privado, 'Mostrar' desligado, remover imagem, trocar endereço) conferindo 404 idêntico a um endereço inventado. Reconfirmar também com o servidor reiniciado sem JHO_STORAGE_DRIVER (retest da BUG-20260928-public-profile-broken-image-icon-storage-unconfigured): /candidate deve recusar o envio explicando a falta de configuração, e /p/ deve omitir a imagem em vez de mostrar o ícone quebrado."
  mode: charter-with-tour
  persona:
    name: Candidato convidado sem perfil
    device: phone-small
    network: 4g
    locale: pt-BR
  journey: J-open-public-profile
  scenarios: [PUB-edit-public-photo-cover, PUB-public-photo-cover-opt-in, PUB-public-image-revoked-404]
  tour: Feature Tour
  time_box_minutes: 45
  guidance:
    must_try:
      - "Enviar JPEG/PNG/WebP válidos nos dois campos, e confirmar proporção (foto quadrada, capa mais alta em 375px do que em desktop)."
      - "Revogar pelas quatro vias (Privado, 'Mostrar' desligado, remover imagem, trocar endereço) e comparar o 404 com /p/never-existed-address-xyz."
      - "Reiniciar o servidor sem JHO_STORAGE_DRIVER com foto/capa já salvas e 'Mostrar' ligado: /p/<endereço> deve sair sem imagem (não ícone quebrado), e a tentativa de novo envio em /candidate deve nomear a falta de configuração."
    must_avoid:
      - "Usar a conta real do dono ou tornar dado real público."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
