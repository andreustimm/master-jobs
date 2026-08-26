# ADR 0018 — Fronteira de confiança da varredura Compozy

**Status:** Aceita · 2026-08-26

## Contexto

Descrições de vagas chegam de fontes públicas e são texto controlado por
terceiros. O primeiro desenho do `job-sweep` entregava esse texto ao mesmo
agente Codex que executava comandos no workspace. Um anúncio malicioso poderia
ser interpretado como instrução e mover o funil, ler dados locais ou expor
segredos durante uma automação sem operador.

## Decisão

Separar a execução em duas sessões com responsabilidades incompatíveis:

1. `job-sweep-operator` executa somente `pnpm jho jobs sweep`. O comando faz
   sync, scoring e grava um snapshot JSON agregado em
   `.compozy/runtime/job-sweep-snapshot.json`; stdout contém apenas contagens e
   ids de fontes que falharam, nunca título, URL ou descrição.
2. `job-sweep-reviewer` possui `deny-all`; o Loop injeta o JSON via um nó
   `file-import`, portanto a sessão não precisa de filesystem, shell, rede ou
   ferramentas Compozy/MCP. O prompt trata cada campo de vaga como dado não
   confiável e a sessão não pode executar mutação.

O Loop fixa os nomes desses agentes, remove o input que permitia substituir o
agente por `general`, e encadeia `prepare → review`. O snapshot é ignorado
pelo Git e não é evidência versionada.

## Consequências

- Um anúncio não consegue alcançar o agente que tem capacidade de escrita.
- A análise continua automática e preserva a decisão humana no funil.
- A sessão de revisão é deliberadamente limitada: se o snapshot não puder ser
  importado, a execução fica bloqueada em vez de ampliar permissões.
- O comando `jobs sweep` é uma porta operacional reutilizável; a CLI continua
  expondo `jobs sync`, `jobs list` e `jobs show` para uso humano, fora do Loop.

## Alternativas rejeitadas

- **Apenas instrução no prompt:** não é uma fronteira contra prompt injection.
- **`general` com `NÃO use jho track`:** a permissão de shell continua ampla.
- **Desabilitar o agendamento:** remove o risco, mas também remove o objetivo
  operacional. A separação de sessões mantém a automação e o bloqueio.
