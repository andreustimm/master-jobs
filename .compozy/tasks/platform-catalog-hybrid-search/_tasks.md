---
schema_version: "compozy.tasks/v2"
workflow: platform-catalog-hybrid-search
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
    - id: task_05
      file: task_05.md
    - id: task_06
      file: task_06.md
    - id: task_07
      file: task_07.md
  edges:
    - from: task_01
      to: task_02
    - from: task_02
      to: task_03
    - from: task_02
      to: task_04
    - from: task_05
      to: task_07
---

# Catálogo de plataformas e busca híbrida (residual): tarefas

Decomposição do residual delimitado em [`_scope-map.md`](_scope-map.md) e
especificado em [`_techspec.md`](_techspec.md). Todo ID de
[`_tests.md`](_tests.md) está atribuído a exatamente uma tarefa.

Este grafo é **projeção local**. Estado, prioridade, responsável e
dependências de execução vêm das subissues e das relações nativas no
Project 3 (regra 24); enquanto elas não forem publicadas pelo escritor
coordenado, nenhuma tarefa daqui tem posse de execução.

| Tarefa | Frente | Depende de | Testes |
|---|---|---|---|
| [01](task_01.md) | Catálogo no banco, importação e divergência | — | UT-001–UT-004, IT-001, IT-002 |
| [02](task_02.md) | Histórico de execução e captura de uma fonte | 01 | UT-005–UT-008, UT-012, IT-003–IT-006 |
| [03](task_03.md) | Telas de Plataformas e Execuções | 02 | UT-009, E2E-001–E2E-003 |
| [04](task_04.md) | Eventos de verificação e disponibilidade na vaga | 02 | UT-010, UT-011, IT-007, IT-008, E2E-004 |
| [05](task_05.md) | Relevância, aspas, localização, explicação e proximidade | — | UT-013–UT-015, IT-009, IT-010, E2E-005 |
| [06](task_06.md) | Análise estruturada da vaga | — | UT-016–UT-018, IT-011, IT-012, E2E-006 |
| [07](task_07.md) | Ordenação semântica opcional (bloqueada por decisão do dono) | 05 | UT-019, UT-020, IT-013 |

Cada tarefa é uma PR para `dev` com migration própria quando houver (G51). A
entrega exigida pela issue #223 é produção publicada e verificada; integrar
uma tarefa em `dev` não a satisfaz.
