# CH-admin-source-catalog-first-walk: primeira volta pelas telas novas de Plataformas e Execuções

```yaml
charter:
  id: CH-admin-source-catalog-first-walk
  mission: "Como Andreus em triagem (admin), cadastrar e operar uma fonte pelas telas novas /admin/plataformas e /admin/execucoes (#223, tarefa 03), e confirmar que candidato, recrutador e sessão emprestada não alcançam nenhuma das duas."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-operate-source-catalog
  scenarios:
    - ADMN-source-catalog-operate
    - ADMN-source-catalog-denied
    - ADMN-source-runs-partial-retry
  tour: Feature Tour
  time_box_minutes: 60
  guidance:
    must_try:
      - "Cadastrar um handle de board suportado sem habilitar; conferir que aparece desabilitado."
      - "Tentar cadastrar o mesmo handle de novo e colar uma chave no campo do nome; conferir a recusa com o motivo em cada caso."
      - "Abrir a fonte cadastrada e sondar; conferir a mensagem (alcançável, vazio, bloqueado, falha ou recusa do ambiente) e que nenhuma vaga foi gravada."
      - "Habilitar e pedir Buscar agora; abrir o detalhe da execução em /admin/execucoes e ler o estado (na fila com o motivo, ou concluída com contagens)."
      - "Recarregar Plataformas e Execuções e conferir que o estado da fonte e da execução se mantém."
      - "Buscar em todas as fontes (se houver mais de uma cadastrada) e, se alguma falhar, conferir a execução parcial com uma linha por fonte e 'desconhecido' em vez de zero na que falhou; usar Tentar de novo só na falha e conferir o vínculo com a execução original."
      - "Abrir /admin/plataformas, /admin/execucoes e o link direto do detalhe como candidato (e2e-candidato@local.test) e como recrutador (e2e-recrutador@local.test); conferir acesso recusado sem nenhuma configuração de fonte visível."
      - "Como admin, assumir a identidade do candidato de teste (sessão emprestada) e repetir a mesma tentativa nas duas telas."
      - "Confirmar que /jobs continua pesquisável para candidato e recrutador durante o teste de acesso recusado."
    must_avoid:
      - "Não forçar scraping de plataforma real fora do que as fontes já cadastradas no ambiente local permitem — o ambiente é isolado (G01)."
      - "Não usar `jho jobs sync --run <id>` para simular sucesso quando a tela já mostra o estado esperado (na fila) — CLI só quando o resultado da tela não decide a pergunta do cenário."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
