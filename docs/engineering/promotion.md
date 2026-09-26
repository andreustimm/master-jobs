# Promoção vinculada ao commit validado

`promover-para-staging.yml` promove um SHA imutável. O fluxo continua sendo
PR → `dev` → tag + fast-forward para `staging` → PR de produção para `main`
([G46](rules/delivery.md#g46)) → GitHub
Release e retorno para `dev`. A issue [#195](https://github.com/andreustimm/master-jobs/issues/195)
registra a entrega desta correção; o estado operacional fica no Project 3.

## Entrada e prova de CI

A promoção dispara quando o CI de push em `dev` termina (`workflow_run`),
decisão do dono em 26/09/2026 ([#347](https://github.com/andreustimm/master-jobs/issues/347)).
Entre 23/09 e 26/09 ([#263](https://github.com/andreustimm/master-jobs/issues/263))
ela rodou só por agenda, para poupar o limite diário de deploys da Vercel:
cada promoção gera deploy de `staging` e um `chore(release)` em `dev`. O
custo volta, mitigado pelo `ignoreCommand` da #259 (deploy sem efeito no site
é pulado) e pelos skips abaixo. O agendamento às 15:00 e 21:00 UTC
(`schedule`) fica como rede de segurança, e o dispatch, como retomada.

- **Evento de CI:** a entrada **A** é `workflow_run.head_sha`, de um run de
  push em `dev` concluído com `success` ou `failure` — `failure` entra porque
  um run vermelho só por job de `NON_BLOCKING_CI_JOBS` promove; o veredito por
  job decide. O run mais recente de A precisa ser o próprio run do evento.
- **Agendado:** A é a ponta de `origin/dev` lida uma única vez na preparação.
- **Dispatch:** `target-sha` é obrigatório: SHA completo, nunca um nome de
  branch.

A publicação recebe A pela saída da preparação e nunca relê a branch. Os dois
eventos automáticos nunca carregam aprovação de migração e terminam em
`skip=true`, sem validar e sem escrita, quando não há nada a promover:
`staging` já contém A (antes de qualquer consulta de CI); no evento de CI, A
deixou de ser a ponta de `dev` (o CI da ponta nova traz a própria promoção);
ou o run vermelho tem outro job bloqueante reprovado (o vermelho já está no
CI de `dev`). O dispatch nunca termina em skip. Nenhum evento autoriza escrita
por si só.

### O ciclo do commit de release

A promoção empurra R (`chore(release)`) em `dev`. Com `GITHUB_TOKEN`, o push
não dispara workflow nenhum. Com `RELEASE_PAT`, dispara o CI de R e, com ele,
este workflow de novo — que entra na fila `release-versionar` atrás da
promoção que publica R. Quando roda, `staging` já é R, e a execução termina em
skip sem consultar CI nem criar release. Se a primeira promoção falhou depois
de empurrar R, a segunda promove R: é a retomada pelo próprio CI de push de R.
O agendado seguinte também encontra `staging` na ponta e termina em skip.

Fora dos skips, o controlador consulta o CI de A pela API de Actions:

- Workflow `.github/workflows/ci.yml`, evento `push`, branch `dev`, repositório
  de origem correto e `head_sha` exato.
- Run mais recente concluído com sucesso. Um run antigo verde não compensa
  outro posterior falho, e um run ainda em andamento recusa: o evento de CI
  desse run, ou o agendado seguinte, tenta de novo.
- Jobs `qualidade` e `schema-e-migracao` aprovados para A na tentativa atual,
  com paginação. Ausência, falha, execução pendente, skip ou erro de API recusam.
  `qualidade` é o agregador dos jobs paralelos do CI (contratos, fatias de
  teste, cobertura, browser PWA, build): ele só termina em sucesso quando todos
  terminaram — ver a seção "O portão" de [deploy.md](deploy.md).

Os nomes exigidos ficam em `scripts/release/promotion-ci.ts`; os testes
conferem sua ligação ao CI. Alterar os gates exige atualizar esse contrato.
O SHA precisa pertencer ao histórico de `dev`. Nunca se troca A pela ponta
mais recente da branch.

## Commit automático de release

Se há bump, ele produz um filho direto **R** de A. Somente `package.json`
(campo `version`) e os três changelogs mudam, e os fragmentos de
`changelog.d/` presentes em A são apagados: o carimbo os juntou ao
`Unreleased` em ordem de nome (ver [Escrever o changelog](workflow.md#escrever-o-changelog)).
A verificação de R reconstrói essa junção a partir dos fragmentos de A e recusa
filho que mantenha, reescreva ou acrescente arquivo em `changelog.d/`. A classificação usa a tag mais
alta alcançável por A na preparação. Seu commit é gravado como SHA imutável
em `Promotion-Base` (`none` se não houver tag). Toda retentativa reconstrói o
mesmo intervalo base..A; uma tag publicada depois não muda a classificação.
O carimbo dos changelogs usa o instante de criação de R em UTC, com precisão
de segundos, também gravado no timestamp Git de R. A retentativa usa esse
instante imutável para conferir a transformação. O commit contém
`Promotion-Source: <A>`, preservando a semântica da [ADR 0017](../adr/0017-precisao-publicacao-e-autoridade-da-versao.md).

R é persistido em `dev` por push normal. Se `dev` já avançou e R ainda não
existe, a preparação recusa: aguarde o CI do novo SHA e inicie outra promoção.
Se o avanço ocorrer durante o push, o Git recusa o fast-forward. Não há rebase,
merge ou force-push para incluir a ponta posterior.

Depois da preparação, `ci.yml` roda como workflow reutilizável sobre o SHA
resultante, inclusive R. São os mesmos jobs de qualidade e schema, com checkout
explícito e token somente de leitura, sem herdar secrets. O controlador vem da
revisão do workflow em um checkout separado. O CI não recebe credencial de
push persistida no Git. O SHA validado só é emitido depois de ambos os jobs
passarem; tag, `staging` e PR dependem dele.

O commit de release **não herda o CI de A**. A exceção que permite seu
`Unreleased` vazio continua restrita ao validador de changelogs. Tipos, testes,
cobertura, browser PWA, build e sincronia de schema continuam obrigatórios.
Quando não há bump, o CI reutilizável valida o próprio A.

## Migrações, ancestralidade e publicação

Antes de preparar e novamente antes de publicar, a guarda classifica o diff
`staging..alvo` em `drizzle/` com o detector de
`src/core/db/migration-review.ts` ([ADR 0028](../adr/0028-migracao-automatica-so-aditiva.md)).
Mudanças em um commit posterior B não entram nesse intervalo. Migração nova e
aditiva (com seu snapshot e journal em `meta/`) promove sem confirmação,
inclusive no agendamento. Migração não aditiva, `.sql` publicado alterado ou
removido (renome conta como remoção) e arquivo fora de `drizzle/postgres/`
param a promoção: apenas dispatch com `confirmar-migracao=true` autoriza
prosseguir, depois de revisão humana, e o erro lista arquivo, motivo e comando.
A confirmação nunca dispensa CI. `schema.ts` não entra na guarda: o SQL é o que
chega ao banco, e o job `schema-e-migracao` do CI prova que os dois andam
juntos.

`staging` deve ser ancestral do alvo. Divergência falha; alvo já ultrapassado
por `staging` termina sem escrita. O push usa o SHA, sem force. A fila
`release-versionar` permanece compartilhada com `sincronizar-apos-main.yml`
durante preparação, validação e publicação.

Uma tag existente precisa apontar ao commit da versão, resolvido dentro do
histórico do alvo. Ela nunca é movida. A tag de um release pendente só nasce
após o CI do alvo. Manutenção exige a tag vigente existente. A PR de produção
recebe responsável `andreustimm`, os SHAs e o link do run; ela é aberta ou
reutilizada, nunca mesclada pela promoção. Na reutilização, somente o bloco
delimitado `promotion-provenance` é substituído; anotações e checklists humanos
ficam intactos. PRs antigas sem delimitadores recebem o bloco no início.

## Retomar sem mudar o alvo

Use dispatch com o mesmo A — a saída `source` da preparação registra o SHA.
**Re-run all jobs** conserva A só num run de dispatch. Num run de evento de CI,
depois que R entrou em `dev`, A já não é a ponta e o re-run termina em skip: a
retomada é o dispatch com A ou o re-run do CI de push de R. Num run agendado a
preparação relê a ponta de `dev`, que depois de R pode ser o próprio R, sem CI
de push próprio quando o push usou `GITHUB_TOKEN`.

```bash
rtk gh workflow run promover-para-staging.yml \
  --field target-sha=<SHA_COMPLETO_DA_ENTRADA>
```

Inclua `--field confirmar-migracao=true` somente após revisar a migração não
aditiva que a guarda apontou.
O retry procura o filho de A identificado por `Promotion-Source` no histórico
de `dev`, verifica pai, versão, conteúdo exato dos quatro arquivos e a remoção
dos fragmentos, e reutiliza R. Mesmo com `dev` em B, não cria outro release nem troca o alvo/tag. O CI de R
é repetido quando se reexecuta o fluxo inteiro. A opção de reexecutar só jobs
falhos conserva os outputs dos jobs aprovados da execução original.

Se a execução parou depois de promover e antes de abrir a PR, repetir conclui
a abertura. Se `staging` já ultrapassou o alvo, repetir é um no-op. Releases
anteriores a este contrato, sem trailer, são retomados escolhendo explicitamente
o SHA do commit de release e comprovando seu próprio CI de push em `dev`.

### Corrigir um candidato que reprova no CI

Se R exige uma correção de código, publique um novo commit **B** em `dev`,
descendente de R, com a correção e seu fragmento de changelog. Depois do CI
de B, inicie uma **nova promoção com B**. O controlador verifica o R pendente
e cria um novo filho **R2** de B, com a próxima versão e os trailers
`Promotion-Source: <B>` e `Promotion-Supersedes: <R>`. R2 passa pelo CI completo
antes de receber sua própria tag e avançar `staging`.

Preparar R2 não cria nem move a tag de R; a versão anterior continua pendente.
Isso pode deixar lacunas entre os números das tags. Os changelogs conservam
as entradas preparadas e seus instantes de criação; a PR registra o candidato
substituído. O CI de B ou R2 nunca autoriza criar a tag de R. Repetir a entrada
A continua apontando para R, enquanto repetir B recupera R2. Essa substituição
só se aplica a candidatos com `Promotion-Source` e transformação verificável.
Se um retry independente de A aprovar R antes da publicação de R2, ele pode
criar legitimamente a tag de R. A base registrada em R2 mantém seu cálculo
original mesmo depois dessa tag tardia; o alvo da entrada B continua sendo R2.

Com `GITHUB_TOKEN`, o push de R pode não disparar outro workflow; a chamada
reutilizável garante o CI sem depender desse efeito. `RELEASE_PAT` continua
opcional para disparar workflows a jusante. Sem PAT, abrir a PR ainda depende
da permissão de Actions para criar PRs nas configurações do repositório.
Essa PR, criada pelo robô, recebe o CI de `pull_request` parado em
`action_required`. Os dois últimos passos da promoção disparam `ci.yml` por
`workflow_dispatch` em `staging` (sem o `e2e-navegador`) e aprovam pela API o
run pendente da PR, para que os checks exigidos por `main` existam na cabeça
dela ([github-protections.md](github-protections.md#o-caminho-humano)).

A entrada é autorizada pelos jobs obrigatórios do CI de push em `dev`, e não pela
conclusão da execução inteira: um job da lista não bloqueante
(`NON_BLOCKING_CI_JOBS`) vermelho ou em andamento não barra a promoção
([deploy.md](deploy.md#o-portão)).

O retorno `main → dev`, o versionamento de hotfixes em `main` e a criação
idempotente de GitHub Releases permanecem em `sincronizar-apos-main.yml`.
Uma release existente é preservada. Divergência no retorno continua indo por
PR, sem reescrever `dev`. Publicação em `main` segue
[G46](rules/delivery.md#g46): CI verde, QA de [G56](rules/delivery.md#g56)
(full se a leva tem mudança visível; senão, a fumaça pós-deploy) e o merge pelo
agente, por delegação do dono.
Desde 22/09/2026, o ruleset de `main` recusa o push direto do commit de versão
de um hotfix. O fechamento manual está em
[github-protections.md](github-protections.md#o-caminho-humano).

## Evidência e limites

`tests/promotion-provenance.test.ts` executa os casos V01-01 a V01-07 com Git
real e API local: corrida A/B, checks adversos, intervalo de migração, validação
de R, recuperação por B/R2 após reprovação, repetição após avanço,
atualização da PR preservando revisão humana, ancestralidade, entrada agendada,
consumo de fragmentos, entrada pelo evento de CI e o skip do ciclo do
`chore(release)`. `tests/changelog-fragments.test.ts` cobre formato,
ordem, idempotência e o merge de dois fragmentos sem conflito. As suítes de release preservam
changelogs, tags, releases existentes e o retorno. O contrato YAML comprova a
ligação dos dois jobs aos SHAs e permissões; testes locais não executam o
scheduler de Actions nem comprovam permissões/deploys remotos.

`workflow_run` e `schedule` usam o workflow da branch padrão. Integrar esta
mudança em `dev` não demonstra que ela já governa promoções remotas: até
chegar a `main`, a versão anterior (só agendada) continua valendo, e a
instalação na branch padrão permanece parte da publicação em `main`. Não
disparar promoção real como teste desta correção.

O mesmo vale para os fragmentos: o controlador da promoção vem de `main`. Até
a versão que traz `changelog.d/` chegar lá, o controlador antigo carimba só o
`Unreleased` escrito à mão e deixa os fragmentos em `dev` — eles entram na
primeira versão carimbada pelo controlador novo, uma versão depois do código.
Se nessa janela o `Unreleased` estiver vazio e a leva pedir bump, a promoção
antiga recusa por nota ausente até o merge em `main`;
nenhum estado é escrito, e o agendado seguinte promove normalmente.

Referências de plataforma: [workflows reutilizáveis](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows),
[permissões e concorrência](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations)
e [API de runs](https://docs.github.com/en/rest/actions/workflow-runs).
