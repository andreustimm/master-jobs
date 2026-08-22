# Grafo de tarefas — `perfil-publico-limite`

| Tarefa | Depende de | Casos de `_tests.md` |
|---|---|---|
| `task_01` — janela deslizante em memória, pura | — | T1, T2, T3, T4, T8 |
| `task_02` — extrair o IP do pedido | — | T6, T7 |
| `task_03` — ligar na rota `/p/[slug]` | 01, 02 | T5, T9 |
| `task_04` — verificação em browser | 03 | T10 |

Cobertura: T1–T10, cada um em exatamente uma tarefa. Nenhum órfão.
