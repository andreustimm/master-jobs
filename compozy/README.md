# Integração com CompozyOS 0.3

O `master-jobs` roda perfeitamente sozinho pela CLI. O Compozy entra quando
você quiser uma triagem assistida recorrente além da varredura de produção já
agendada em `.github/workflows/varredura.yml`.

## Estado

| Item | Situação |
|---|---|
| `loops/job-sweep.yaml` | Fonte local v4 (aguarda publicação após a migração segura) |
| Registro do workspace | Reutilizado: `ws_aeeecdeefa1c0383` (`mvp`) |
| Automation job (agendamento) | Pausado durante a migração: `job-sweep-weekdays` permanece único, mas desabilitado |

## Por que Compozy e não um cron

Um cron roda um comando. O que se quer aqui é diferente: sincronizar, pontuar
e **julgar** — a triagem exige um agente lendo a vaga contra o perfil. É esse
o trabalho que o Loop encapsula, com contrato explícito (`definition_of_done`),
teto de iterações e detecção de falta de progresso.

## Pré-requisitos

O CompozyOS 0.3 roda isolado do Compozy 0.2.15 de produção, via wrapper:

```bash
export CY03_WORKSPACE="<repo>"  # o wrapper usa um lab se isto for omitido
~/bin/cy03 daemon start           # sobe o daemon 0.3 em :2123
~/bin/cy03 status --json          # confirma daemon e provedor
```

O wrapper injeta `COMPOZY_HOME=~/.compozy-os` e `HOME=~/.compozy-os-home` para
não colidir com a instalação de produção.

## Sequência de ativação

A ordem é parte do contrato: daemon, workspace, validação e criação do Loop,
execução manual, registro da evidência e, somente depois, agendamento. Se uma
etapa falhar, pare nela; não crie um agendamento parcial.

### 1. Registrar o workspace

```bash
~/bin/cy03 workspace info "$CY03_WORKSPACE" --json
# Somente se o comando anterior informar que o diretório não está registrado:
~/bin/cy03 workspace add "$CY03_WORKSPACE" --name master-jobs --json
```

Se o daemon estiver parado ou o provedor padrão não estiver pronto, registre o
diagnóstico e pare aqui. Se o workspace ou o Loop já existir, reutilize o
recurso retornado; não crie uma segunda automação para contornar um erro de
duplicidade.

### 2. Validar e publicar o Loop

```bash
cd "<repo>"

~/bin/cy03 loop validate --file compozy/loops/job-sweep.yaml --json
~/bin/cy03 loop list --json
# Somente se job-sweep ainda não existir; para publicar uma revisão existente,
# informe a versão observada em --expected-version.
~/bin/cy03 loop create --file compozy/loops/job-sweep.yaml --json
# Para atualizar uma definição existente, publique a nova versão com CAS:
~/bin/cy03 loop create --file compozy/loops/job-sweep.yaml \
  --expected-version "<versão observada>" --json
```

### 3. Rodar manualmente

```bash
# uma vez, à mão
~/bin/cy03 loop run --name job-sweep --workspace "$CY03_WORKSPACE" --json

# acompanhar
~/bin/cy03 loop runs --loop job-sweep --workspace "$CY03_WORKSPACE" --json
~/bin/cy03 loop status --run-id "<run-id>" --workspace "$CY03_WORKSPACE" --json
```

Antes de seguir, registre nesta seção o id da execução, o estado terminal e a
presença dos campos `status`, `summary` e `candidates`. Não registre credenciais,
tokens nem valores de ambiente. Uma execução interrompida ou sem esse contrato
de saída não autoriza o agendamento.

### 4. Evidência da execução manual

- Run id: `looprun-a066b558ff6b112d`
- Estado terminal: `done` em 2026-08-25 23:46:52 UTC (definição v3, `min_fit=55`)
- Saída: `status`, `summary` e `candidates` presentes; `status: completed`
- Falhas de fonte observadas: nenhuma (`sources_failed: []`; 15 fontes sincronizadas)
- Resultado do sync: 5.530 vagas lidas, 18 novas, 127 atualizadas e 18 fechadas;
  uma recomendação foi devolvida (`descartar`) sem mover o funil.

Depois da publicação da v4, repita a execução manual e substitua esta evidência
pela nova saída. A execução v4 precisa comprovar as duas sessões: o operador
retorna somente agregados e o revisor recebe o snapshot por `file-import` em
uma sessão `deny-all`.

### 5. Agendar, somente após a evidência manual

```bash
~/bin/cy03 automation jobs --loop job-sweep --workspace "$CY03_WORKSPACE" --json
# Somente se a consulta anterior não retornar o job job-sweep-weekdays:
~/bin/cy03 automation jobs create --name job-sweep-weekdays --scope workspace \
  --workspace "$CY03_WORKSPACE" --loop job-sweep --schedule "0 9 * * 1-5" \
  --enabled --json
~/bin/cy03 automation jobs history "<job-id>" --last 10 --json
# Depois da execução manual da v4 e da inspeção dos dois agentes:
~/bin/cy03 automation jobs update "<job-id>" --enabled --json
```

Se a consulta já retornar `job-sweep-weekdays`, registre o id e o agendamento
existentes e não execute `create` novamente. Se estiver desabilitado, só
habilite depois da evidência manual da v4; a flag `--enabled` é a única mudança
necessária.

Evidência do agendamento registrado após a execução manual da v3 (job mantido
desabilitado até a v4):

- Job id: `job-329819d4153adbd0` (pausado durante a migração da v3 para a v4)
- Criado em: 2026-08-25 22:12:10 UTC
- Schedule: `0 9 * * 1-5`; desabilitado; escopo `workspace`
- Próxima execução: nenhuma enquanto a definição segura não tiver execução manual
- Consulta idempotente após a criação: exatamente 1 job para `job-sweep`

## O que o Loop faz

`job-sweep` recebe `min_fit` (padrão 55) e executa duas etapas fixas:
`job-sweep-operator` roda `pnpm jho jobs sweep`, que sincroniza e repontua sem
imprimir texto de vagas e grava o snapshot ignorado; depois
`job-sweep-reviewer` recebe esse snapshot por `file-import` em uma sessão
`deny-all`, trata cada campo de vaga como dado não confiável e devolve uma recomendação estruturada
(`status`, `summary`, `sources_failed`, `candidates`). O agente não é mais um
input substituível por `general`.

> **Invariante:** o Loop **não move nada no funil**. Ele recomenda; a decisão
> de candidatar-se é do usuário. Isso é deliberado — a tabela `application` é
> a única coisa que o sistema não consegue recriar. O Loop nunca chama
> `jho track` nem escreve em `application`.

Essa fronteira é a decisão [ADR 0018](../docs/adr/0018-fronteira-de-confianca-da-varredura-compozy.md): texto público nunca chega ao
agente que pode executar comandos, e a sessão de revisão não tem filesystem,
shell, rede, ferramentas Compozy/MCP nem permissão de escrita.
