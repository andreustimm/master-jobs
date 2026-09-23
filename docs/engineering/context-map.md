# Mapa de contextos

Este inventário é a fonte de verdade das fronteiras do monólito modular. A
contagem e a presença das APIs públicas são verificadas por
`tests/architecture.test.ts`, que também percorre o grafo de imports de valor
de todo `domain/`, do scorer (`src/core/scoring/`) e da estatística
(`src/core/analytics/`) e reprova quem alcança banco, rede, Next ou `infra/` —
inclusive pelo `index.ts` de um contexto, que compõe adapters. O scorer é
domínio de Matching fisicamente fora do contexto, e por isso é o único de fora
que importa `contexts/matching/domain/` direto.

<!-- schema-table-count: 38 -->

| Contexto | Aggregate owner / responsabilidade | Tabelas próprias | API pública | Dependências permitidas |
|---|---|---|---|---|
| auth | identidade, sessão e autorização | `auth_user`, `auth_session`, `auth_login_token`, `auth_event`, `recruiter_candidate` | `src/contexts/auth/index.ts` | Candidate por `candidate_id`; relógio e hash como portas |
| correspondence | mensagem observada e sugestão de mudança | `mail_message`, `mail_suggestion` | `src/contexts/correspondence/index.ts` | Sourcing observa vagas; Pursuit aplica decisão na mesma transação |
| fx | cotação e cache cambial | `fx_rate` | `src/contexts/fx/index.ts` | `HttpClient`, `Clock`; nenhum contexto de negócio |
| matching | avaliação candidato–vaga, trilhas de alvo e comparação manual | `candidate_matching_profile`, `target_track`, `saved_term`, `saved_term_request`, `job_score` | `src/contexts/matching/index.ts` | Candidate, Sourcing, Skills e FX; não escreve Pursuit |
| operations | manutenção do acervo: qual rotina rodar, quem executa, e a varredura fatiada (ADR 0025) | `sweep_lease` (reserva de fonte/candidato por chamada), `sweep_run` (métrica por fatia); o resto do estado mora nas tabelas que cada rotina escreve | `src/contexts/operations/index.ts` | `WorkflowDispatchPort` (GitHub Actions, disparo manual); compõe sync, captura, reconferência, termos (Sourcing) e pontuação (Matching) pelas APIs que a CLI usa; lê a saúde das fontes por `src/core/ingest/health.ts` |
| pursuit | candidatura e histórico de transições | `application`, `application_event` | `src/contexts/pursuit/index.ts` | Candidate e Sourcing por identidade; Matching somente como projeção de leitura |
| skills | catálogo, evidência e demanda de competências | `skill`, `candidate_skill` | `src/contexts/skills/index.ts` | Candidate e corpus de Sourcing por portas |
| sourcing | captura por termo nas plataformas cadastradas, atribuição de vaga a termo e cota por plataforma | `term_capture`, `term_attribution`, `platform_quota` | `src/contexts/sourcing/index.ts` | Ingestão canônica (`observeRawJob`), adapters de fonte e guarda de ingestão; nunca lê tabelas de Matching |

## Módulos ainda físicos em `src/core`

Eles não são contextos novos nem uma fila de renomeação. Permanecem coesos e
ganham API pública quando uma mudança funcional atravessa sua fronteira:

| Módulo | Ownership / tabelas |
|---|---|
| sourcing | observação global de `source`, `company`, `job`, `job_page`, `verify_task` (a captura por termo já é contexto) |
| candidate | perfil e documentos em `candidate`, `candidate_document` |
| positioning | `post`, `engagement`, `target_account`, `metric_snapshot`, `positioning_task` |
| scrape | fila técnica `scrape_task` |
| matching | perfil da pessoa em `candidate_matching_profile`, trilhas de alvo em `target_track`, termos salvos em `saved_term`, teto diário de buscas pedidas em `saved_term_request`, notas por trilha em `job_score`, fila de repontuação em `score_task` |
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
