# Política de versões

Diretiva do dono (06/10/2026, [issue #468](https://github.com/andreustimm/master-jobs/issues/468)):
**tudo na versão mais nova** — sistema operacional, linguagens, bibliotecas,
frameworks, bancos de dados — e mantido assim por automação, com o CI verde
como garantia. Quando uma versão nova quebra algo, o código se adapta a ela;
rebaixar a versão para contornar a falha não é opção.

Três peças sustentam isso:

1. **Versão escrita no repositório.** Toda versão está num arquivo versionado,
   nunca numa etiqueta que troca sozinha (`ubuntu-latest`, `node:latest`,
   `actions/checkout@main`). Etiqueta flutuante muda por fora do CI: foi o aviso
   de que `ubuntu-latest` viraria Ubuntu 26 em 19/10/2026 que abriu a issue.
2. **Renovate** ([`renovate.json`](../../renovate.json)) lê essas versões e abre
   a PR que as sobe. Ele **não mescla**: a PR segue o fluxo normal (ver "Como o
   Renovate opera").
3. **Gate `pnpm check:versions`** ([`scripts/versions/check.ts`](../../scripts/versions/check.ts)),
   no `pnpm check` e no job `contratos` do CI, reprova etiqueta flutuante e
   major do Node divergente entre as fontes. Ele não consulta a rede: saber qual
   é a versão mais nova é papel do Renovate; o gate só garante que existe uma
   versão escrita para ele subir.

## Onde mora cada versão

| O quê | Onde | Quem sobe |
|---|---|---|
| Runner do GitHub (SO do CI) | `runs-on:` dos workflows; dentro da expressão de `ci.yml`, em `HOSTED_RUNNER` (`tests/support/ci-workflow.ts`), na fixture do teste e em `deploy.md` | Renovate (`github-actions` e regex com `github-runners`, que `tests/version-policy.test.ts` confere cobrir toda ocorrência) |
| Actions | `uses:` dos workflows, por tag de major (SHA só no `flyctl`, como a revisão da Fase 4 fixou) | Renovate (`github-actions`) |
| Node (runtime) | `engines.node` e `.nvmrc`; imagens `node:*` do `Dockerfile` e de `scripts/runner/Dockerfile` | Renovate (`npm`, `nvm`, `dockerfile`), em grupo |
| Tipos do Node | `@types/node`, na **mesma major do runtime** | Renovate, no grupo do Node |
| pnpm | `packageManager` (exato); o CI, o `Dockerfile` e a imagem do runner leem dali | Renovate (`npm`) |
| Dependências | `dependencies`/`devDependencies` e o lockfile | Renovate (`npm`, `rangeStrategy: bump`) e manutenção semanal do lockfile |
| Python dos scripts | `.python-version` (lido pelo `actions/setup-python` do CI) e `ARG PYTHON_IMAGE` de `scripts/runner/Dockerfile` | Renovate (`pyenv`, `dockerfile`), em grupo |
| Postgres dos testes e do ensaio de migração | `config/postgres-majors.json`: `latest` (a mais nova) e `production` (a do Supabase) | Renovate (regex, `docker`) só em `latest`; `production` é do dono |
| Postgres e MinIO locais | `docker-compose.local.yml` (`${VAR:-imagem:tag}`) | Renovate (regex, `docker`) |
| Runner do GitHub na imagem própria | `ARG RUNNER_VERSION` de `scripts/runner/Dockerfile` | Renovate (o SHA-256 é do dono) |

## Limites que não são "versão velha"

- **Node segue a maior major que a Vercel aceita em produção.** A Vercel publica
  as majors suportadas em [Supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions);
  uma major que ela ainda não aceita derruba o deploy, e o CI não roda o build
  da Vercel (só `main` implanta). Por isso a PR de major do Node (e de
  `@types/node`, que acompanha) chega com o rótulo `confirmar-vercel`: só se
  mescla depois de conferir a página. A major do pnpm (`packageManager`, que a
  Vercel lê para instalar) leva o mesmo rótulo pelo mesmo motivo.
- **`@types/node` acompanha o runtime, não o pacote mais novo.** Tipos de uma
  major acima deixariam passar API que o Node da Vercel não tem; o gate
  reprova a divergência.
- **Quarentena de um dia.** O pnpm não resolve versão publicada há menos de
  24 h (`minimumReleaseAge: 1440` em `pnpm-workspace.yaml`, declarado em vez
  de herdado do padrão, proteção contra pacote comprometido), e o Renovate
  espera o mesmo dia para não abrir PR que o `pnpm install` recusaria.
- **Major do Sentry é revista à mão.** O `@sentry/nextjs` 11 passou a transmitir
  spans em fluxo e ignorar `beforeSendTransaction`; a peneira de privacidade
  ficou no ciclo estático ([deploy.md, "Tracing"](deploy.md#tracing)), e
  `tests/instrumentation-guard.test.ts` trava a major para que a próxima não
  entre sem a peneira reescrita.
- **Codinome da distribuição muda à mão.** O Renovate sobe a versão dentro da
  variante (`node:24-trixie-slim` → `node:26-trixie-slim`, digest novo), mas
  não troca Debian 13 (`trixie`) pelo próximo; quando sair a estável nova,
  troque a variante numa PR.
- **Postgres: a mais nova e a da produção, as duas no CI.** A produção é
  Supabase Postgres 17 (17.6), e o Supabase gerenciado sobe pelo painel, por
  decisão do dono. Testar só a mais nova deixaria sem prova a major que guarda o
  dado de verdade, então [`config/postgres-majors.json`](../../config/postgres-majors.json)
  declara as duas, e só ali:
  - `latest` (hoje 18) é o padrão local, da suíte inteira e do ensaio de
    corte; o Renovate a sobe.
  - `production` (17) só muda quando o dono atualizar o projeto; o Renovate não
    a alcança, e subir `latest` não a tira da lista
    (`tests/version-policy.test.ts`).

  O job obrigatório `schema-e-migracao` roda `pnpm test:postgres-majors`, que
  executa os testes de schema, migração, upgrade e integridade e o ensaio
  (`scripts/migration/rehearse-production.ts`, sobre um snapshot sintético
  em `tests/production-selection.test.ts`) em cada major declarada, a da
  produção primeiro. Os bancos descartáveis aceitam a major por
  `JHO_TEST_POSTGRES_MAJOR` (só uma das declaradas) e reprovam se o servidor
  que subiu não for dessa major (`server_version_num`). Quando o dono subir a
  produção, atualize `production`; se ela alcançar `latest`, a lista vira uma
  major só.

## Como o Renovate opera

- PR sempre para `dev` (regra 18), em branch `chore/renovate-*`, com commit
  `chore(deps): atualiza …`. Como manutenção, não exige fragmento em
  `changelog.d/` nem dispara versão: a atualização sai na próxima release.
- Agenda: madrugada (de 0h a 6h59, `America/Sao_Paulo`), todo dia; manutenção
  do lockfile às segundas, na mesma janela. Alerta de vulnerabilidade sai a qualquer hora.
- Agrupamento: um PR por rodada para npm minor/patch, um para Actions e
  runners, um para imagens Docker, um para o runtime Node, um para Python, um
  para o pnpm. Cada major de pacote npm vem em PR próprio, para a quebra de um
  não segurar os outros.
- Mescla: **nenhuma automática** (`automerge: false` no topo, na manutenção do
  lockfile e em toda regra; sem `platformAutomerge`). A PR do Renovate segue o
  fluxo de qualquer outra: revisão no nível do diff (regra 19), juiz e merge
  por pessoa ou agente com o CI verde. Mescla automática pularia a revisão
  exigida pela regra 19 e a issue do Project exigida pela regra 24; liberá-la
  exige uma **exceção às regras 19 e 24 decidida pelo dono** — pendente, e
  enquanto não vier, nada aqui a liga.
- Quebrou: a PR fica aberta com o CI vermelho e aparece no Dependency
  Dashboard (issue aberta pelo Renovate). Quem pegar adapta o código na própria
  branch da PR ou numa tarefa `fix/…`; nunca fixa a versão antiga.
- O Renovate lê a configuração da branch padrão (`main`): ela passa a valer
  depois que este arquivo for promovido até lá.

## Pendências do dono

- Instalar o [GitHub App do Renovate](https://github.com/apps/renovate) no
  repositório (ou autorizar um token para rodá-lo como Action). Sem isso, nada
  acima roda.
- Decidir se as PRs do Renovate podem mesclar sozinhas. Isso é exceção às
  regras 19 (revisor no nível do diff) e 24 (issue no Project), e só o dono a
  concede; até lá o automerge fica desligado.
- Quando `TASKS_ENFORCEMENT` for ligado, o check `Vínculo da tarefa` vai pedir
  issue do Project nas PRs do Renovate; decidir a exceção para `renovate[bot]`
  antes, ou as PRs param de passar.
- Atualizar o Postgres do Supabase de produção pelo painel quando quiser
  acompanhar a major mais nova, e então subir `production` em
  `config/postgres-majors.json`.
- Reaplicar [`supabase/cron/watchdog.sql`](../../supabase/cron/watchdog.sql)
  no projeto de produção ([operations.md](../operations.md)): esta PR trocou a
  reversão do vigia de cota de `gh variable set CI_RUNS_ON --body
  '"ubuntu-latest"'` para `gh variable delete CI_RUNS_ON`, e a função
  agendada só muda quando o arquivo é aplicado de novo.
- Conferir o SHA-256 de `actions-runner-linux-x64-2.338.0.tar.gz` na
  [página da release](https://github.com/actions/runner/releases/tag/v2.338.0)
  e trocar o placeholder `RUNNER_SHA256` de `scripts/runner/Dockerfile`. A
  2.338.0 tinha menos de 24 h quando entrou; ficou porque o build da imagem
  falha fechado até esse SHA ser preenchido, e a conferência acontece depois
  da quarentena.
