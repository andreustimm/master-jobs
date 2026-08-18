---
description: Adiciona uma nova fonte de vagas, validando contra a API real antes de commitar
---

Adicione a fonte descrita em $ARGUMENTS.

1. Identifique o ATS da empresa (Greenhouse, Lever, Ashby, SmartRecruiters,
   Recruitee) e descubra o handle correto — normalmente visível na URL da
   página de carreiras.
2. **Valide antes de qualquer edição:** `pnpm jho sources probe <kind> <handle>`.
   Se retornar zero vagas ou erro, o handle está errado. Descubra o certo em
   vez de commitar algo quebrado.
3. Se o ATS ainda não tiver adapter, escreva um em `src/core/sources/`,
   registre em `registry.ts`, e **confira o mapeamento de campos contra uma
   resposta real** (`curl` no endpoint) — nunca contra documentação.
4. Adicione em `config/sources.yaml` com um `rationale` explicando por que
   essa fonte entra na lista.
5. Rode `pnpm jho jobs sync` e confirme que a fonte aparece como `ok`.
6. Se criou adapter novo, adicione teste em `tests/`.

Leia `docs/sources.md` antes de começar.
