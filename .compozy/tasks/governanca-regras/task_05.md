---
status: pending
title: "Alinhar integridade de dados e migrations PostgreSQL"
type: backend
complexity: high
priority: P0
dependencies: []
---

# 05 — Alinhar integridade de dados e migrations PostgreSQL

**Fotografia do plano: planejada, não executada na auditoria.** Execução canônica: [#199](https://github.com/andreustimm/master-jobs/issues/199) no GitHub Project 3; os campos e caixas locais não acompanham o status operacional. Dependências: nenhuma.

## Escopo

Corrigir o procedimento de banco e qualificar a proteção das decisões. Distinguir ausência na fonte de descarte autorizado, verificar intenção explícita das FKs e provar upgrade de banco populado e concorrência relevante.

Ler [_prd.md](_prd.md), [_techspec.md](_techspec.md), [_audit.md](_audit.md) e [_tests.md](_tests.md). Regras rastreadas: **G02, G03, G20, G27, G28, G68, G75, G76, G80**. Evidências da auditoria: **E04, E05, E20–E22, E32**, em [_evidence.md](_evidence.md). Revalidar estas referências antes de implementar; elas descrevem a baseline auditada.

## Subtarefas

- [ ] Atualizar binding e playbook para PostgreSQL, caminhos atuais, backfill/constraint, locks e verificação aplicada; remover comandos SQLite da instrução vigente.
- [ ] Criar fixture de upgrade com dados anteriores e distinguir presença explícita de onDelete da comparação com pg_constraint.
- [ ] Exercitar ingestão contra decisões/eventos, rollback do funil e disputa entre retenção e candidatura; corrigir falhas sem ampliar descarte.
- [ ] Reconciliar TLS, credencial runtime/migration e metadados seguros de verificação; atualizar docs e exigir revisão humana onde o fluxo já exige.

## Arquivos de referência e provável alteração

- [.claude/skills/drizzle-safe-migrations/SKILL.md](../../../.claude/skills/drizzle-safe-migrations/SKILL.md)
- [.claude/skills/drizzle-safe-migrations/references/production-playbook.md](../../../.claude/skills/drizzle-safe-migrations/references/production-playbook.md)
- [src/core/db/schema.ts](../../../src/core/db/schema.ts)
- [tests/cov-db-schema.test.ts](../../../tests/cov-db-schema.test.ts)
- [tests/db-retention.test.ts](../../../tests/db-retention.test.ts)
- [tests/postgres-permissions.test.ts](../../../tests/postgres-permissions.test.ts)
- [docs/data-model.md](../../../docs/data-model.md)
- [docs/engineering/deploy.md](../../../docs/engineering/deploy.md)

A lista orienta investigação; não autoriza editar arquivo fora do escopo nem exige alteração quando a prova já for suficiente. Novos destinos documentais são os definidos na especificação.

## Entregáveis

- [ ] Procedimento PostgreSQL atual e teste de upgrade populado.
- [ ] FKs com intenção verificável e provas de preservação do funil sob falha/concorrência.

## Critérios de aceitação

- [ ] Nenhuma instrução operacional atual depende de SQLite/pragma ou journal antigo.
- [ ] Schema e DDL aplicados concordam, e intenção de delete é explícita.
- [ ] Ingestão/descarte não perde decisão; fixture de runtime não executa DDL nem escala privilégio.

## Validação

Casos de propriedade desta tarefa: **V05-01, V05-02, V05-03, V05-04, V05-05**. Entradas adversas e observáveis estão em [_tests.md](_tests.md); nenhum desses casos foi executado nesta auditoria.

Usar PostgreSQL Docker descartável para upgrade, concorrência, schema e permissões. Testar URLs fictícias representativas do provedor. Não executar migration ou rescore de produção; configuração implantada só pode ser certificada por evidência operacional separada.

Registrar ambiente, comando, diff/commit e resultado; preservar falhas e limitações. Antes de PR, cumprir documentação, changelogs, revisão e QA aplicáveis conforme a regra vigente. Não marcar concluída pela mera existência dos artefatos.
