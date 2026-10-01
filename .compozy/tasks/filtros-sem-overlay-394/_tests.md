# Contrato de testes — #394

- Reducer e store preservam transição suave após três segundos.
- Offline e navegação entre pathnames continuam bloqueantes.
- Rota de teste isolada atrasa resposta real do servidor por 4,2 segundos:
  navegação no mesmo pathname não produz overlay/inert e anuncia a demora.
- Presets Não triadas, Com salário e Recém-publicadas concluem e sobrevivem a refresh.
- Interceptação RSC dos presets não produziu atraso confiável no harness;
  a espera prolongada é coberta pela fixture existente e pelo reducer.
- Verificar desktop e 375px, typecheck e Vitest relacionado.
