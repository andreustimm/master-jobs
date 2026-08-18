# Integração com CompozyOS 0.3

O `job-hunt-os` roda perfeitamente sozinho pela CLI. O Compozy entra quando
você quiser que a varredura aconteça **sem você pedir** — que é a fase 2 do
roadmap.

## Estado

| Item | Situação |
|---|---|
| `loops/job-sweep.yaml` | Escrito e **validado** contra o daemon 0.3 (`Loop validation passed`) |
| Registro do workspace | Não feito — o diretório ainda não está registrado no daemon |
| Automation job (agendamento) | Não configurado |

## Por que Compozy e não um cron

Um cron roda um comando. O que se quer aqui é diferente: sincronizar, pontuar
e **julgar** — a triagem exige um agente lendo a vaga contra o perfil. É esse
o trabalho que o Loop encapsula, com contrato explícito (`definition_of_done`),
teto de iterações e detecção de falta de progresso.

## Pré-requisitos

O CompozyOS 0.3 roda isolado do Compozy 0.2.15 de produção, via wrapper:

```bash
~/bin/cy03 daemon start          # sobe o daemon 0.3 em :2123
~/bin/cy03 status                # confirma
```

O wrapper injeta `COMPOZY_HOME=~/.compozy-os` e `HOME=~/.compozy-os-home` para
não colidir com a instalação de produção.

## Registrar o workspace

```bash
~/bin/cy03 workspaces add "/Users/andreus/Documents/Obsidian Vault/05_Interviews/mvp"
```

## Publicar o Loop

```bash
cd "/Users/andreus/Documents/Obsidian Vault/05_Interviews/mvp"

~/bin/cy03 loop validate --file compozy/loops/job-sweep.yaml
~/bin/cy03 loop create   --file compozy/loops/job-sweep.yaml
~/bin/cy03 loop list
```

## Rodar

```bash
# uma vez, à mão
~/bin/cy03 loop run --name job-sweep

# acompanhar
~/bin/cy03 loop runs
~/bin/cy03 loop status --name job-sweep
```

## Agendar (fase 2)

```bash
~/bin/cy03 automation jobs create --loop job-sweep --schedule "0 9 * * 1-5"
~/bin/cy03 automation jobs history --loop job-sweep
```

## O que o Loop faz

`job-sweep` recebe `min_fit` (padrão 55) e um agente, e executa a varredura:
sincroniza as fontes, repontua, analisa cada vaga nova acima de 60 de fit, e
devolve uma recomendação de triagem estruturada (`status`, `summary`,
`sources_failed`, `candidates`).

> **Invariante:** o Loop **não move nada no funil**. Ele recomenda; a decisão
> de candidatar-se é do usuário. Isso é deliberado — a tabela `application` é
> a única coisa que o sistema não consegue recriar.
