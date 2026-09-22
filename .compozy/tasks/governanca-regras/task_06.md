---
status: pending
title: "Consolidar entrada e regras canônicas por domínio"
type: documentation
complexity: medium
priority: P1
dependencies: [task_01, task_03, task_04, task_05]
---

# 06 — Consolidar entrada e regras canônicas por domínio

**Fotografia do plano: planejada, não executada na auditoria.** Execução canônica: [#200](https://github.com/andreustimm/master-jobs/issues/200) no GitHub Project 3; os campos e caixas locais não acompanham o status operacional. Dependências: [task_01](task_01.md), [task_03](task_03.md), [task_04](task_04.md), [task_05](task_05.md).

## Escopo

Migrar a organização documental por obrigação, preservando todas as regras válidas. Corrigir estado obsoleto e contradições segundo as decisões comprovadas das tarefas anteriores, sem mover política para uma skill opcional.

Ler [_prd.md](_prd.md), [_techspec.md](_techspec.md), [_audit.md](_audit.md) e [_tests.md](_tests.md). Regras rastreadas: **G01–G84, com atenção a G15, G60–G64, G68, G72, G83**. Evidências da auditoria: **E01, E10, E22, E28, E29**, em [_evidence.md](_evidence.md). Revalidar estas referências antes de implementar; elas descrevem a baseline auditada.

## Subtarefas

- [ ] Criar as seis referências e índice propostos na seção 3 da especificação, atribuindo um destino primário a cada G.
- [ ] Reescrever a entrada com invariantes críticas, roteador obrigatório e fluxo curto; preservar bloco Next e symlinks.
- [ ] Separar relatos históricos, comandos, contagens e estado atual nos lugares apropriados, mantendo links e razões.
- [ ] Revisar C01–C22 sem enfraquecer salvaguardas; marcar dívida ainda não implementada com estado verdadeiro.

## Arquivos de referência e provável alteração

- [AGENTS.md](../../../AGENTS.md)
- [CLAUDE.md](../../../CLAUDE.md)
- [.codex/config.toml](../../../.codex/config.toml)
- [docs/architecture.md](../../../docs/architecture.md)
- [docs/data-model.md](../../../docs/data-model.md)
- [docs/security.md](../../../docs/security.md)
- [docs/engineering/deploy.md](../../../docs/engineering/deploy.md)
- [docs/engineering/workflow.md](../../../docs/engineering/workflow.md)

A lista orienta investigação; não autoriza editar arquivo fora do escopo nem exige alteração quando a prova já for suficiente. Novos destinos documentais são os definidos na especificação.

## Entregáveis

- [ ] AGENTS conciso e seis referências por domínio, com inventário de equivalência.
- [ ] Docs de estado corrigidos e fontes/links compartilhados entre os harnesses.

## Critérios de aceitação

- [ ] Os 84 IDs têm destino e nenhuma obrigação válida é descartada.
- [ ] Regras críticas são legíveis antes de invocar skill; CLAUDE continua symlink para AGENTS.
- [ ] Não há regra oposta apresentada como vigente; versões e contagens copiadas não comandam o produto.

## Validação

Casos de propriedade desta tarefa: **V06-01, V06-02, V06-03, V06-04**. Entradas adversas e observáveis estão em [_tests.md](_tests.md); nenhum desses casos foi executado nesta auditoria.

Executar V06-01 a V06-04 por leitura comparativa, resolução dos symlinks e checagem estrutural de links/IDs. Não executar suite de runtime se o diff permanecer somente documental.

Registrar ambiente, comando, diff/commit e resultado; preservar falhas e limitações. Antes de PR, cumprir documentação, changelogs, revisão e QA aplicáveis conforme a regra vigente. Não marcar concluída pela mera existência dos artefatos.
