# Mapa de contextos

Este inventário é a fonte de verdade das fronteiras do monólito modular. A
contagem e a presença das APIs públicas são verificadas por
`tests/architecture.test.ts`.

<!-- schema-table-count: 28 -->

| Contexto | Aggregate owner / responsabilidade | Tabelas próprias | API pública | Dependências permitidas |
|---|---|---|---|---|
| auth | identidade, sessão e autorização | `auth_user`, `auth_session`, `auth_login_token`, `auth_event` | `src/contexts/auth/index.ts` | Candidate por `candidate_id`; relógio e hash como portas |
| correspondence | mensagem observada e sugestão de mudança | `mail_message`, `mail_suggestion` | `src/contexts/correspondence/index.ts` | Sourcing observa vagas; Pursuit aplica decisão na mesma transação |
| fx | cotação e cache cambial | `fx_rate` | `src/contexts/fx/index.ts` | `HttpClient`, `Clock`; nenhum contexto de negócio |
| matching | avaliação candidato–vaga e comparação manual | `candidate_matching_profile`, `job_score` | `src/contexts/matching/index.ts` | Candidate, Sourcing, Skills e FX; não escreve Pursuit |
| pursuit | candidatura e histórico de transições | `application`, `application_event` | `src/contexts/pursuit/index.ts` | Candidate e Sourcing por identidade; Matching somente como projeção de leitura |
| skills | catálogo, evidência e demanda de competências | `skill`, `candidate_skill` | `src/contexts/skills/index.ts` | Candidate e corpus de Sourcing por portas |

## Módulos ainda físicos em `src/core`

Eles não são contextos novos nem uma fila de renomeação. Permanecem coesos e
ganham API pública quando uma mudança funcional atravessa sua fronteira:

| Módulo | Ownership / tabelas |
|---|---|
| sourcing | observação global de `source`, `company`, `job`, `job_page`, `verify_task` |
| candidate | perfil e documentos em `candidate`, `candidate_document` |
| positioning | `post`, `engagement`, `target_account`, `metric_snapshot`, `positioning_task` |
| scrape | fila técnica `scrape_task` |
| llm | catálogo BYOK em `llm_provider`, `llm_model` |

`src/core/db/schema.ts` é o único composition root físico do Drizzle: migrations
e foreign keys cruzadas precisam enxergar o grafo completo. Ownership lógico
não exige duplicar declarações de tabela. SQL de apresentação fica atrás das
APIs públicas dos contextos; UI e CLI não importam o repositório genérico.

## Direção das dependências

```text
UI / CLI
  -> APIs públicas dos contextos
      -> application service
          -> domínio puro + portas
              <- adapters de infra

Sourcing -> Matching -> Pursuit
       \-> Correspondence -/
Candidate -> Matching / Pursuit / Skills / Auth
FX -> Matching
```

Não há event bus ou container. A composição é por funções, e transações
cross-context explícitas são usadas apenas quando a atomicidade é uma regra do
caso de uso (aceite de sugestão de e-mail).
