---
description: Varredura diária de vagas — sincroniza as fontes, revisa o topo do ranking e propõe a triagem
---

Execute a varredura diária de vagas.

1. Rode `pnpm jho jobs sync` e reporte o resultado por fonte. Se alguma fonte
   falhar, diga qual e por quê — não esconda.
2. Rode `pnpm jho jobs list --min-fit 55 --limit 25`.
3. Para cada vaga nova acima de 60 de fit, rode `pnpm jho jobs show <id>` e
   avalie de verdade: blockers primeiro, depois o breakdown do score, depois
   aderência real ao perfil.
4. Apresente uma recomendação de triagem em tabela: id, empresa, cargo, fit,
   veredito (aplicar / talvez / descartar) e o motivo em uma linha.
5. **Não mova nada no funil sem confirmação.** Depois que o usuário decidir,
   registre com `pnpm jho track <id> <status> -n "<motivo>"`.

Use as skills `job-triage` e `candidate-profile`.

$ARGUMENTS
