---
description: Revisa o funil de candidaturas e aponta o que precisa de ação
---

Revise o estado do funil.

1. `pnpm jho pipeline` — estado atual.
2. Identifique o que está parado: candidaturas em `applied` há mais de 10 dias
   sem movimento, `screening` sem próximo passo definido, `interviewing` sem
   follow-up agendado.
3. Calcule a conversão por etapa e por cluster (architect / staff / ai_lead).
   A auditoria §14 pede exatamente essa métrica.
4. Proponha as ações da semana, em ordem de prioridade.
5. Se o usuário confirmar, atualize com `pnpm jho track`.
6. Ofereça exportar o snapshot para o vault: `pnpm jho report`.

$ARGUMENTS
