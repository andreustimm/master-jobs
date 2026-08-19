# Modelo de dados — ER

As 14 tabelas, agrupadas pela natureza do dado. Essa separação é a decisão de
projeto mais importante do schema ([ADR 0005](../../adr/0005-separacao-entre-fato-observado-e-decisao-do-usuario.md)).

```mermaid
erDiagram
  source ||--o{ job : "produz"
  company ||--o{ job : "emprega"
  job ||--o| job_score : "pontuada por"
  job ||--o| application : "candidatura"
  application ||--o{ application_event : "histórico"
  candidate ||--o{ candidate_document : "CV e cartas"
  mail_message ||--o{ mail_suggestion : "sugere"
  application ||--o{ mail_suggestion : "alvo"
  job ||--o{ mail_suggestion : "alvo"

  source {
    text id PK "kind:handle"
    text kind
    text handle
    boolean enabled
    text last_status
    text last_error
    int last_job_count
  }

  job {
    int id PK
    text fingerprint UK "empresa+título+local"
    text content_hash "detecta edição"
    text company_name
    text description_text "offline, 99% preenchido"
    text closed_at "fechada, nunca deletada"
    json raw
  }

  job_score {
    int job_id PK
    real fit
    real title_score
    real keyword_score
    real geo_score
    real seniority_score
    real comp_score
    text cluster
    json blockers
    json reasons
    text scorer_version
  }

  application {
    int id PK
    int job_id UK
    text status
    text channel "referral importa"
    text applied_at
  }

  application_event {
    int id PK
    int application_id FK
    text kind
    text from_status
    text to_status
  }

  candidate {
    int id PK
    text slug UK
    text name
    boolean is_default
  }

  candidate_document {
    int id PK
    int candidate_id FK
    text kind "cv | cover_letter"
    text format "text | pdf"
    text content
    boolean is_current "versionado"
  }

  mail_message {
    int id PK
    text message_id UK
    text kind "job_alert | ats_* | unknown"
    text company_guess
  }

  mail_suggestion {
    int id PK
    int mail_id FK
    text suggested_status
    real confidence
    text status "pending | accepted | dismissed"
  }

  fx_rate {
    int id PK
    text date "data da cotação"
    text base
    text currency
    real rate
  }

  target_account {
    int id PK
    text name
    text company
    text category "former é o mais forte"
  }

  positioning_task {
    text id PK "PT-0001"
    text horizon
    text priority
    text status
  }

  metric_snapshot {
    int id PK
    text at
    text key
    real value
  }
```

## As três naturezas de dado

```mermaid
flowchart TB
  subgraph fato["Fato observado — recriável por sync"]
    source2[source]
    company2[company]
    job2[job]
  end

  subgraph derivado["Derivado — descartável por construção"]
    score2[job_score]
    fx2[fx_rate]
  end

  subgraph decisao["Decisão do usuário — INSUBSTITUÍVEL"]
    app2[application]
    ev2[application_event]
    cand2[candidate_document]
  end

  fato --> derivado
  fato -.->|nunca escreve| decisao

  style decisao fill:#efe,stroke:#0e7c63,stroke-width:3px
  style derivado fill:#eef,stroke:#024ad8
```

> **Invariante:** apagar `data/jobs.db` custa as decisões, e só elas. Todo o
> resto volta com um `jobs sync`. É por isso que backup dessa tabela é a única
> operação de banco que importa de verdade.

`job_score` é tabela separada em vez de colunas em `job` justamente para ser
descartável: pode ser apagada e recomputada a qualquer momento, e a ingestão faz
isso automaticamente quando o conteúdo de uma vaga muda.
