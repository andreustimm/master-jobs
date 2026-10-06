---
status: pending
title: "Fundação: schema, domínio puro, flow cookie, e-mails e documentos legais"
type: backend
complexity: high
---

# Fundação: schema, domínio puro, flow cookie, e-mails e documentos legais

## Overview

Entrega o contrato de dados e as peças puras de que todo o login social
depende: as tabelas `auth_identity` e `auth_signup` e as colunas novas de
`auth_user` em migração aditiva, os parsers de configuração e gates de
ambiente, o cookie cifrado do fluxo OIDC, os construtores de e-mail
localizados com o sink em arquivo, e a leitura dos documentos legais
versionados.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
1. MUST criar `auth_identity` e `auth_signup` e as colunas de `auth_user` exatamente como em "Data Models" da TechSpec, numa migração **aditiva** gerada por `pnpm db:generate`, com `onDelete` declarado em toda FK (G20).
2. MUST registrar as tabelas novas em `scripts/migration/select-production.ts` para `tests/postgres-schema.test.ts` passar.
3. MUST implementar `parseOidcConfig`, `socialAvailable`, `issuerFor`, `parseSignupLimits` e `mailSinkDir` como funções puras em `src/contexts/auth/domain/`, sem relógio, rede ou banco (regra 4), com mensagens que nomeiam variáveis, nunca valores (regra 16).
4. MUST implementar `sealFlow`/`openFlow` (AES-GCM, chave derivada de segredo existente, 10 minutos), `safeNext` e `landingFor`.
5. MUST implementar os construtores de `src/contexts/auth/app/account-emails.ts` (código, boas-vindas, conta já existe, provedor ligado/desligado, recuperação) com chaves `email.*` em pt-BR e en no dicionário.
6. MUST acrescentar `fileMailer` e fazer `configuredMailer` usá-lo só quando `JHO_MAIL_SINK` estiver definido e `JHO_ENV` não for `production`.
7. MUST criar `content/legal/{terms,privacy}.{pt-BR,en}.md` com front matter `version` e texto **original** na estrutura padrão da LGPD (contato `contato@mastertimm.com.br`), e `src/core/legal.ts` para ler documento e versão.
8. MUST acrescentar a purga de `auth_signup` (pendente > 24 h, concluído > 30 dias) ao job de manutenção existente.
9. SHOULD documentar as variáveis novas em `docs/engineering/deploy.md`.
</requirements>

## Subtasks
- [ ] 1.1 Schema Drizzle, migração aditiva, registro em `select-production.ts` e teste de upgrade.
- [ ] 1.2 Parsers puros de configuração OIDC, limites de cadastro, sink e gate de emissor.
- [ ] 1.3 Cookie cifrado do fluxo, `safeNext` e `landingFor`.
- [ ] 1.4 Construtores de e-mail localizados e chaves i18n.
- [ ] 1.5 `fileMailer` e seleção em `configuredMailer`.
- [ ] 1.6 Documentos legais versionados e leitor.
- [ ] 1.7 Purga de cadastros pendentes e concluídos no job de manutenção.
- [ ] 1.8 Variáveis novas documentadas.

## Implementation Details

Seguir "Data Models", "Core Interfaces" e "Component Overview" da TechSpec.
Padrão de config pura: `src/core/storage/config.ts`. Padrão de mailer:
`src/contexts/auth/infra/resend-mailer.ts`.

### Relevant Files
- `src/core/db/schema.ts` — tabelas `auth_*` (linhas ~1543–1696).
- `drizzle/postgres/` — migrações; última `0033`/`0034`.
- `scripts/migration/select-production.ts` — `postSnapshotTables`.
- `tests/postgres-upgrade.test.ts` — padrão de teste de upgrade.
- `src/contexts/auth/domain/public-origin.ts` — `firstNonEmpty` e origem pública.
- `src/contexts/auth/domain/open-mode.ts` — `isLocalProcess`.
- `src/contexts/auth/ports-mailer.ts`, `src/contexts/auth/infra/resend-mailer.ts` — porta e adapters de e-mail.
- `src/core/i18n/pt-BR.ts`, `src/core/i18n/en.ts` — dicionário.
- `.github/workflows/manutencao-banco.yml` e o comando que ele chama — purga.

### Dependent Files
- `tests/fk-delete-intent.test.ts`, `tests/cov-db-schema.test.ts` — intenção de `ON DELETE`.
- `tests/postgres-schema.test.ts` — registro de tabelas.
- `docs/engineering/deploy.md` — variáveis.

### Related ADRs
- [ADR-009](adrs/adr-009.md) — modelo de dados e IP em HMAC.
- [ADR-011](adrs/adr-011.md) — e-mails e sink.
- [ADR-012](adrs/adr-012.md) — documentos legais e `next` seguro.
- [ADR-005](adrs/adr-005.md), [ADR-010](adrs/adr-010.md) — gates de ambiente e de emissor.

## Deliverables
- Migração aditiva aplicada e testada no upgrade.
- Módulos de domínio puros, flow cookie, construtores de e-mail, `fileMailer`, leitor legal e textos legais.
- Purga no job de manutenção.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [ ] UT-001, UT-002, UT-003, UT-004, UT-005, UT-006 — configuração e gates de ambiente
- [ ] UT-030, UT-031, UT-032, UT-033, UT-034, UT-035 — flow cookie, `safeNext`, `landingFor`
- [ ] UT-080, UT-081, UT-082, UT-083, UT-084, UT-085 — construtores de e-mail e sink
- [ ] UT-100, UT-101 — documentos legais
- [ ] IT-075 — sink ignorado em produção
- [ ] IT-101, IT-102, IT-103 — upgrade, `ON DELETE`, purga

## Success Criteria
- Every assigned test case implemented and passing
- `pnpm typecheck`, testes de schema/arquitetura e `pnpm check:instructions` verdes
- Migração classificada como aditiva por `src/core/db/migration-review.ts`
