---
schema_version: "compozy.tasks/v2"
workflow: login-social
graph:
  nodes:
    - id: task_01
      file: task_01.md
    - id: task_02
      file: task_02.md
    - id: task_03
      file: task_03.md
    - id: task_04
      file: task_04.md
  edges:
    - from: task_01
      to: task_02
    - from: task_01
      to: task_03
    - from: task_02
      to: task_03
    - from: task_01
      to: task_04
    - from: task_02
      to: task_04
---

# Login social, cadastro e e-mails da conta — lista de tarefas

Issue #464. Fontes: [`_prd.md`](_prd.md), [`_user_stories.md`](_user_stories.md),
[`_techspec.md`](_techspec.md), [`_tests.md`](_tests.md), [`adrs/`](adrs/).

| Tarefa | Título | Tipo | Complexidade | Depende de | Testes |
|---|---|---|---|---|---|
| [task_01](task_01.md) | Fundação: schema, domínio puro, flow cookie, e-mails e documentos legais | backend | high | — | 24 |
| [task_02](task_02.md) | Login social: OIDC, rotas, vínculo automático e provedor falso | backend | critical | task_01 | 51 |
| [task_03](task_03.md) | Cadastro em tela única (social e manual com código) | frontend | high | task_01, task_02 | 65 |
| [task_04](task_04.md) | Métodos de acesso: conta, admin, CLI, avisos e recuperação | frontend | high | task_01, task_02 | 41 |

task_03 e task_04 rodam em paralelo depois da task_02.
