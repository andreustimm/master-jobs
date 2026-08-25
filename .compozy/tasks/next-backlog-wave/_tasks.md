---
schema_version: "compozy.tasks/v2"
workflow: next-backlog-wave
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
      to: task_04
---

# Next Backlog Wave Task List

The workflow reconciles operations first, then executes independent UI and
ingestion work. Compozy activation is the final operational step after the
documentation and loop contract are valid.
