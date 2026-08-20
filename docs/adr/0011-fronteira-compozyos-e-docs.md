# ADR 0011 — A fronteira entre o CompozyOS e `docs/`

**Status:** aceita · 2026-08-20

## Contexto

O pedido foi: *"o ideal é utilizarmos a estrutura do compozy para os epics, prd,
techspec, adrs, etc."*

O repositório já tem um pé no CompozyOS, mas de **automação**:
`compozy/loops/job-sweep.yaml` sincroniza, pontua e propõe triagem contra o
daemon 0.3. Adotar a **forma dos documentos** é outra decisão, e confundi-las
faria a segunda entrar de carona na primeira sem nunca ter sido discutida.

## O que a ferramenta oferece, e o que ela não tem

`cy-create-spec` produz, por feature (`<slug>`): `_spec.md`, `_user_stories.md`,
`_tests.md`, `_dx.md` e `_uiux.md`. `cy-create-tasks` acrescenta `_tasks.md` e
`task_NN.md`, com a garantia de que **cada caso de `_tests.md` cai em
exatamente uma tarefa**.

Confrontando com as quatro palavras do pedido:

- **PRD e techspec** existem, mas **fundidos** num `_spec.md`. Quem pede dois
  recebe um.
- **Epic não é artefato.** A unidade é o slug. Agrupar slugs é convenção de
  nome, não estrutura que a ferramenta verifique.
- **ADR não existe.** Nenhuma das dez skills produz uma, e nenhum arquivo do
  spec guarda decisão com as alternativas descartadas.

A última lacuna é a que decide esta ADR, e há uma ironia útil nela: **esta
decisão é uma ADR, e o CompozyOS não teria onde guardá-la.** Isso não é
retórica — é a demonstração de que os dois gêneros têm ciclo de vida diferente.

## A assimetria

O CompozyOS documenta **trabalho em execução**: começo, meio, entrega. Quando a
feature acaba, o diretório dela é histórico.

`docs/adr/` documenta **decisão que sobrevive à entrega**, e sobrevive de
propósito: existe para que ninguém proponha reverter sem ler por que foi assim.
`vision.md` e `personas.md` não pertencem a slug nenhum. `backlog.md` é a fila
que decide qual slug nasce em seguida — ele precede o spec, não deriva dele.

Documentação aqui também **não é decoração**: `tests/architecture.test.ts` abre
`docs/engineering/context-map.md` por caminho literal e falha `pnpm check` se o
mapa divergir do schema. Mover esse arquivo é mexer em código.

## Decisão

**Conviver por fronteira, e a fronteira é o ciclo de vida.**

| Gênero | Onde mora | Por quê |
|---|---|---|
| Spec de feature, contrato de testes, grafo de tarefas, revisões | `.compozy/tasks/<slug>/` | Nasce e morre com a feature |
| ADR | `docs/adr/` | Sobrevive à feature, e é o que impede reverter sem ler |
| Visão, personas, user stories de produto | `docs/product/` | Não pertence a slug nenhum |
| Backlog | `docs/product/backlog.md` | Precede o spec; é a fila que o alimenta |
| Mapa de contextos, arquitetura, operação | `docs/engineering/` | Parte é teste de fitness |

O fluxo, então: **um item do backlog vira o insumo do `/cy-create-spec`; a ADR
que a feature eventualmente produzir volta para `docs/adr/`.**

## O que foi rejeitado, e por quê

**Migrar tudo para o CompozyOS.** Custaria reescrever ADR como spec — gênero que
ela não é — e aceitar que decisão estrutural passasse a morar dentro do
diretório de uma feature que um dia acaba. Em números: 51 arquivos `.md` em
`docs/`, e **63 referências a `docs/adr` em 23 arquivos**, incluindo `CLAUDE.md`
e `AGENTS.md`, cujas regras invioláveis citam ADRs por caminho. Mover sem
reescrever os ponteiros produz o pior estado possível: a regra continua escrita
e a justificativa dela some.

**Não adotar nada agora.** É o que o próprio `COMPOZY-OS.md` recomenda — rodar
uma jornada antes de decidir. Foi seguido pela metade, e deliberadamente: esta
ADR vem acompanhada da primeira jornada real, feita numa feature pequena, em vez
de decidir só por leitura de documentação. O que ela recomenda contra é decidir
no escuro, não decidir.

## Riscos aceitos

**A versão é 0.3.0-beta.17.** A extension `dev-cycle` 0.3.1 está em `error`,
`cy03 status` reporta `degraded`, e o `MIGRATION_GUIDE.md` oficial diverge da
máquina em três pontos — nos três a máquina venceu. A fronteira escolhida limita
a exposição: se a ferramenta quebrar ou for abandonada, `.compozy/tasks/` é
Markdown que continua legível, e nada em `docs/` — que é onde mora o que
sobrevive — depende dela.

**Duas convenções.** É o custo real desta decisão, e sem a tabela acima escrita
em algum lugar a fronteira apodrece na terceira feature: passa a haver dois
lugares plausíveis para a mesma coisa. Por isso a tabela está aqui, e por isso
`docs/README.md` aponta para ela.

## Consequências

- Feature nova começa por um item do backlog e ganha `.compozy/tasks/<slug>/`.
- ADR continua sendo escrita à mão em `docs/adr/`, numerada em sequência.
- `_tests.md` passa a ser o contrato que a implementação persegue — hoje o "o
  que ficou de fora" de UI-02 e UI-03 foi escrito **depois** da entrega.
