---
status: pending
title: "Verificar resultado final e preparar handoff"
type: testing
complexity: medium
priority: P2
dependencies: [task_09, task_10]
---

# 11 — Verificar resultado final e preparar handoff

**Fotografia do plano: planejada, não executada na auditoria.** Execução canônica: [#205](https://github.com/andreustimm/master-jobs/issues/205) no GitHub Project 3; os campos e caixas locais não acompanham o status operacional. Dependências: [task_09](task_09.md), [task_10](task_10.md).

## Escopo

Conferir a implementação entregue contra este plano, atualizar o estado das evidências e preparar a entrega para dev. Separar configuração aplicada, testes passados, análise por leitura e verificações humanas pendentes.

Ler [_prd.md](_prd.md), [_techspec.md](_techspec.md), [_audit.md](_audit.md) e [_tests.md](_tests.md). Regras rastreadas: **G01–G84**. Evidências da auditoria: **E01–E34, reavaliadas no diff final**, em [_evidence.md](_evidence.md). Revalidar estas referências antes de implementar; elas descrevem a baseline auditada.

## Subtarefas

- [ ] Revalidar todos os IDs de regra/validação, destinos e resultados no commit/diff final; não carregar status Pass de outra revisão.
- [ ] Executar checks e browser/QA proporcionais no Node exigido, sem repetir suites já válidas sem motivo.
- [ ] Consultar em leitura as proteções e metadados operacionais que foram alterados; registrar pendência externa/humana como tal.
- [ ] Atualizar docs/changelogs, fazer deslop/deep-review conforme regras e preparar PR atribuída para dev quando a tarefa de implementação estiver autorizada a entregar.

## Arquivos de referência e provável alteração

- [AGENTS.md](../../../AGENTS.md)
- [docs/engineering/workflow.md](../../../docs/engineering/workflow.md)
- [docs/qa/README.md](../../../docs/qa/README.md)
- [CHANGELOG.md](../../../CHANGELOG.md)
- [USER_CHANGELOG.pt-BR.md](../../../USER_CHANGELOG.pt-BR.md)
- [USER_CHANGELOG.en.md](../../../USER_CHANGELOG.en.md)

A lista orienta investigação; não autoriza editar arquivo fora do escopo nem exige alteração quando a prova já for suficiente. Novos destinos documentais são os definidos na especificação.

## Entregáveis

- [ ] Relatório final com evidências atuais, escopo realizado e pendências explícitas.
- [ ] Handoff/PR para dev coerente com docs, QA, changelogs e revisão.

## Critérios de aceitação

- [ ] Nenhuma garantia é atribuída a teste não executado ou configuração não observada.
- [ ] As 84 obrigações seguem preservadas e os casos planejados têm resultado ou bloqueio justificado.
- [ ] Não há merge/publicação automática em main; limpeza só após merge confirmado e ausência de WIP.

## Validação

Casos de propriedade desta tarefa: **V11-01, V11-02, V11-03, V11-04**. Entradas adversas e observáveis estão em [_tests.md](_tests.md); nenhum desses casos foi executado nesta auditoria.

Executar V11 conforme o diff real. Se um P0 ainda estiver pendente, o relatório não certifica governança concluída. A auditoria de regras atual não substitui esta verificação futura da implementação.

Registrar ambiente, comando, diff/commit e resultado; preservar falhas e limitações. Antes de PR, cumprir documentação, changelogs, revisão e QA aplicáveis conforme a regra vigente. Não marcar concluída pela mera existência dos artefatos.
