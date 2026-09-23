# CH-account-isolation-first-entry: primeira entrada de conta sem candidato não vê ninguém

```yaml
charter:
  id: CH-account-isolation-first-entry
  mission: "Como candidato convidado sem perfil, entrar pela primeira vez em 375px e em inglês, criar o próprio perfil e provar que em nenhum momento aparece dado do dono ou de outra conta."
  mode: charter-with-tour
  persona:
    name: Candidato convidado sem perfil
    device: phone-small
    network: 4g
    locale: en-US
  journey: J-create-own-profile
  scenarios: [PROF-create-own-profile, PROF-create-own-profile-identity, PROF-create-own-profile-address, PROF-create-own-profile-double-submit, AUTH-create-profile-refused-roles, AUTH-shared-candidate-denied, NAV-denied-screen-below-header]
  tour: Garbage Collector's Tour
  time_box_minutes: 60
  guidance:
    must_try:
      - "Conta de papel candidato sem candidato (recrutadora promovida em /admin/users) abre /candidate, /candidate/skills, /searches e /pipeline antes de criar o perfil."
      - "Recrutadora, admin sem papel candidato e sessão emprestada abrem /candidate: 403 sem formulário."
      - "Criar o perfil com endereço em uso, depois com endereço livre, com duplo toque no botão."
      - "Conta criada por /admin/users e por jho auth add-user entra e vê perfil vazio próprio."
    must_avoid:
      - "Ler o banco para decidir veredito; o banco só prepara a conta."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
