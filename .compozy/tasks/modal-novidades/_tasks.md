---
schema_version: "compozy.tasks/v2"
workflow: modal-novidades
graph:
  nodes:
    - id: task_01
      file: task_01.md
    - id: task_02
      file: task_02.md
  edges:
    - from: task_01
      to: task_02
---

# What's New Modal Redesign Task List

Two robust vertical slices implement the localized release-content foundation
and then the complete browser experience. Dependency relationships live only in
the graph frontmatter above.

## Tasks

| ID | Title | Type | Complexity | Test cases |
| --- | --- | --- | --- | ---: |
| `task_01` | Localized changelog domain and atomic bilingual release pipeline | `backend` | `high` | 49 |
| `task_02` | Safe Markdown client modal and full browser integration | `frontend` | `high` | 44 |

