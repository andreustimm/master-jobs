# Governança das regras de desenvolvimento

**Status (24/09/2026):** as tarefas 01 a 10 foram entregues e as issues
#195 a #204 estão fechadas. A verificação final (task_11) **não certificou** a
governança como concluída: restam três pendências P0, descritas em
[_final-report.md](_final-report.md). O texto abaixo continua como fotografia
da auditoria.

Este pacote propõe como preservar, organizar e verificar as regras do Master Jobs. A etapa de auditoria criou apenas documentos nesta pasta; a PR deste pacote documenta essa entrega. Nenhuma regra vigente, skill, configuração, teste, workflow, proteção do GitHub ou dado do produto foi alterado por esta PR. As melhorias são entregas posteriores das tarefas planejadas.

## Execução do plano

O [épico #194](https://github.com/andreustimm/master-jobs/issues/194) reúne as 11 ações no [GitHub Project 3](https://github.com/users/andreustimm/projects/3). Status, prioridade, responsável e dependências operacionais são mantidos no GitHub. Os frontmatters, caixas e grafo deste pacote preservam a fotografia original do planejamento; não devem ser atualizados como um segundo tracker.

As entregas de instruções, skills e gates coordenam-se com [#188](https://github.com/andreustimm/master-jobs/issues/188), que integra o protocolo de gestão GitHub. Esta auditoria não substitui essa entrega nem representa o estado global de outras tarefas.

## Leitura

| Documento | Pergunta respondida |
|---|---|
| [_prd.md](_prd.md) | Qual problema será resolvido, com quais limites e resultados? |
| [_audit.md](_audit.md) | Onde está cada regra, o que a verifica e o que falta? |
| [_evidence.md](_evidence.md) | O que cada teste/gate realmente observa, e quando roda? |
| [_techspec.md](_techspec.md) | Como organizar as fontes e resolver as contradições sem perder regras? |
| [_user_stories.md](_user_stories.md) | Quais necessidades orientam a implementação? |
| [_tasks.md](_tasks.md) | Em que ordem implementar, com quais dependências e entregas? |
| [_tests.md](_tests.md) | Como aceitar ou reprovar cada entrega futura? |
| [_validation.md](_validation.md) | O que foi efetivamente verificado nesta auditoria? |

## Resultado principal

Há proteções comportamentais importantes: preservação do funil durante sync, transação entre candidatura e evento, comparação de FKs no PostgreSQL, cotas concorrentes e inspeção real do cache do service worker. A matriz mantém essas proteções; não propõe substituí-las por checagens textuais.

As prioridades são:

1. Vincular a promoção ao commit cujo CI terminou com sucesso. O workflow recebe um resultado de CI e depois usa a ponta atual de `origin/dev`; o disparo manual também passa sem comprovar CI daquele commit.
2. Tornar obrigatórias no servidor as restrições de branch e a intervenção humana em produção. Na consulta de 22/09/2026, não havia rulesets nem proteção nas três branches, e o ambiente `Production` não tinha regras de proteção.
3. Fechar lacunas na descoberta de páginas/actions, nas fronteiras de rede e nos procedimentos de migração. A skill de migrations ainda instrui SQLite/libSQL, embora o runtime e os testes usem PostgreSQL.
4. Consolidar a documentação e tornar explícito o alcance dos gates. O CI executa Vitest e o navegador da PWA, mas não a suíte geral `test:e2e` de interface/acessibilidade.

Esses achados não demonstram que ocorreu uma promoção indevida, exposição de dados ou perda de histórico. Demonstram condições não impedidas pelas verificações examinadas. Cada inferência está ligada à sua evidência.

## Baseline e limites

- Worktree isolada da auditoria, com `HEAD` destacado e inicialmente limpa.
- Commit: `463688f3704fdd2187732edba798acd1d81a1070`; `dev` e `origin/dev` locais apontavam para o mesmo commit. Não foi feito fetch nem presumida a atualidade de todas as refs remotas.
- Consulta ao GitHub: **2026-09-22 13:56:57 UTC / 10:56:57 America/Sao_Paulo**, somente leitura.
- Node local: `v24.14.0`; o projeto exige `^24.19.0`. Nenhuma suíte de runtime foi executada nesta tarefa documental.
- Outra worktree, `perf/filtro-salarial`, tinha nove alterações pendentes; foi preservada.
- Os IDs `G`, `E`, `S`, `C` e `V` deste pacote identificam regras, evidências, skills, conflitos e critérios de validação. São rastreabilidade da proposta, não um novo motor de execução.

Regras continuam valendo sem invocação de skill. Os documentos propostos em `docs/engineering/rules/` ainda **não existem por efeito deste trabalho**; seus caminhos são destinos de implementação futura.
