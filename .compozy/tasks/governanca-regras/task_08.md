---
status: pending
title: "Executar browser no CI e explicitar alcance do QA"
type: testing
complexity: high
priority: P1
dependencies: [task_03, task_07]
---

# 08 — Executar browser no CI e explicitar alcance do QA

**Fotografia do plano: planejada, não executada na auditoria.** Execução canônica: [#202](https://github.com/andreustimm/master-jobs/issues/202) no GitHub Project 3; os campos e caixas locais não acompanham o status operacional. Dependências: [task_03](task_03.md), [task_07](task_07.md).

## Escopo

Tornar a cobertura de interface descoberta e executada no fluxo adequado. Fechar aprovação silenciosa por rota omitida/redirect e ligar o browser geral ao CI, preservando a diferença entre teste automatizado e jornada real.

Ler [_prd.md](_prd.md), [_techspec.md](_techspec.md), [_audit.md](_audit.md) e [_tests.md](_tests.md). Regras rastreadas: **G14, G16, G29, G30, G34, G35, G55, G56, G69**. Evidências da auditoria: **E02, E13, E17–E19, E27**, em [_evidence.md](_evidence.md). Revalidar estas referências antes de implementar; elas descrevem a baseline auditada.

## Subtarefas

- [ ] Inventariar rotas e perfis necessários, incluindo dinâmicas/exceções com justificativa; confirmar destino antes de inspecionar conteúdo.
- [ ] Ligar UI/axe aplicáveis ao CI com build de produção, PostgreSQL isolado, auth real e propagação de falha.
- [ ] Preservar PWA e definir amostragem de temas/larguras/locales, com negativos de tradução/contraste/overflow.
- [ ] Melhorar referências do tracker sem confundir schema com execução e atualizar/retestar jornadas visíveis afetadas.

## Arquivos de referência e provável alteração

- [.github/workflows/ci.yml](../../../.github/workflows/ci.yml)
- [tests/e2e/ui.mjs](../../../tests/e2e/ui.mjs)
- [tests/e2e/a11y.mjs](../../../tests/e2e/a11y.mjs)
- [tests/pwa-chrome.test.ts](../../../tests/pwa-chrome.test.ts)
- [docs/qa/README.md](../../../docs/qa/README.md)
- [.claude/skills/qa-report/scripts/materialize_state.py](../../../.claude/skills/qa-report/scripts/materialize_state.py)

A lista orienta investigação; não autoriza editar arquivo fora do escopo nem exige alteração quando a prova já for suficiente. Novos destinos documentais são os definidos na especificação.

## Entregáveis

- [ ] Lane de browser obrigatório conforme contrato e inventário de alcance/exceções.
- [ ] QA com referências verificáveis e registros honestos de Pass/Blocked.

## Critérios de aceitação

- [ ] Uma rota nova não fica fora da medição sem decisão explícita.
- [ ] CI reprova falha real de UI/axe e não mede login no lugar de página privada.
- [ ] QA continua exigindo interface pública, refresh e leitura independente; dados de produção nunca entram na fixture.

## Validação

Casos de propriedade desta tarefa: **V08-01, V08-02, V08-03, V08-04, V08-05**. Entradas adversas e observáveis estão em [_tests.md](_tests.md); nenhum desses casos foi executado nesta auditoria.

Executar browser no ambiente isolado suportado e demonstrar falha induzida segura. Rodar targeted QA das jornadas afetadas após checks/E2E; full fica exigido no release candidate conforme README, sem inventar sessão para docs-only.

Registrar ambiente, comando, diff/commit e resultado; preservar falhas e limitações. Antes de PR, cumprir documentação, changelogs, revisão e QA aplicáveis conforme a regra vigente. Não marcar concluída pela mera existência dos artefatos.
