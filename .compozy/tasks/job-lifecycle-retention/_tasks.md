---
schema_version: "compozy.tasks/v2"
workflow: job-lifecycle-retention
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
---

# Job Lifecycle and Application History Task List

Task sizing follows real boundaries: the schema/domain/archive contract lands
first; candidate and recruiter read models then proceed independently. Every
test ID in `_tests.md` is assigned exactly once below.
