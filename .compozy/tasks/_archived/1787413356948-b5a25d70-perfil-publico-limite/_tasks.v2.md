---
schema_version: "compozy.tasks/v2"
workflow: perfil-publico-limite
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
      to: task_03
    - from: task_02
      to: task_03
    - from: task_03
      to: task_04
---

# Limite de requisição no perfil público — Task List

Manifesto legado convertido para `compozy.tasks/v2` exclusivamente para
preservar o histórico e permitir o arquivamento da feature já implementada no
commit `ceb34dc` de `dev`.

| ID | Tarefa | Casos de `_tests.md` |
| --- | --- | --- |
| `task_01` | Janela deslizante em memória, pura | T1, T2, T3, T4, T8 |
| `task_02` | Extrair o IP do pedido | T6, T7 |
| `task_03` | Ligar o limite na rota `/p/[slug]` | T5, T9 |
| `task_04` | Verificação em browser | T10 |
