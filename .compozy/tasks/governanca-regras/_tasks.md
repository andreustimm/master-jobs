---
schema_version: "compozy.tasks/v2"
workflow: governanca-regras
graph:
  nodes:
    - id: task_01
      file: task_01.md
    - id: task_02
      file: task_02.md
    - id: task_03
      file: task_03.md
    - id: task_04
      file: task_04.md
    - id: task_05
      file: task_05.md
    - id: task_06
      file: task_06.md
    - id: task_07
      file: task_07.md
    - id: task_08
      file: task_08.md
    - id: task_09
      file: task_09.md
    - id: task_10
      file: task_10.md
    - id: task_11
      file: task_11.md
  edges:
    - from: task_01
      to: task_02
    - from: task_01
      to: task_06
    - from: task_03
      to: task_06
    - from: task_04
      to: task_06
    - from: task_05
      to: task_06
    - from: task_06
      to: task_07
    - from: task_03
      to: task_08
    - from: task_07
      to: task_08
    - from: task_02
      to: task_09
    - from: task_07
      to: task_09
    - from: task_08
      to: task_09
    - from: task_06
      to: task_10
    - from: task_08
      to: task_10
    - from: task_09
      to: task_11
    - from: task_10
      to: task_11
---

# Tarefas de implementação propostas

**Fotografia original: todas pendentes; nenhuma executada durante a auditoria.** O grafo usa a convenção `compozy.tasks/v2` encontrada nos slugs atuais do repositório; não foi iniciado um workflow Compozy. O estado operacional atual pertence às issues abaixo e ao [GitHub Project 3](https://github.com/users/andreustimm/projects/3), incluindo prioridade e dependências nativas. Os campos locais preservam a proposta original e não são um tracker concorrente.

Classificação de risco original (não substitui a Prioridade nativa do Project): 🔴 P0: proteção de produção, conta e dados. 🟠 P1: consistência do fluxo e comportamento. 🟡 P2: ampliação de cobertura e consolidação. A ordem numérica respeita as dependências; tarefas sem dependência podem avançar independentemente em futuras worktrees, sem implicar autorização para delegação nesta auditoria.

| Prioridade | Tarefa | Depende de | Entrega revisável |
|---|---|---|---|
| 🔴 P0 | [01 — Promoção vinculada ao commit validado](task_01.md) | — | Contrato de SHA/CI, dispatch e retries; testes de corrida e migração. |
| 🔴 P0 | [02 — Proteções efetivas no GitHub](task_02.md) | 01 | Branches protegidas, produção humana e bot com exceções mínimas, com evidência remota. |
| 🔴 P0 | [03 — Autorização e privacidade em toda entrada](task_03.md) | — | Inventário de superfícies, exceções seguras e provas de negação antes do efeito. |
| 🔴 P0 | [04 — Fronteiras de rede, evidência e envio](task_04.md) | — | LinkedIn e submissão protegidos; preparação sem enviar candidatura ou documentos ao empregador/ATS; evidência profissional verificável. |
| 🔴 P0 | [05 — Dados e migrations PostgreSQL](task_05.md) | — | Procedimento correto, upgrade populado, FKs explícitas e retenção concorrente segura. |
| 🟠 P1 | [06 — Fonte canônica e documentos por domínio](task_06.md) | 01, 03, 04, 05 | Entrada compacta, seis referências e mapeamento integral das 84 obrigações. |
| 🟠 P1 | [07 — Skills e procedimentos coerentes](task_07.md) | 06 | 14 skills, comandos e referências alinhados sem cópias por harness. |
| 🟠 P1 | [08 — Browser no CI e alcance explícito do QA](task_08.md) | 03, 07 | Descoberta de rotas, lane E2E e evidência de interface/jornada separadas. |
| 🟠 P1 | [09 — Gates de governança e metadata de PR](task_09.md) | 02, 07, 08 | Links/symlinks/exceções verificados e PRs com responsável, impacto e revisão atual. |
| 🟡 P2 | [10 — Fitness de domínio e frontend](task_10.md) | 06, 08 | Bump do scorer, fronteiras, tokens, adapters e fan-out com negativos relevantes. |
| 🟡 P2 | [11 — Verificação final e handoff](task_11.md) | 09, 10 | Matriz atualizada com resultados reais, pendências explícitas e entrega para dev. |

## Issues canônicas

Épico: [#194](https://github.com/andreustimm/master-jobs/issues/194).

| ID do plano | Issue de execução |
|---|---|
| `task_01` | [#195 — Vincular promoção ao commit validado](https://github.com/andreustimm/master-jobs/issues/195) |
| `task_02` | [#196 — Tornar proteções do GitHub efetivas](https://github.com/andreustimm/master-jobs/issues/196) |
| `task_03` | [#197 — Cobrir autorização e privacidade em toda entrada](https://github.com/andreustimm/master-jobs/issues/197) |
| `task_04` | [#198 — Proteger rede, evidência e preparação sem envio](https://github.com/andreustimm/master-jobs/issues/198) |
| `task_05` | [#199 — Alinhar integridade de dados e migrations PostgreSQL](https://github.com/andreustimm/master-jobs/issues/199) |
| `task_06` | [#200 — Consolidar entrada e regras canônicas por domínio](https://github.com/andreustimm/master-jobs/issues/200) |
| `task_07` | [#201 — Alinhar skills, comandos e referências](https://github.com/andreustimm/master-jobs/issues/201) |
| `task_08` | [#202 — Executar browser no CI e explicitar alcance do QA](https://github.com/andreustimm/master-jobs/issues/202) |
| `task_09` | [#203 — Adicionar gates leves de governança e PR](https://github.com/andreustimm/master-jobs/issues/203) |
| `task_10` | [#204 — Ampliar fitness de domínio e frontend](https://github.com/andreustimm/master-jobs/issues/204) |
| `task_11` | [#205 — Verificar resultado final e preparar handoff](https://github.com/andreustimm/master-jobs/issues/205) |

O mapa é de identidade; acompanhamento e replanejamento acontecem no GitHub. As ações 06, 07 e 09 devem reutilizar mudanças de [#188](https://github.com/andreustimm/master-jobs/issues/188) e da tarefa RULES onde houver sobreposição.

## Regras de execução futura

- Revalidar baseline, status/worktrees e instruções antes de iniciar cada tarefa; este plano não autoriza sobrescrever WIP de outra tarefa.
- P0s podem ser entregues separadamente. Não adiar proteção de produção até terminar a reorganização documental.
- Mudança de regra é revisada pelo efeito: preservar a proteção e registrar a razão de qualquer nova formulação. Falta de teste não autoriza remover a obrigação.
- Cada caso `Vxx-yy` em [_tests.md](_tests.md) tem exatamente um dono `task_xx`. Reutilizar testes existentes quando já observam a propriedade; não duplicar asserções de implementação.
- Tarefas que só mudam Markdown/metadados usam validação estrutural. Código, workflow ou script executável exige testes adequados; UI visível segue QA vivo.
- Encerrar uma tarefa só após evidência atual. Trabalho remoto ainda não configurado ou verificação humana pendente permanece pendente/bloqueado no relato, nunca passa por inferência.
- Deslop/deep-review e PR para `dev` seguem regras vigentes. Não executar promoção humana para `main` como parte automática deste plano.
