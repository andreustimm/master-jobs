---
schema_version: "compozy.tasks/v2"
workflow: menu-mobile-fechamento
graph:
  nodes:
    - id: task_01
      file: task_01.md
  edges: []
---

# Menu mobile fecha ao navegar — Task List

| ID | Título | Tipo | Complexidade |
|----|--------|------|--------------|
| task_01 | Menu mobile: client component com fechamento ao navegar | bugfix | low |

Uma tarefa: o defeito é uma fatia vertical única (mover o componente, fiar o
fechamento, atualizar os testes de nó e o e2e), sem fronteira de contrato,
paralelização ou divisão de domínio. Testes vivem na tarefa que implementa o
comportamento.
