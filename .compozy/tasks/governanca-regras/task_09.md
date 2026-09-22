---
status: pending
title: "Adicionar gates leves de governança e PR"
type: infrastructure
complexity: high
priority: P1
dependencies: [task_02, task_07, task_08]
---

# 09 — Adicionar gates leves de governança e PR

**Fotografia do plano: planejada, não executada na auditoria.** Execução canônica: [#203](https://github.com/andreustimm/master-jobs/issues/203) no GitHub Project 3; os campos e caixas locais não acompanham o status operacional. Dependências: [task_02](task_02.md), [task_07](task_07.md), [task_08](task_08.md).

## Escopo

Impedir regressões verificáveis de fonte canônica, referências e metadata de entrega. Reutilizar os gates existentes e registrar a diferença entre declaração de revisão/QA e prova do comportamento, sem criar infraestrutura paralela de recibos.

Ler [_prd.md](_prd.md), [_techspec.md](_techspec.md), [_audit.md](_audit.md) e [_tests.md](_tests.md). Regras rastreadas: **G15, G43, G47, G49, G50, G53–G64, G72, G79, G84**. Evidências da auditoria: **E23–E29, E31**, em [_evidence.md](_evidence.md). Revalidar estas referências antes de implementar; elas descrevem a baseline auditada.

## Subtarefas

- [ ] Adicionar negativos de symlink/cópia, link/ID quebrado e exceção sem política, usando fontes documentais existentes.
- [ ] Cobrir criação e reaproveitamento de PR de trabalho/promoção/retorno, responsável e base correta.
- [ ] Associar evidência de revisão ao diff pertinente e exigir impacto docs/QA ou justificativa proporcional; não tratar campo preenchido como verdade comprovada.
- [ ] Ligar checks ao CI/fluxo certo, manter validadores únicos de release/QA e demonstrar seleção docs-only versus executável.

## Arquivos de referência e provável alteração

- [package.json](../../../package.json)
- [tests/architecture.test.ts](../../../tests/architecture.test.ts)
- [tests/worktree-workflow.test.ts](../../../tests/worktree-workflow.test.ts)
- [tests/qa-tracker-gate.test.ts](../../../tests/qa-tracker-gate.test.ts)
- [.github/workflows/ci.yml](../../../.github/workflows/ci.yml)
- [.github/workflows/promover-para-staging.yml](../../../.github/workflows/promover-para-staging.yml)
- [.github/workflows/sincronizar-apos-main.yml](../../../.github/workflows/sincronizar-apos-main.yml)
- [.claude/skills/ship-pr/SKILL.md](../../../.claude/skills/ship-pr/SKILL.md)

A lista orienta investigação; não autoriza editar arquivo fora do escopo nem exige alteração quando a prova já for suficiente. Novos destinos documentais são os definidos na especificação.

## Entregáveis

- [ ] Checks estruturais e metadata com falhas acionáveis.
- [ ] Todos os produtores de PR tratam assignee e base; revisão e impacto têm referência atual.

## Critérios de aceitação

- [ ] Trocar symlink por cópia ou quebrar ID/link relevante reprova o gate.
- [ ] PR de retorno/reuso não fica sem responsável; exceções de base são nominadas.
- [ ] Uma revisão de diff antigo não é apresentada como aprovação atual; mudança documental não dispara suite de produto por ritual.

## Validação

Casos de propriedade desta tarefa: **V09-01, V09-02, V09-03, V09-04, V09-05**. Entradas adversas e observáveis estão em [_tests.md](_tests.md); nenhum desses casos foi executado nesta auditoria.

Executar validadores sobre cópias temporárias com regressões induzidas e fixtures da API de PR. Reconsultar configuração remota quando ela for parte da entrega; não abrir PR real apenas para experimentar o gate.

Registrar ambiente, comando, diff/commit e resultado; preservar falhas e limitações. Antes de PR, cumprir documentação, changelogs, revisão e QA aplicáveis conforme a regra vigente. Não marcar concluída pela mera existência dos artefatos.

