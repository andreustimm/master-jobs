---
schema_version: "compozy.tasks/v2"
workflow: recrutador-acesso
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
    - from: task_01
      to: task_04
    - from: task_02
      to: task_04
    - from: task_01
      to: task_05
---

# Acesso do recrutador e diretório de perfis — lista de tarefas

Issue #465. Fontes: [`_prd.md`](_prd.md), [`_user_stories.md`](_user_stories.md),
[`_techspec.md`](_techspec.md), [`_tests.md`](_tests.md), [`adrs/`](adrs/).

| Tarefa | Título | Tipo | Complexidade | Depende de | Testes |
|---|---|---|---|---|---|
| [task_01](task_01.md) | Fundação: tabelas, cópia dos vínculos, predicado de acesso, política e e-mails | backend | critical | — | 64 |
| [task_02](task_02.md) | Candidato concede, convida, limita e revoga; histórico, admin e varredura | backend | high | task_01 | 72 |
| [task_03](task_03.md) | Convite: página sob `/signup` e conclusão no cadastro e no login | backend | high | task_02, **login-social task_03 em `dev`** | 30 |
| [task_04](task_04.md) | Área do recrutador e sugestões de vaga | frontend | high | task_01, task_02 | 59 |
| [task_05](task_05.md) | Diretório de perfis para recrutadores | frontend | high | task_01 | 46 |

Total: 271 casos (74 UT, 168 IT, 29 E2E), cada um em exatamente uma tarefa.

**Dependência externa:** a task_03 só começa depois que a task_03 de
`.compozy/tasks/login-social/` (tela `/signup` e `src/contexts/auth/app/signup.ts`)
estiver mesclada em `dev` (ADR-018). O grafo acima não a representa porque o
`compozy.tasks/v2` só liga tarefas do mesmo workflow.

Ondas: task_01 → (task_02 ∥ task_05) → (task_03 ∥ task_04).

Pendência fora deste pacote: remover `recruiter_candidate` (migração não
aditiva, revisão humana) numa issue própria depois que esta entrega estiver em
produção (ADR-011).
