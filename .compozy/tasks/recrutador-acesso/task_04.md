---
status: pending
title: "Área do recrutador e sugestões de vaga"
type: frontend
complexity: high
---

# Área do recrutador e sugestões de vaga

## Overview

Entrega o que o recrutador faz com o acesso e o que o candidato decide: a
lista `/recruiter` com desde/até e sugestões pendentes, a página do candidato
com nome no título, funil somente leitura, CV atual (ver e baixar) e último
acesso; as sugestões de vaga (catálogo ou `/jobs/new`), o resumo por e-mail no
máximo uma vez por hora, e a tela `/suggestions` em que só o candidato aceita
(entra em Backlog) ou recusa (ADR-015, regra 2).

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
1. MUST manter o 404 idêntico para candidato inexistente, sem concessão ativa, id malformado e depois do fim, em `/recruiter/[candidateId]`, `/cv`, `/cv/download` e `/suggest`; a política decide a leitura (`requirePage("candidate:read")`).
2. MUST mostrar o CV atual como enviado (texto de `candidate_document` corrente), sem lista de versões, com download `text/markdown` nomeado pelo nome do candidato; nenhuma nota, piso salarial, contato do perfil, análise ou versão antiga.
3. MUST atualizar `last_accessed_at` ao abrir a página do candidato ou o CV, no máximo uma vez por minuto por concessão.
4. MUST implementar as regras puras de `src/contexts/pursuit/domain/recruiter-suggestion.ts`, o serviço e a loja de sugestões: criar ou juntar sob a trava do candidato com limite de 20 por 24 h, nota ≤ 500 em texto puro, recusa de vaga fechada/arquivada, de repetida e de já decidida.
5. MUST aceitar o id do candidato nas actions do recrutador só como seletor dentro de `session.linkedCandidateIds` (`guard("suggestion:create", …)`), registrar a exceção no inventário e cobrir o id não vinculado em `tests/entry-denial.test.ts` (G40).
6. MUST aceitar a sugestão numa transação no padrão `decideSuggestion`: cria `application` `backlog` com `channel = 'recruiter'` só quando não existe; existente fica intacta; marcador "sugerida por recrutador" pela sugestão; recusar não toca o funil; sessão emprestada não decide (`suggestion:decide`).
7. MUST enviar o resumo ao candidato na hora quando não houve outro desse recrutador para esse candidato na última hora, e ligar o envio agrupado ao job `manutencao:recruiter-access` da task_02.
8. MUST mostrar ao recrutador só as próprias sugestões feitas na concessão vigente; ao candidato, a contagem de pendentes na navegação.
9. MUST registrar as rotas novas (`PAGE_POLICY`, `tests/e2e/routes.mjs` ou `UNMEASURED_PAGES` com motivo, `config/e2e-spec-map.json`), com dicionário, `data-user-content`, 375 px e `data-testid`.
10. MUST atualizar `docs/product/vision.md` e `docs/product/personas.md` (recrutador como usuário convidado pelo candidato, ADR-009) e a jornada de QA de sugestão e revogação.
</requirements>

## Subtasks
- [ ] 4.1 Lista `/recruiter` paginada por nome com desde, até e pendentes; título com o nome do candidato.
- [ ] 4.2 Página do candidato: funil somente leitura, paginação com limite, último acesso.
- [ ] 4.3 CV atual: página e download.
- [ ] 4.4 Regras puras, loja e serviço de sugestões, com limite e resumo por e-mail.
- [ ] 4.5 Sugerir pelo catálogo (`/recruiter/[id]/suggest`) e por `/jobs/new?suggestFor=`.
- [ ] 4.6 Tela `/suggestions`, aceitar e recusar, marcador no funil e contagem na navegação.
- [ ] 4.7 Inventário, entry-denial e specs E2E `tests/e2e/ui/recruiter-suggestions.mjs`.
- [ ] 4.8 Docs de produto e QA.

## Implementation Details

Seguir "Data flow" (itens 2, 4 e 5), "API Endpoints" (linhas de
`/recruiter/*`, `/suggestions`, `suggestJobAction`, `createRecruiterJobAction`)
e a ADR-015.

### Relevant Files
- `app/recruiter/page.tsx`, `app/recruiter/[candidateId]/page.tsx` — telas atuais.
- `src/core/db/repo.ts` — `recruiterCandidateSummaries` (~1642), `setApplicationStatusInTransaction` (~1276), padrão de busca (~600-680).
- `src/core/mail/run.ts` — `decideSuggestion` (~337) como modelo de transação.
- `src/contexts/pursuit/index.ts`, `domain/application.ts` — contexto onde as sugestões entram.
- `app/jobs/new/actions.ts`, `app/jobs/new/page.tsx` — cadastro de vaga do recrutador.
- `src/core/term.ts`, `src/core/search.ts` — busca de vaga por título e empresa.
- `app/nav-links.tsx` — navegação do candidato.
- `app/jobs/[id]` — página da vaga (conferir que não mostra dado do candidato acompanhado).
- `tests/recruiter-history.test.ts`, `tests/entry-denial.test.ts`, `tests/e2e/ui/*.mjs` (ROLE_SCENARIOS).

### Dependent Files
- `src/contexts/operations/app/sweep.ts` — passo de resumo no job da task_02.
- `src/core/i18n/pt-BR.ts`, `en.ts` — `recruiter.*`, `suggestions.*`.
- `tests/e2e/routes.mjs` (`UNMEASURED_PAGES` atual das páginas do recrutador), `tests/architecture.test.ts`.
- `docs/product/vision.md`, `docs/product/personas.md`, `docs/qa/`.

### Related ADRs
- [ADR-002](adrs/adr-002.md), [ADR-003](adrs/adr-003.md), [ADR-009](adrs/adr-009.md), [ADR-012](adrs/adr-012.md), [ADR-015](adrs/adr-015.md), [ADR-016](adrs/adr-016.md), [ADR-017](adrs/adr-017.md)

## Deliverables
- Área do recrutador com funil, CV e sugestões dentro do escopo.
- Sugestões que só viram funil pelo aceite do candidato.
- Docs de produto atualizadas.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [ ] UT-050, UT-051, UT-052, UT-053, UT-054, UT-055, UT-056, UT-057, UT-058, UT-059 — regras de sugestão
- [ ] IT-103, IT-104, IT-105, IT-106 — lista, rótulo, título e último acesso
- [ ] IT-107, IT-108, IT-109, IT-110 — CV e 404
- [ ] IT-111, IT-112, IT-113, IT-114 — fronteira de privacidade
- [ ] IT-115, IT-116, IT-117, IT-118, IT-119, IT-120, IT-121, IT-122, IT-123, IT-124, IT-125, IT-126 — criar sugestão
- [ ] IT-127, IT-128 — sugestões do recrutador
- [ ] IT-129, IT-130, IT-131, IT-132, IT-133, IT-134, IT-135, IT-136, IT-137, IT-138 — aceitar e recusar
- [ ] IT-139, IT-140 — tela e contagem do candidato
- [ ] IT-141, IT-142, IT-143 — funil vazio, paginação e inventário
- [ ] E2E-016, E2E-017 — lista, funil, CV
- [ ] E2E-018, E2E-019, E2E-020 — sugerir, aceitar, recusar
- [ ] E2E-021 — perda de acesso e link do e-mail
- [ ] E2E-022 — 375 px e axe
- [ ] E2E-023 — sessão emprestada sem decisão

## Success Criteria
- Every assigned test case implemented and passing
- Nenhuma sugestão grava em `application` sem o aceite do candidato
- Nenhum dado fora do escopo da ADR-002 alcança o recrutador
