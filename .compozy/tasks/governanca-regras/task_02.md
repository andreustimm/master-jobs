---
status: pending
title: "Tornar proteções do GitHub efetivas"
type: infrastructure
complexity: high
priority: P0
dependencies: [task_01]
---

# 02 — Tornar proteções do GitHub efetivas

**Fotografia do plano: planejada, não executada na auditoria.** Execução canônica: [#196](https://github.com/andreustimm/master-jobs/issues/196) no GitHub Project 3; os campos e caixas locais não acompanham o status operacional. Dependências: [task_01](task_01.md).

## Escopo

Aplicar futuramente proteção remota compatível com o fluxo validado na tarefa 01. Exigir checks, impedir alteração destrutiva de branches permanentes e garantir intervenção humana antes de publicar produção, sem bypass geral para bots.

Ler [_prd.md](_prd.md), [_techspec.md](_techspec.md), [_audit.md](_audit.md) e [_tests.md](_tests.md). Regras rastreadas: **G43, G46, G48, G52**. Evidências da auditoria: **E23, E25, E26**, em [_evidence.md](_evidence.md). Revalidar estas referências antes de implementar; elas descrevem a baseline auditada.

## Subtarefas

- [ ] Reconsultar rulesets, branches, ambientes, recursos disponíveis e identidades com bypass; salvar evidência sem segredos.
- [ ] Desenhar as exceções mínimas de automação e o mecanismo humano viável, considerando autoria da PR e mantenedores disponíveis.
- [ ] Validar recusas e fluxos legítimos em ambiente descartável; preparar configuração concreta para a operação autorizada.
- [ ] Aplicar somente no escopo operacional autorizado da futura tarefa, conferir estado efetivo por GET e documentar recuperação sem remover proteções genericamente.

## Arquivos de referência e provável alteração

- [.github/workflows/promover-para-staging.yml](../../../.github/workflows/promover-para-staging.yml)
- [.github/workflows/sincronizar-apos-main.yml](../../../.github/workflows/sincronizar-apos-main.yml)
- [.github/workflows/migrate.yml](../../../.github/workflows/migrate.yml)
- [docs/engineering/workflow.md](../../../docs/engineering/workflow.md)

A lista orienta investigação; não autoriza editar arquivo fora do escopo nem exige alteração quando a prova já for suficiente. Novos destinos documentais são os definidos na especificação.

## Entregáveis

- [ ] Configuração efetiva e evidência antes/depois das regras e seus bypasses.
- [ ] Procedimento compatível com promoção, hotfix e retorno, com produção humana.

## Critérios de aceitação

- [ ] dev, staging e main estão protegidas contra delete/force-push e integrações fora da política.
- [ ] Bot não consegue publicar main/produção sem a intervenção humana definida.
- [ ] Fluxos legítimos continuam viáveis; configuração não aplicada não é relatada como concluída.

## Validação

Casos de propriedade desta tarefa: **V02-01, V02-02, V02-03, V02-04**. Entradas adversas e observáveis estão em [_tests.md](_tests.md); nenhum desses casos foi executado nesta auditoria.

Usar simulações seguras de autorização e consulta somente leitura ao repositório real. Se faltar recurso/permissão da plataforma, registrar o impedimento concreto e manter o item pendente; não simular proteção com hooks locais.

Registrar ambiente, comando, diff/commit e resultado; preservar falhas e limitações. Antes de PR, cumprir documentação, changelogs, revisão e QA aplicáveis conforme a regra vigente. Não marcar concluída pela mera existência dos artefatos.
