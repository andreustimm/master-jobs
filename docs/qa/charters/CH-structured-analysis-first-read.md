# CH-structured-analysis-first-read: pedir e ler a análise estruturada de uma vaga pela primeira vez

```yaml
charter:
  id: CH-structured-analysis-first-read
  mission: "Como Andreus em triagem, pedir a análise estruturada de uma vaga sem análise prévia, conferir que o pedido fica pendente mesmo após recarregar, e — se um provedor LLM estiver configurado — ler os campos processados e o que só o admin vê."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-read-structured-job-analysis
  scenarios: [JOBS-structured-analysis]
  tour: Feature Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Abrir uma vaga sem análise e conferir a explicação e o botão de pedir análise."
      - "Pedir a análise e conferir o estado pendente; recarregar a página e conferir que o pendente sobrevive."
      - "Se `jho analysis run` tiver um provedor configurado (chave BYOK real), rodar como operador e recarregar para ler campo a campo, com trecho do anúncio e 'desconhecido' onde falta evidência."
      - "Abrir a mesma vaga como admin e conferir que modelo, tokens e custo só aparecem para o admin."
      - "Alterar o texto da vaga (se houver via de teste pública) e conferir o aviso de análise desatualizada."
    must_avoid:
      - "Não chamar `processNextAnalysis` nem qualquer porta de teste diretamente — só `jho analysis queue`/`jho analysis run` pela CLI, como o operador realmente usa."
      - "Não usar chave de provedor que não seja a configurada pelo dono; sem chave, a perna de processamento fica Blocked (needs human verify), não simulada."
```

<!-- The charter is durable and immutable: re-run it in later cycles; each run's debrief goes in that run's report (Session Debriefs), never here. -->
