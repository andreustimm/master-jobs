---
description: Adiciona uma nova fonte de vagas, validando contra a API real antes de commitar
---

Adicione a fonte descrita em $ARGUMENTS.

1. Identifique o ATS da empresa (Greenhouse, Lever, Ashby, SmartRecruiters,
   Recruitee) e descubra o handle correto — normalmente visível na URL da
   página de carreiras.
2. **Valide antes de qualquer edição:** `pnpm jho sources probe <kind> <handle>`.
   Erro de HTTP ou resposta fora do contrato indica handle ou adapter errado:
   descubra o certo em vez de commitar algo quebrado. **Zero vagas não prova
   handle errado** — um board vazio é legítimo. Confirme pela página de
   carreiras da empresa se ela tem vagas abertas; se não tem, a fonte pode
   entrar, com a observação e a data no `rationale`.
3. Se o ATS ainda não tiver adapter, escreva um em `src/core/sources/`,
   registre em `registry.ts`, e **confira o mapeamento de campos contra uma
   resposta real** (`curl` no endpoint) — nunca contra documentação.
4. Adicione em `config/sources.yaml` com um `rationale` explicando por que
   essa fonte entra na lista.
5. Rode `pnpm jho jobs sync` e confirme que a fonte aparece como `ok`.
6. Se criou adapter novo, adicione teste em `tests/`.

Leia `docs/sources.md` e
[rules/data-and-sourcing.md](../../docs/engineering/rules/data-and-sourcing.md#g70)
antes de começar. Nunca adicione LinkedIn como fonte (regra 1).
