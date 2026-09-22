---
status: pending
title: "Cobrir autorização e privacidade em toda entrada"
type: backend
complexity: high
priority: P0
dependencies: []
---

# 03 — Cobrir autorização e privacidade em toda entrada

**Fotografia do plano: planejada, não executada na auditoria.** Execução canônica: [#197](https://github.com/andreustimm/master-jobs/issues/197) no GitHub Project 3; os campos e caixas locais não acompanham o status operacional. Dependências: nenhuma.

## Escopo

Descobrir a superfície exposta e provar negação antes de leitura/efeito. Consolidar exceções pré-sessão e de serviço, proteger modo de autenticação por ambiente e complementar as regressões de conta, perfil público, segredos e cache.

Ler [_prd.md](_prd.md), [_techspec.md](_techspec.md), [_audit.md](_audit.md) e [_tests.md](_tests.md). Regras rastreadas: **G14, G16–G25, G36, G38–G41, G79**. Evidências da auditoria: **E12–E19, E31**, em [_evidence.md](_evidence.md). Revalidar estas referências antes de implementar; elas descrevem a baseline auditada.

## Subtarefas

- [ ] Inventariar páginas, handlers e exports de Server Actions, incluindo formatos fora de actions.ts; classificar cada exceção estreita.
- [ ] Criar casos negativos com sessão/escopo forjados e instrumentar ordem dos efeitos, reutilizando a matriz de política.
- [ ] Fechar lacunas comprovadas de auth por ambiente, vínculo/cadastro, reset concorrente, perfil público e BYOK; preservar contratos seguros existentes.
- [ ] Atualizar cenários de QA afetados e documentação das exceções, consentimento do CV e limites do cache.

## Arquivos de referência e provável alteração

- [tests/architecture.test.ts](../../../tests/architecture.test.ts)
- [src/contexts/auth/domain/policy.ts](../../../src/contexts/auth/domain/policy.ts)
- [tests/auth-policy.test.ts](../../../tests/auth-policy.test.ts)
- [tests/password-reset.test.ts](../../../tests/password-reset.test.ts)
- [tests/public-profile.test.ts](../../../tests/public-profile.test.ts)
- [tests/pwa-chrome.test.ts](../../../tests/pwa-chrome.test.ts)
- [tests/e2e/ui.mjs](../../../tests/e2e/ui.mjs)

A lista orienta investigação; não autoriza editar arquivo fora do escopo nem exige alteração quando a prova já for suficiente. Novos destinos documentais são os definidos na especificação.

## Entregáveis

- [ ] Inventário descoberto com política por superfície e falha em entrada desconhecida.
- [ ] Correções e testes de composição que negam acesso antes do efeito, com exceções documentadas.

## Critérios de aceitação

- [ ] Nova entrada não passa despercebida por nome de arquivo ou forma de export.
- [ ] Sessão alheia/emprestada e IDs forjados não leem ou alteram dados fora do escopo.
- [ ] Modo aberto é recusado onde não permitido; perfil/credenciais/cache seguem allowlists e consentimentos explícitos. Consentimento de CV não libera piso/contatos protegidos no texto público.

## Validação

Casos de propriedade desta tarefa: **V03-01, V03-02, V03-03, V03-04, V03-05, V03-06**. Entradas adversas e observáveis estão em [_tests.md](_tests.md); nenhum desses casos foi executado nesta auditoria.

Executar casos auth/DB e navegador pertinentes com dados sintéticos, além das regressões de senha, reset, perfil e SW. Mudança visível exige targeted QA após checks/E2E; nenhuma credencial real serve de fixture.

Registrar ambiente, comando, diff/commit e resultado; preservar falhas e limitações. Antes de PR, cumprir documentação, changelogs, revisão e QA aplicáveis conforme a regra vigente. Não marcar concluída pela mera existência dos artefatos.
