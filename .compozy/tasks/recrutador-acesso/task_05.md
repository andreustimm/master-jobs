---
status: pending
title: "Diretório de perfis para recrutadores"
type: frontend
complexity: high
---

# Diretório de perfis para recrutadores

## Overview

Entrega o canal de descoberta da ADR-010: recrutadores autenticados buscam,
por texto e filtros simples, os perfis em Recrutadores ou Público, e leem só a
lista de permissão de `publicProfile()` (G21), com o texto do CV apenas sob o
segundo consentimento e filtrado (G23). Inclui o refactor do montador da
lista de permissão, a ação `candidate:discover` nas rotas, o limite de busca,
as dicas de visibilidade e o consentimento do CV para Recrutadores (ADR-014).

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
1. MUST refatorar `publicProfile()` em `allowlistedProfile(key, visibilities)` com mapeamento puro `toAllowlistedProfile`, mantendo `publicProfile(slug)` como invólucro e `tests/public-profile.test.ts` intacto e verde.
2. MUST fixar as visibilidades do diretório (`recruiters`, `public`) em constante no servidor; nenhum parâmetro da requisição amplia visibilidades nem campos; visibilidade desconhecida conta como privada.
3. MUST guardar `/recruiter/directory`, `/recruiter/directory/[id]` e `/recruiter/directory/[id]/image/[kind]` com `requirePage("candidate:discover")` antes de qualquer leitura.
4. MUST buscar por nome, headline e skills confirmadas, sem diferenciar caixa e acento, com `parseQuery`/`termRegexSql`; filtros de localização, modelo de trabalho e nível só onde o opt-in `public_*` está ligado; 20 por página; sem contagem nem pista de perfis Privados.
5. MUST limitar a 60 buscas por recrutador em 10 min por "grava e depois conta" em `recruiter_directory_query`, com o aviso "Tente de novo em instantes".
6. MUST mostrar o CV só com `public_cv` e por `publicCvMarkdown()`; o link `/p/` só para Público; para quem tem concessão, link para `/recruiter/<id>`; nenhum controle que peça ou crie concessão; nenhuma gravação além do registro de busca.
7. MUST fazer `setVisibilityAction` exigir também `access:manage` e manter `public_cv` em Recrutadores e Público (zerar só em Privado); atualizar as dicas das três opções (Recrutadores alcança quem se cadastrou como recrutador).
8. MUST registrar as rotas (`PAGE_POLICY`, `tests/e2e/routes.mjs` para a lista, `UNMEASURED_PAGES` com motivo para as de id, `config/e2e-spec-map.json` área `recruiter-directory`) e cobrir 375 px, axe, dicionário e `data-testid`.
</requirements>

## Subtasks
- [ ] 5.1 Refactor do montador da lista de permissão e testes de igualdade com `/p/`.
- [ ] 5.2 Consulta do diretório (parse puro, SQL, dobra de acento, filtros, paginação).
- [ ] 5.3 Limite de busca por recrutador.
- [ ] 5.4 Páginas de lista e perfil e rota de imagem, com guarda.
- [ ] 5.5 Visibilidade: guarda emprestada, consentimento do CV em Recrutadores, dicas.
- [ ] 5.6 Inventário e spec E2E `tests/e2e/ui/recruiter-directory.mjs` com fixtures Pública, Recrutadores e Privada.

## Implementation Details

Seguir a ADR-013, a ADR-014 e "Data flow" item 7 da TechSpec. A busca mora em
`src/core/candidate-directory.ts`, ao lado de `candidate-public.ts`.

### Relevant Files
- `src/core/candidate-public.ts` — `publicProfile()` (~138-248), `publicFactsFrom`, `publicImageKeyFrom`, `imageVersion`.
- `src/core/public-cv.ts` — `publicCvText()`, `publicCvMarkdown()` (~383-457).
- `src/core/search.ts`, `src/core/term.ts`, `src/core/synonyms.ts`; `src/core/db/repo.ts` (~600-680) — padrão regex + pré-filtro.
- `app/p/[slug]/page.tsx`, `app/p/[slug]/image/[kind]/route.ts` — página e imagem públicas a espelhar.
- `app/candidate/page.tsx`, `app/candidate/actions.ts` (`setVisibilityAction` ~174) — visibilidade e consentimento.
- `src/contexts/auth/domain/types.ts` (`VISIBILITIES`, `isVisibility`), `policy.ts`.
- `tests/public-profile.test.ts`, `tests/candidate-public-facts.test.ts`, `tests/candidate-images.test.ts`.

### Dependent Files
- `src/core/i18n/pt-BR.ts`, `en.ts` — `directory.*` e dicas de visibilidade.
- `proxy.ts`, `tests/architecture.test.ts`, `tests/support/entry-inventory.ts`, `tests/e2e/routes.mjs`, `config/e2e-spec-map.json`, `tests/e2e/setup.mjs`.
- `docs/engineering/rules/security.md` — G21–G23 citam o diretório como segundo consumidor da lista de permissão (sem afrouxar regra).

### Related ADRs
- [ADR-010](adrs/adr-010.md), [ADR-013](adrs/adr-013.md), [ADR-014](adrs/adr-014.md), [ADR-017](adrs/adr-017.md)

## Deliverables
- Diretório com busca, filtros e leitura de perfil só pela lista de permissão.
- Visibilidade decide a descoberta na requisição seguinte.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [ ] UT-060, UT-061, UT-062, UT-063, UT-064, UT-065, UT-066, UT-067, UT-068 — parse da busca e limite
- [ ] UT-069, UT-070, UT-071, UT-072, UT-073, UT-074 — lista de permissão, visibilidade e dicas
- [ ] IT-144, IT-145, IT-146 — montador e igualdade com `/p/`
- [ ] IT-147, IT-148, IT-149, IT-150, IT-151, IT-152, IT-153, IT-154 — busca, filtros e limite
- [ ] IT-155, IT-156, IT-157 — mudança de visibilidade e consentimento
- [ ] IT-158, IT-159, IT-160, IT-161, IT-162, IT-163 — perfil, imagem, guardas, sem efeito, links
- [ ] IT-164, IT-165, IT-166, IT-167, IT-168 — dois papéis, vazio, `/p/` de Recrutadores, export e inventário
- [ ] E2E-024, E2E-025 — busca, leitura e mudança de visibilidade
- [ ] E2E-026, E2E-027 — recusas e campos privados ausentes
- [ ] E2E-028 — 375 px e axe
- [ ] E2E-029 — dicas de visibilidade

## Success Criteria
- Every assigned test case implemented and passing
- Perfil Privado nunca aparece nem é lido pelo diretório
- Campos do diretório iguais aos do perfil público
- Revisão L2 (`/p/`, auth) com SHIP
