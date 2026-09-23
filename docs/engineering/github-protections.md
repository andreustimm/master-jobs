# Proteções remotas no GitHub

Estado aplicado em 22/09/2026 pela issue
[#196](https://github.com/andreustimm/master-jobs/issues/196). Até então o
repositório não tinha ruleset, proteção de branch nem regra de ambiente: os
hooks locais eram a única barreira, e eles não alcançam a API, a interface web
nem outro clone. A definição mora em
[`scripts/github/verify-protections.ts`](../../scripts/github/verify-protections.ts),
que também confere o estado efetivo:

```bash
rtk node scripts/github/verify-protections.ts          # sai 1 em qualquer divergência
```

## O que está protegido

| Ruleset | Branches | Regras | Bypass |
|---|---|---|---|
| `permanentes: sem exclusão nem force-push` | `main`, `staging`, `dev` | `deletion`, `non_fast_forward` | nenhum |
| `main: CI obrigatório` | `main` | checks `qualidade` e `schema-e-migracao`, emitidos pelo app GitHub Actions (15368), sem modo estrito | nenhum |
| `main: produção por PR aprovada` | `main` | PR com 1 aprovação; push novo descarta a aprovação | papel admin, **só dentro de PR** |

Ambiente `Production` (o mesmo que os workflows chamam de `production`; nomes
de ambiente não diferenciam maiúsculas): só a branch `main` pode implantar, e
`can_admins_bypass` está desligado.

O que isso garante:

- Ninguém apaga nem reescreve `main`, `staging` ou `dev`: nem admin, nem
  agente, nem o `GITHUB_TOKEN`. A automação só faz fast-forward, então não
  precisa de exceção.
- Nada entra em `main` por push direto. O admin recebe recusa
  `Changes must be made through a pull request`.
- O CI de `main` não tem bypass para ninguém. Mesmo com `gh pr merge --admin`,
  a mesclagem é recusada enquanto `qualidade` ou `schema-e-migracao` estiver
  pendente ou vermelho.
- O `GITHUB_TOKEN` não tem bypass em `main`. A PR de produção é aberta pelo robô,
  e o autor não pode aprovar a própria PR. Por isso ela só entra por ação de uma
  pessoa: a aprovação, ou o bypass de admin dentro da PR, que dispensa a
  aprovação e fica registrado em *Rule insights*. O fluxo normal é aprovar.

## O caminho humano

**Promoção `staging → main`.** O robô abre a PR, e o dono a aprova e mescla.
A aprovação é válida porque o autor é `github-actions[bot]`.

Os checks exigidos precisam existir no SHA da cabeça da PR. Quando a promoção
não faz bump, a cabeça é o commit de `dev` que já passou pelo CI de push. Quando
faz bump, a cabeça é o commit `chore(release)`, empurrado pelo `GITHUB_TOKEN`.
Push feito com esse token não dispara workflow, e o CI reutilizável da promoção
publica seus checks com outro nome (`validar / qualidade`) em outro SHA. Nesse
caso, **feche e reabra a PR**: a reabertura é um evento humano e roda o CI de
`pull_request` na cabeça. Com `RELEASE_PAT` configurado a PR já nasceria com
checks, mas seu autor passaria a ser o dono do token, e o dono não pode aprovar
a própria PR. Antes de configurar o PAT, revise esta seção.

**Hotfix em `main`.** O dono abre a PR de hotfix e não pode aprová-la. O bypass
de admin, restrito a PR, aparece na caixa de merge como *bypass rules*. Ele
dispensa a aprovação, mas não o CI, que está em outro ruleset e não tem bypass.

**Versão do hotfix.** `sincronizar-apos-main.yml` tenta
`git push origin HEAD:main` com o commit `chore(release)` quando `main` recebe
um `fix:`/`feat:` fora da promoção. Esse push agora é **recusado**, e é
intencional: dar bypass ao `GITHUB_TOKEN` em `main` deixaria qualquer workflow,
inclusive um de branch de trabalho, publicar produção sem ninguém. O job
`Versionar e criar a tag` falha e o retorno `main → dev` não roda. Para concluir:

1. Numa worktree criada de `origin/main`, na branch `chore/release-X.Y.Z`,
   rode `node scripts/release/versionar.ts HEAD`. O comando grava
   `package.json` e os três changelogs, apaga os fragmentos de `changelog.d/`
   que consumiu e imprime a versão.
2. Registre também a remoção dos fragmentos
   (`git add -A -- package.json CHANGELOG.md USER_CHANGELOG.pt-BR.md USER_CHANGELOG.en.md changelog.d`),
   comite como `chore(release): X.Y.Z` e empurre a branch.
3. **Crie a tag antes de abrir a PR**, no commit de release:
   `gh api repos/andreustimm/master-jobs/git/refs -f ref=refs/tags/vX.Y.Z -f sha=<SHA do chore(release)>`.
   Sem ela, o CI da PR reprova. O gate de changelog lê o merge sintético da PR,
   cuja mensagem começa com `Merge`, e não o `chore(release)`. Aí ele conta o
   `fix:` do hotfix desde a tag anterior e tenta abrir X.Y.(Z+1) com o
   `Unreleased` vazio (`release_changelog_not_ready`). Com a tag no commit, não
   há commit releaseável depois dela e o gate responde `no-release`.
4. Abra a PR para `main`. Ela tem CI próprio porque foi empurrada por uma
   pessoa. Mescle com o bypass de PR e o método **merge** (`gh pr merge --merge --admin`).
   *Squash* e *rebase* criam outro SHA, e a tag ficaria fora de `main`.
   Se a PR for abandonada, apague a tag
   (`gh api --method DELETE repos/andreustimm/master-jobs/git/refs/tags/vX.Y.Z`).
5. O push em `main` roda `sincronizar-apos-main.yml` de novo.
   `versionar.ts` responde `no-release` porque a tag já existe. O workflow
   confirma a tag, cria a GitHub Release ausente e devolve `main` para `dev`.

Esse caminho foi simulado num clone descartável em 23/09/2026. A base foi esta
branch, com fragmentos. Sem a tag, o gate da PR reprova com
`release_changelog_not_ready`. Com a tag, o gate da PR, o CI de push em `main`
e o `versionar.ts` do sincronizador respondem `no-release`, e a tag fica
alcançável a partir de `main`.

A correção estrutural é o workflow abrir essa PR sozinho, em vez de empurrar.
Ela fica registrada como pendência, fora desta entrega.

## O que a plataforma não permite hoje

**PR e CI obrigatórios em `dev` e `staging`.** A promoção empurra o commit de
release direto em `dev` e faz fast-forward de `staging` com o `GITHUB_TOKEN`.
O retorno `main → dev` também faz fast-forward ou mescla uma PR sem checks.
Qualquer regra de PR, check ou `update` nessas branches recusaria a automação,
e a exceção precisaria do GitHub Actions como bypass. Num repositório de conta
pessoal a API recusa esse bypass:

```
422 Validation Failed: Actor GitHub Actions integration must be part of the
ruleset source or owner organization
```

Por isso `dev` e `staging` têm só integridade (sem exclusão nem force-push).
Hoje PR para `dev` depende dos hooks locais e da disciplina do fluxo.
Nada impede tecnicamente um push direto de quem tem escrita. O desenho pronto
para quando houver identidade própria da automação:

- `dev`: PR (0 aprovações) e os dois checks, **sem modo estrito**, com bypass
  só para a identidade da automação.
- `staging`: regra `update`, que só a identidade da automação atravessa. Nada
  nasce em `staging`, nem por PR humana.
- Identidade viável num repositório pessoal: **deploy key** com escrita. O
  ruleset aceita `DeployKey` como bypass. A chave privada fica num ambiente
  restrito à branch `main`, para que um workflow de branch de trabalho não a
  leia. Os checkouts de `promover-para-staging.yml` e de
  `sincronizar-apos-main.yml` passam a usar `ssh-key`. O dono precisa criar a
  chave e o segredo. A alternativa é migrar o repositório para uma organização.

**Modo estrito nunca.** "Require branches to be up to date" fica desligado. Em
`dev`, várias PRs verdes e sem conflito são mescladas em sequência; o modo
estrito refaria o CI completo (cerca de 15 min) por PR a cada merge. Em `main`,
atualizar a PR de produção significaria mesclar `main` dentro de `staging`.
Merge queue também não é usada.

**Revisor obrigatório no ambiente `Production`.** `migrate.yml` usa o ambiente
por `workflow_dispatch`. `varredura.yml` o usa todo dia por cron, e
`manutencao-banco.yml` toda semana. Um revisor obrigatório pararia as duas
rotinas à espera de clique, e elas falhariam depois de 30 dias. A aprovação
humana da migração exige um ambiente só dela (por exemplo
`production-migrations`, com revisor `andreustimm`, sem autoaprovação
impedida e restrito a `main`). `migrate.yml` passaria a apontar para ele, e
`SUPABASE_MIGRATION_URL` seria movido para lá. O valor é *write-only* e
precisa ser redigitado pelo dono. Hoje a trava humana da migração é o
`workflow_dispatch` com confirmação do project ref.

**Uma identidade só.** Os agentes usam a credencial do dono, e o GitHub não
distingue os dois. O bypass de PR em `main` e a aprovação da PR de produção
estão ao alcance de um agente que rode `gh`. A separação entre pessoa e agente
continua sendo a permissão do harness. As regras separam pessoas do
`GITHUB_TOKEN`, e só isso.

**GitHub Actions pode aprovar PR.** A configuração que permite ao Actions
*criar* PRs é a mesma que permite *aprovar*
(`can_approve_pull_request_reviews`), e a promoção precisa criar. Um workflow
malicioso poderia aprovar uma PR aberta pelo dono e então mesclá-la, se o CI
estiver verde. A PR de produção, aberta pelo próprio robô, não fica exposta a
isso.

**Deployments da Vercel.** A política de branch do ambiente vale para jobs de
workflow. A Vercel registra deployments de produção pela API com o SHA do
commit como ref. Confira no primeiro deploy de produção depois de 22/09/2026 se
o registro continua aparecendo em *Deployments*. Se não aparecer, remova a
política de branch (reversão abaixo), sem mexer nos rulesets.

## Reverter

O estado anterior a 22/09/2026 era: nenhum ruleset, nenhuma proteção de branch
e o ambiente `Production` com `can_admins_bypass: true`, sem
`deployment_branch_policy` e sem regras de proteção. A coleta está em
[`task_02-antes.json`](../../.compozy/tasks/governanca-regras/evidencias/task_02-antes.json),
e o estado aplicado em `task_02-depois.json`, na mesma pasta. Reverter é
desligar, não reescrever.
Prefira `enforcement: disabled`, que preserva a definição e o histórico em
*Rule insights*, a apagar:

```bash
rtk gh api repos/andreustimm/master-jobs/rulesets --jq '.[] | [.id, .name] | @tsv'
rtk gh api --method PUT repos/andreustimm/master-jobs/rulesets/<id> -f enforcement=disabled
rtk gh api --method PUT repos/andreustimm/master-jobs/rulesets/<id> -f enforcement=active
```

Ambiente, de volta ao estado anterior:

```bash
rtk gh api --method PUT repos/andreustimm/master-jobs/environments/Production \
  -F can_admins_bypass=true -F deployment_branch_policy=null
```

Para reaplicar do zero, gere os corpos e envie um por vez:

```bash
rtk node scripts/github/verify-protections.ts --write-bodies /tmp/rulesets
rtk gh api --method POST repos/andreustimm/master-jobs/rulesets --input /tmp/rulesets/ruleset-1.json
```

Desligue só o ruleset do problema, pelo tempo do problema, e religue
conferindo com o verificador. Desligar `permanentes` nunca é necessário para a
automação, que não faz force-push.

## Prova

Aplicado e conferido por GET independente (`/rules/branches/<branch>` e
`/rulesets/<id>`). A recusa foi testada em branches descartáveis
`sonda/protecoes-{main,staging,dev}`, com os mesmos rulesets aplicados por
`--probe-prefix sonda/protecoes-`, sem nenhuma tentativa contra as branches
reais:

| Tentativa (como admin) | Resultado |
|---|---|
| fast-forward em `sonda/protecoes-dev` | aceito |
| `push --force` em `sonda/protecoes-dev` | `Cannot force-push to this branch` |
| `push --delete` em `sonda/protecoes-staging` | `Cannot delete this branch` |
| `DELETE git/refs/heads/sonda/protecoes-dev` pela API | 422 `Cannot delete this branch` |
| push direto em `sonda/protecoes-main` | `Changes must be made through a pull request` e `2 of 2 required status checks are expected` |
| `gh pr merge` sem aprovação na PR para `sonda/protecoes-main` | `the base branch policy prohibits the merge` |
| `gh pr merge --admin` com CI em andamento | `Required status check "qualidade" is in progress` |
| ruleset com GitHub Actions como bypass | 422 (seção acima), repetido em 23/09/2026 |

Conferido em 23/09/2026, já com os rulesets ativos:

- A PR de produção #262 tem autor `github-actions[bot]`, `qualidade` e
  `schema-e-migracao` verdes na cabeça e fica `REVIEW_REQUIRED`. Falta só a
  aprovação do dono, que pode aprová-la porque não é o autor.
- A varredura agendada das 10:27 UTC recebeu o ambiente `Production` na branch
  `main` e rodou com os segredos. A política de branch não barra as rotinas
  por cron, que rodam na branch padrão.
- Os pushes da automação conferem com as regras: `promotion.ts` empurra o commit
  de versão para `dev` e o SHA validado para `staging`, os dois como
  fast-forward. O retorno `main → dev` é fast-forward ou merge de PR, e a tag
  nasce pela API. Nenhum desses pushes reescreve histórico, e `dev` e `staging`
  não têm outra regra. O único push recusado é o `git push origin HEAD:main` do
  hotfix, descrito acima.
- Ainda não houve deploy de produção da Vercel depois dos rulesets. A conferência
  da seção *Deployments da Vercel* continua pendente para o próximo merge em
  `main`.
