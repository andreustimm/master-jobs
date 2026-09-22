---
status: pending
title: "Alinhar skills, comandos e referências"
type: documentation
complexity: medium
priority: P1
dependencies: [task_06]
---

# 07 — Alinhar skills, comandos e referências

**Fotografia do plano: planejada, não executada na auditoria.** Execução canônica: [#201](https://github.com/andreustimm/master-jobs/issues/201) no GitHub Project 3; os campos e caixas locais não acompanham o status operacional. Dependências: [task_06](task_06.md).

## Escopo

Fazer cada skill ensinar o procedimento correspondente às regras canônicas, sem definir outra política. Revisar também referências, comandos e agente compartilhado; ajustes no procedimento de banco entregues em T05 permanecem a base.

Ler [_prd.md](_prd.md), [_techspec.md](_techspec.md), [_audit.md](_audit.md) e [_tests.md](_tests.md). Regras rastreadas: **G31, G50, G53–G57, G61, G62, G70, G72, G82, G84**. Evidências da auditoria: **E27–E29**, em [_evidence.md](_evidence.md). Revalidar estas referências antes de implementar; elas descrevem a baseline auditada.

## Subtarefas

- [ ] Percorrer S01–S14 e todas as referências usadas por seus procedimentos; eliminar bindings/links obsoletos sem copiar a política para outro harness.
- [ ] Resolver momento da revisão e política de exceção humana, autorização de triagem, fonte vazia e ausência de envio.
- [ ] Manter regras de QA, auditoria e revisão com finalidades/evidências distintas e cadência única.
- [ ] Validar frontmatter, exemplos e descoberta de skills; revisar a documentação que declara a avaliação das skills.

## Arquivos de referência e provável alteração

- [.claude/skills/ship-pr/SKILL.md](../../../.claude/skills/ship-pr/SKILL.md)
- [.claude/skills/deep-review/SKILL.md](../../../.claude/skills/deep-review/SKILL.md)
- [.claude/skills/qa-execution/SKILL.md](../../../.claude/skills/qa-execution/SKILL.md)
- [.claude/skills/qa-report/SKILL.md](../../../.claude/skills/qa-report/SKILL.md)
- [.claude/skills/job-triage/SKILL.md](../../../.claude/skills/job-triage/SKILL.md)
- [.claude/commands/vagas.md](../../../.claude/commands/vagas.md)
- [.claude/commands/fonte-nova.md](../../../.claude/commands/fonte-nova.md)
- [.claude/agents/fit-analyst.md](../../../.claude/agents/fit-analyst.md)
- [docs/engineering/skills-evaluation.md](../../../docs/engineering/skills-evaluation.md)

A lista orienta investigação; não autoriza editar arquivo fora do escopo nem exige alteração quando a prova já for suficiente. Novos destinos documentais são os definidos na especificação.

## Entregáveis

- [ ] 14 skills e consumidores coerentes com a política compartilhada.
- [ ] Exemplos e gatilhos proporcionais, com exceções estreitas e links resolvíveis.

## Critérios de aceitação

- [ ] Nenhum procedimento amplia autorização ou permite envio/scraping proibidos.
- [ ] A skill não concede a si mesma dispensa de FIX_BEFORE_SHIP nem declara jornada Pass sem prova.
- [ ] Os três harnesses continuam lendo a mesma cópia canônica.

## Validação

Casos de propriedade desta tarefa: **V07-01, V07-02, V07-03, V07-04**. Entradas adversas e observáveis estão em [_tests.md](_tests.md); nenhum desses casos foi executado nesta auditoria.

Fazer walkthrough documental dos casos V07, checar links/frontmatter e testar qualquer script efetivamente modificado. Não rodar todos os procedimentos das skills nem executar comandos de produção para validar texto.

Registrar ambiente, comando, diff/commit e resultado; preservar falhas e limitações. Antes de PR, cumprir documentação, changelogs, revisão e QA aplicáveis conforme a regra vigente. Não marcar concluída pela mera existência dos artefatos.

