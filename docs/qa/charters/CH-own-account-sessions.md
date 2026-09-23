# CH-own-account-sessions: Minha conta com duas sessões abertas e uma emprestada

```yaml
charter:
  id: CH-own-account-sessions
  mission: "Trocar senha e nome em Minha conta com outra sessão aberta, errar a senha atual até o limite, pedir recuperação para conta que existe e que não existe, e conferir que a sessão emprestada não escreve nada."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem noturna
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-manage-own-account
  scenarios: [AUTH-account-change-password, AUTH-account-rename, AUTH-account-wrong-current-password, ADMN-borrowed-session-account-readonly, AUTH-recovery-same-answer, AUTH-recovery-link-withheld-hosted]
  tour: Saboteur Tour
  time_box_minutes: 60
  guidance:
    must_try:
      - "Duas sessões da mesma conta; trocar a senha numa e recarregar as duas."
      - "Cinco senhas atuais erradas pelo teclado e depois a certa."
      - "Recuperação para e-mail existente e inexistente: comparar URL e texto."
      - "Assumir a identidade de uma conta e abrir /account."
    must_avoid:
      - "Trocar a senha da conta dona antes de terminar as outras sessões desta rodada."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
