---
status: pending
title: "Vincular promoção ao commit validado"
type: infrastructure
complexity: high
priority: P0
dependencies: []
---

# 01 — Vincular promoção ao commit validado

**Fotografia do plano: planejada, não executada na auditoria.** Execução canônica: [#195](https://github.com/andreustimm/master-jobs/issues/195) no GitHub Project 3; os campos e caixas locais não acompanham o status operacional. Dependências: nenhuma.

## Escopo

Corrigir a proveniência do código promovido nos caminhos automático e manual. Definir como o commit de versionamento recebe a validação necessária e tornar retentativas independentes de avanços posteriores de dev.

Ler [_prd.md](_prd.md), [_techspec.md](_techspec.md), [_audit.md](_audit.md) e [_tests.md](_tests.md). Regras rastreadas: **G45, G51, G52, G58, G59**. Evidências da auditoria: **E24, E25**, em [_evidence.md](_evidence.md). Revalidar estas referências antes de implementar; elas descrevem a baseline auditada.

## Subtarefas

- [ ] Modelar entrada, checks, SHA de release, ancestralidade e intervalo de schema; registrar a decisão antes de alterar o fluxo.
- [ ] Adicionar casos que reproduzam CI de A com dev em B, dispatch sem checks e retry após avanço de ref.
- [ ] Implementar seleção imutável e recusa antes de efeitos quando faltar comprovação ou confirmação de migração.
- [ ] Preservar versionamento, changelogs, releases idempotentes e retorno para dev; atualizar a documentação operacional.

## Arquivos de referência e provável alteração

- [.github/workflows/promover-para-staging.yml](../../../.github/workflows/promover-para-staging.yml)
- [.github/workflows/sincronizar-apos-main.yml](../../../.github/workflows/sincronizar-apos-main.yml)
- [scripts/release/promover-staging.ts](../../../scripts/release/promover-staging.ts)
- [tests/release-boundaries.test.ts](../../../tests/release-boundaries.test.ts)
- [tests/release-policy.test.ts](../../../tests/release-policy.test.ts)

A lista orienta investigação; não autoriza editar arquivo fora do escopo nem exige alteração quando a prova já for suficiente. Novos destinos documentais são os definidos na especificação.

## Entregáveis

- [ ] Workflow/helpers com política de SHA explícita e testes de falhas reais de seleção.
- [ ] Contrato de promoção e tratamento do commit de release documentados.

## Critérios de aceitação

- [ ] Nenhum caminho promove commit só porque outro SHA passou em CI.
- [ ] Dispatch obedece checks e guard de migração; retry não muda o alvo.
- [ ] Divergência não gera force-push; staging continua fast-forward e main continua dependente de ação humana.

## Validação

Casos de propriedade desta tarefa: **V01-01, V01-02, V01-03, V01-04, V01-05**. Entradas adversas e observáveis estão em [_tests.md](_tests.md); nenhum desses casos foi executado nesta auditoria.

Executar testes de release/workflow com repos temporários e API de fixture, incluindo os cinco negativos/positivos do catálogo. Rodar checks pertinentes ao diff; não disparar promoção de produção para validar.

Registrar ambiente, comando, diff/commit e resultado; preservar falhas e limitações. Antes de PR, cumprir documentação, changelogs, revisão e QA aplicáveis conforme a regra vigente. Não marcar concluída pela mera existência dos artefatos.

