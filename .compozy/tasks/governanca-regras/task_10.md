---
status: pending
title: "Ampliar fitness de domínio e frontend"
type: testing
complexity: high
priority: P2
dependencies: [task_06, task_08]
---

# 10 — Ampliar fitness de domínio e frontend

**Fotografia do plano: planejada, não executada na auditoria.** Execução canônica: [#204](https://github.com/andreustimm/master-jobs/issues/204) no GitHub Project 3; os campos e caixas locais não acompanham o status operacional. Dependências: [task_06](task_06.md), [task_08](task_08.md).

## Escopo

Fechar falsos negativos restantes dos gates de arquitetura, scorer, estilos e composição de dados. Preservar as provas comportamentais existentes e adicionar descoberta/negativos onde a regra é universal, sem tentar automatizar julgamento subjetivo.

Ler [_prd.md](_prd.md), [_techspec.md](_techspec.md), [_audit.md](_audit.md) e [_tests.md](_tests.md). Regras rastreadas: **G04–G13, G26, G29, G31–G35, G42, G65–G67, G69–G71, G73, G74, G77, G78, G81**. Evidências da auditoria: **E03, E07–E10, E18, E19, E30, E33, E34**, em [_evidence.md](_evidence.md). Revalidar estas referências antes de implementar; elas descrevem a baseline auditada.

## Subtarefas

- [ ] Criar prova de diff/bump e manter invalidação/rescore por candidato/trilha em fixture.
- [ ] Expandir análise de imports/domínios para sintaxes e dependências que escapam da regex, sem criar abstração sem necessidade. Remover relógio implícito do núcleo do scorer/freshness, preservando compatibilidade na composição e a regra de bump.
- [ ] Distinguir tokens semânticos em componentes da paleta do tema; complementar detecção de strings e estilos conforme o contrato de T08.
- [ ] Verificar adapters/configuração/seed e composições novas de tela; localizar provas existentes antes de escrever testes equivalentes.

## Arquivos de referência e provável alteração

- [tests/architecture.test.ts](../../../tests/architecture.test.ts)
- [tests/design.test.ts](../../../tests/design.test.ts)
- [tests/mobile.test.ts](../../../tests/mobile.test.ts)
- [tests/scoring.test.ts](../../../tests/scoring.test.ts)
- [tests/track-scoring.test.ts](../../../tests/track-scoring.test.ts)
- [tests/job-observation.test.ts](../../../tests/job-observation.test.ts)
- [tests/import-field-alias.test.ts](../../../tests/import-field-alias.test.ts)
- [tests/db-fan-out.test.ts](../../../tests/db-fan-out.test.ts)

A lista orienta investigação; não autoriza editar arquivo fora do escopo nem exige alteração quando a prova já for suficiente. Novos destinos documentais são os definidos na especificação.

## Entregáveis

- [ ] Gates de versão, fronteiras, tokens e inventários com negativos significativos.
- [ ] Regressões de aliases, neutralidade, seed, concorrência e fan-out preservadas/qualificadas.

## Critérios de aceitação

- [ ] Mudança semântica sem bump e dependência proibida por sintaxe alternativa são detectadas.
- [ ] Tema legítimo não é bloqueado junto com cor/tamanho proibido em componente.
- [ ] Composição nova de tela e re-seed com progresso têm comportamento observado; cobertura não é inferida pelo nome do arquivo.

## Validação

Casos de propriedade desta tarefa: **V10-01, V10-02, V10-03, V10-04, V10-05**. Entradas adversas e observáveis estão em [_tests.md](_tests.md); nenhum desses casos foi executado nesta auditoria.

Executar os casos V10 e suites afetadas, com rescore apenas em fixture. Depois dos ajustes, rodar checks/E2E aplicáveis; targeted QA se o comportamento visível mudar, ou declarar refactor sem mudança visível.

Registrar ambiente, comando, diff/commit e resultado; preservar falhas e limitações. Antes de PR, cumprir documentação, changelogs, revisão e QA aplicáveis conforme a regra vigente. Não marcar concluída pela mera existência dos artefatos.
