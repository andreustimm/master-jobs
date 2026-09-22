# CH-first-captures-two-tabs: salvar dois termos e voltar ao resultado das primeiras capturas

```yaml
charter:
  id: CH-first-captures-two-tabs
  mission: "Como candidato, salvar duas buscas em abas diferentes e confirmar que as primeiras capturas de uma plataforma que respondeu terminam e continuam legíveis ao voltar."
  mode: charter-with-tour
  persona:
    name: Andreus em triagem
    device: laptop
    network: wifi-fast
    locale: pt-BR
  journey: J-save-term-search
  scenarios: [SRCH-first-captures-complete]
  tour: Multi-Tab Tour
  time_box_minutes: 30
  guidance:
    must_try:
      - "Salvar TypeScript e Python em duas abas e abandonar uma delas enquanto a captura segue."
      - "Voltar a Buscas, recarregar e confrontar os estados com a saúde agregada pelo CLI público."
      - "Abrir as vagas trazidas por um termo e retornar; conferir que a consulta mantém seu resultado."
    must_avoid:
      - "Executar em produção ou em ambientes remotos; preparar antes uma base local descartável com ingestão real habilitada conforme a ADR 0021."
      - "Simular respostas externas, alterar flags durante a sessão ou usar banco e endpoints internos para declarar sucesso."
      - "Interpretar duas abas como prova de colisão no índice; essa evidência vem do teste de integração."
```
