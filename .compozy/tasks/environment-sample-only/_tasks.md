---
schema_version: "compozy.tasks/v2"
workflow: environment-sample-only
graph:
  nodes:
    - id: task_01
      file: task_01.md
    - id: task_02
      file: task_02.md
    - id: task_03
      file: task_03.md
  edges:
    - from: task_01
      to: task_02
    - from: task_01
      to: task_03
    - from: task_02
      to: task_03
---

# Sample-Only Development and Staging Task List

The guard is the contract boundary. Fixtures depend on it, and workflow/QA
work depends on both being stable. Every test ID in `_tests.md` is assigned
exactly once below.
