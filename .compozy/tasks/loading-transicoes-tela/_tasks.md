---
schema_version: "compozy.tasks/v2"
workflow: loading-transicoes-tela
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
    - from: task_02
      to: task_03
    - from: task_02
      to: task_04
    - from: task_03
      to: task_04
---

# Unified Navigation Splash and Safe Offline Shell Task List

Four robust vertical slices establish the transition contract, integrate it with
the App Router, harden the credentialless offline boundary, and finally migrate
every first-party navigation surface. Dependency relationships live only in the
graph frontmatter above.

## Tasks

| ID | Title | Type | Complexity | Test cases |
| --- | --- | --- | --- | ---: |
| `task_01` | Build the navigation transition domain and browser store | `backend` | `high` | 25 |
| `task_02` | Integrate the App Router coordinator and accessible branded splash | `frontend` | `critical` | 16 |
| `task_03` | Deliver the credentialless offline shell and deny-by-default cache | `infra` | `critical` | 17 |
| `task_04` | Migrate first-party navigation and close canonical route flows | `frontend` | `high` | 14 |

