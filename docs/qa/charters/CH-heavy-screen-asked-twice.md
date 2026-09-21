# CH-heavy-screen-asked-twice: a mesma tela pesada pedida duas vezes responde as duas

```yaml
charter:
  id: CH-heavy-screen-asked-twice
  mission: "Procurar tela que responde sozinha e trava quando pedida duas vezes ao mesmo tempo, e confirmar que um travamento deixa rastro nomeando a rota."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: desktop
    network: wifi-fast
    locale: pt-BR
  journey: J-switch-workspace-screen
  scenarios:
    - JOBS-concurrent-heavy-screens
  tour: Multi-Tab Tour
  time_box_minutes: 60
  guidance:
    must_try:
      - "Duas abas na MESMA tela, recarregadas juntas, nas seis entradas do cenário — `/`, `/jobs`, `/jobs` com faixa salarial, `/searches`, `/candidate/skills` e a criação de trilha por termo."
      - "Navegar pelo menu com prefetch ligado e clicar rápido: o prefetch e o clique são duas requisições da mesma rota."
      - "Cronometrar: o tempo da segunda não pode ser o da primeira somado ao dela."
      - "Se alguma travar, procurar no Sentry o aviso pré-timeout nomeando a rota — ele agora existe em `/` e em `/jobs` também, e cobre a requisição inteira, inclusive a autenticação."
    must_avoid:
      - "Não usar devtools para simular a falha: a espera por conexão é real e tem de ser provocada abrindo a tela de verdade."
      - "Não confiar no throttling de rede como substituto — o defeito é de conexão de banco, não de banda."
```

<!-- O charter é durável e imutável: reexecute em ciclos seguintes; o debrief de cada execução vai no relatório daquela execução (Session Debriefs), nunca aqui. -->
