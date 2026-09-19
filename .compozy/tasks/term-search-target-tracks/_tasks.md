---
schema_version: "compozy.tasks/v2"
workflow: term-search-target-tracks
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
  edges:
    - from: task_01
      to: task_02
    - from: task_02
      to: task_03
    - from: task_02
      to: task_04
    - from: task_03
      to: task_05
    - from: task_04
      to: task_05
---

# Saved Term Searches and Target Tracks Task List

| Task | Title | Type | Complexity | Depends on | Tests |
|---|---|---|---|---|---|
| [task_01](task_01.md) | Target tracks and per-track fit | backend | critical | — | 43 UT · 43 IT |
| [task_02](task_02.md) | Term capture pipeline on registered platforms | backend | high | task_01 | 14 UT · 31 IT |
| [task_03](task_03.md) | Saved terms, daily repeat and CLI | backend | high | task_02 | 5 UT · 35 IT |
| [task_04](task_04.md) | Jobs screen: track selector, term, brought-by and pay filters | frontend | high | task_02 | 13 UT · 16 IT · 5 E2E |
| [task_05](task_05.md) | Searches, track editor, admin health and job detail screens | frontend | high | task_03, task_04 | 1 UT · 8 IT · 15 E2E |

`task_03` and `task_04` touch disjoint files and add no migration, so they can
run in parallel once `task_02` is done.
