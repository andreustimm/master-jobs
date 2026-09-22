---
status: pending
title: "Proteger rede, evidência e preparação sem envio"
type: backend
complexity: high
priority: P0
dependencies: []
---

# 04 — Proteger rede, evidência e preparação sem envio

**Fotografia do plano: planejada, não executada na auditoria.** Execução canônica: [#198](https://github.com/andreustimm/master-jobs/issues/198) no GitHub Project 3; os campos e caixas locais não acompanham o status operacional. Dependências: nenhuma.

## Escopo

Transformar as fronteiras críticas de aquisição proibida e preparação sem candidatura em contratos testáveis. Conservar alertas de e-mail, referência manual, fontes permitidas e a revisão de alegações profissionais.

Ler [_prd.md](_prd.md), [_techspec.md](_techspec.md), [_audit.md](_audit.md) e [_tests.md](_tests.md). Regras rastreadas: **G01, G09, G37, G73, G79**. Evidências da auditoria: **E11, E30, E31**, em [_evidence.md](_evidence.md). Revalidar estas referências antes de implementar; elas descrevem a baseline auditada.

## Subtarefas

- [ ] Localizar todos os transportes/entradas relevantes de aquisição e preparação, sem acessar LinkedIn ou enviar dados a ATS.
- [ ] Definir recusa por finalidade para LinkedIn direto/redirect e regras comuns de rede sem obrigar HEAD/HTML a virar JSON.
- [ ] Adicionar provas de zero submissão e fixture em que growth tenta contaminar evidência afirmada.
- [ ] Preservar SSRF, robots quando cabível, opt-ins e limites de ambiente; documentar os limites do controle sobre ferramentas externas de agente.

## Arquivos de referência e provável alteração

- [src/core/remote-url.ts](../../../src/core/remote-url.ts)
- [src/core/ingest/probe.ts](../../../src/core/ingest/probe.ts)
- [src/core/scrape/robots.ts](../../../src/core/scrape/robots.ts)
- [tests/remote-url.test.ts](../../../tests/remote-url.test.ts)
- [tests/cov-apply-dossier.test.ts](../../../tests/cov-apply-dossier.test.ts)
- [docs/linkedin-policy.md](../../../docs/linkedin-policy.md)

A lista orienta investigação; não autoriza editar arquivo fora do escopo nem exige alteração quando a prova já for suficiente. Novos destinos documentais são os definidos na especificação.

## Entregáveis

- [ ] Fronteiras de rede e preparação exercitadas com transportes falsos observáveis.
- [ ] Política operacional alinhada para texto manual/e-mail, provas profissionais e ações externas.

## Critérios de aceitação

- [ ] Nenhuma aquisição proibida ocorre nos casos diretos ou por redirect testados.
- [ ] Prep/dossiê/kit não envia candidatura nem passa a conter um adapter de submissão.
- [ ] Growth continua lacuna; evidência citada é rastreável; importação permitida permanece funcional.

## Validação

Casos de propriedade desta tarefa: **V04-01, V04-02, V04-03, V04-04**. Entradas adversas e observáveis estão em [_tests.md](_tests.md); nenhum desses casos foi executado nesta auditoria.

Executar negativos por transporte e as regressões de SSRF/ingestão/dossiê. Não usar rede real de LinkedIn, conta autenticada ou submissão de teste como técnica de verificação.

Registrar ambiente, comando, diff/commit e resultado; preservar falhas e limitações. Antes de PR, cumprir documentação, changelogs, revisão e QA aplicáveis conforme a regra vigente. Não marcar concluída pela mera existência dos artefatos.
