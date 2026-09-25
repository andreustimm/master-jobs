# Regras de entrega, revisão, QA, documentação e harnesses

Referência normativa do fluxo de entrega. Resumo crítico em
[AGENTS.md](../../../AGENTS.md); índice e procedimento de conflito em
[README.md](README.md). O **roteiro operacional** — comandos para começar,
retomar, validar e limpar — está em [workflow.md](../workflow.md); o contrato
da promoção, em [promotion.md](../promotion.md); os ambientes, em
[deploy.md](../deploy.md). Aqui fica o que obriga, e por quê.

---

## Autoridade operacional

<a id="r24"></a>
### R24 — A issue e o GitHub Project 3 são a autoridade da tarefa (regra 24)

Obrigação posterior à auditoria ([#209](https://github.com/andreustimm/master-jobs/pull/209),
[ADR 0023](../../adr/0023-github-project-como-autoridade-operacional.md)); não
tem ID `G`.

**Obrigação.** Toda demanda, inclusive pequena, precisa de issue vinculada ao
[Project 3](https://github.com/users/andreustimm/projects/3) antes de execução.
Estado, prioridade, assignee e dependências vêm do remoto; specs, código e
evidências continuam em Git. Antes de iniciar ou retomar, leia o remoto
(`rtk pnpm tasks show <issue> --json`) e verifique a posse da execução. Claim
identifica execução + branch + worktree, não apenas a pessoa.

Escritas usam comandos coordenados com revisão e UUID de operação, aguardam
recibo e não sobrescrevem tarefas concorrentes por bulk sync. Sem confirmação
remota, não declare sucesso nem trabalhe sob recibo local vencido. Resultados de
QA/review e frontmatter `completed` não concluem a issue: a conclusão exige
prova da **Entrega exigida**, que pode ir além do merge em dev.

`.compozy/tasks/`, memória e backlog local guardam contexto autoral, histórico
ou projeções identificadas; nunca comandam estado, prioridade ou relações. Isso
prevalece sobre instruções genéricas das skills `cy-*` e vale nos três harnesses
mesmo sem invocar skill.

**Integração em dev não é ativação.** Durante o bootstrap do épico
[#181](https://github.com/andreustimm/master-jobs/issues/181), o coordenador
registra a execução na issue enquanto constrói o escritor. O corte exige código
confiável de `issue_comment` na default `main`, `PROJECTS_TOKEN` e chave do
escritor validados, preflight e piloto confirmados. Até esse corte, não anuncie
enforcement ativo. Produção continua dependente de ação humana.

Roteiro: [workflow.md](../workflow.md) ("Preparação e ativação" a "Compozy,
memória e evidências"). Prova: `tests/tasks-*.test.ts`.

<a id="r24-closes"></a>
### R24 — `Closes #N` vai na mensagem do commit

Obrigação posterior à auditoria ([#261](https://github.com/andreustimm/master-jobs/pull/261)).

**Obrigação.** Pelo menos um commit da PR leva na mensagem `Closes #N` para
cada issue entregue por inteiro (`Refs #N` quando parcial). Como a PR aponta
para `dev` e a branch padrão é `main`, a palavra-chave na descrição não fecha
nada; na mensagem do commit, o GitHub fecha a issue quando esse commit entra em
`main` — ou seja, em produção. Issue com entrega `dev`, `artifact` ou
`operation` continua sendo concluída pela transição explícita, com a prova
correspondente.

Roteiro: [workflow.md](../workflow.md) ("Entregar e limpar").

---

## Branches, worktrees e promoção

| Etapa | Quem faz | Como |
|---|---|---|
| tarefa → `dev` | pessoa ou agente | worktree a partir de `dev`, PR com CI verde |
| `dev` → `staging` | automático | `promover-para-staging.yml`, às 15:00 e 21:00 UTC, com a ponta de `dev` de CI verde (ou dispatch com `target-sha`) |
| `staging` → `main` | **humano** | PR aberta pelo robô, mesclada por gente |
| tag + `main` → `dev` | automático | `sincronizar-apos-main.yml` |

<a id="g43"></a>
### G43 — Tarefa nasce em worktree a partir de `dev`; PR aponta para `dev` (regra 18)

**Obrigação.** Nunca comite direto em `dev`, `staging` ou `main`. A promoção
para `staging` é automática e a de `staging` para `main` é humana. Um commit
direto em `staging` faz as branches divergirem e trava a promoção seguinte, com
o sintoma aparecendo dias depois da causa.

**Exceções nomeadas** (resolve C21), sem bypass genérico para pessoa ou robô:
o commit automático de release `chore(release): X.Y.Z` criado pela promoção
([promotion.md](../promotion.md)); o retorno `main → dev` feito por
`sincronizar-apos-main.yml` (G52); e hotfix, que nasce em `main` por decisão
humana e volta para `dev` pelo mesmo retorno.

Prova local: `.githooks/prepare-commit-msg` e `.githooks/pre-push`. Hooks não
protegem escrita pela API; a proteção remota é G46.

<a id="g44"></a>
### G44 — Antes de iniciar ou retomar, confira o estado e preserve WIP

**Obrigação.** Consulte a issue remota (R24); confira
`rtk git status --short --branch` e `rtk pnpm worktrees`. Preserve alterações
pendentes — patch **e** arquivos não rastreados — antes de reconciliar a raiz.
HEAD já presente em `dev` não prova que uma worktree com WIP pode ser removida.
Nunca use `reset --hard` ou `clean -fd` como solução genérica, e não mexa na
worktree de outra tarefa.

Roteiro: [workflow.md](../workflow.md) ("Começar ou retomar"). Prova:
`tests/worktree-workflow.test.ts`.

<a id="g49"></a>
### G49 — Branch de trabalho é `<tipo>/<slug>`

**Obrigação.** Tipos do Conventional Commits (`feat`, `fix`, `docs`, `chore`,
`refactor`, `test`, `perf`, `ci`, `build`, `style`, `revert`) e slug minúsculo,
com letras e números separados por `-` ou `.`: `feat/busca-por-tecnologia`,
`fix/node-24.19`. O prefixo anuncia o tipo dos commits; quem decide o bump de
versão é o prefixo de cada commit. O nome nunca carrega a ferramenta que abriu
a branch. `.githooks/pre-push` recusa nome fora do padrão; `codex/*` é legado
aceito, para que branches abertas antes da convenção sigam publicáveis sem
renomear.

<a id="g48"></a>
### G48 — `dev`, `staging` e `main` são permanentes

**Obrigação.** As três representam os ambientes e o caminho de promoção;
permanecem no remoto e nos clones locais depois de qualquer promoção ou
retorno. Nunca são apagadas nem recebem force-push. O hook local recusa o
delete; a negativa no servidor é G46.

<a id="g50"></a>
### G50 — Branch de trabalho mesclada é excluída, local e remota

**Obrigação.** Assim que a PR entra em `dev` (ou em `main`), a branch e sua
worktree são removidas: `git worktree remove` (desbloqueando antes, se estiver
locked), `git branch -d` e `git push origin --delete <branch>`. A remota é tão
obrigatória quanto a local — branches mortas viram uma floresta que ninguém
sabe se ainda vale. Branch ainda não mesclada fica até entrar. Antes de remover:
integração confirmada no GitHub, claim resolvido (R24), worktree limpa e
evidência preservada. Nunca aplique a limpeza a branch permanente.

Roteiro: [workflow.md](../workflow.md) ("Entregar e limpar").

<a id="g45"></a>
### G45 — `dev` → `staging` é fast-forward do SHA validado

**Obrigação.** Nada nasce em `staging`; um merge criaria ali um commit que não
existe em `dev`, e as duas divergiriam para sempre. A promoção avança `staging`
por fast-forward até um **SHA imutável** cujo CI de push passou: no agendado, a
ponta de `dev` lida uma única vez na preparação e repassada à publicação, que
nunca relê a branch; no dispatch, o `target-sha` explícito. O commit de
release, quando existe, passa pelo mesmo CI antes de avançar `staging`;
retentativa conserva o alvo.

**Resolve C20.** O contrato está em [promotion.md](../promotion.md) e é provado
por `tests/promotion-provenance.test.ts`. Sem `RELEASE_PAT`, push feito com o
token padrão da Action não dispara outros workflows (trava anti-recursão do
GitHub); o fluxo continua seguro porque o CI reutilizável valida o SHA
promovido. Com o PAT, `staging` e as PRs geradas recebem checks próprios.

<a id="g46"></a>
### G46 — Produção não sai sem gente

**Obrigação.** A PR `staging → main` é aberta pelo robô e **nunca** mesclada por
robô nem por agente. Publicação em `main` exige decisão humana e QA full
(G56).

**Proteção remota (C19).** Desde 22/09/2026
([#196](https://github.com/andreustimm/master-jobs/issues/196)), rulesets do
GitHub exigem em `main` PR aprovada e CI verde, sem bypass de CI, e o ambiente
Production só implanta a partir de `main`; `main`, `staging` e `dev` recusam
exclusão e force-push para todos. `dev` e `staging` ainda não exigem PR nem CI
no remoto — ali a regra continua garantida por processo e hooks locais. Estado
aplicado, caminho humano e verificação em
[github-protections.md](../github-protections.md). O que falta no remoto não
afrouxa a regra.

<a id="g51"></a>
### G51 — Migração não aditiva suspende a promoção e a migração automáticas

**Obrigação.** O deploy da Vercel e a migração disparam do mesmo push para
`main` e não se conhecem. Migração aditiva sobrevive a essa corrida; migração
que remove, renomeia, muda tipo, aperta restrição ou reescreve dado, não. Quem
separa as duas é o detector puro `src/core/db/migration-review.ts`, por lista
de permissão: forma de comando não prevista conta como não aditiva. Aditiva
promove sem confirmação e é aplicada sozinha por `migrate.yml` no push para
`main`. Não aditiva — ou `.sql` publicado alterado, ou arquivo fora de
`drizzle/postgres/` — para a promoção até dispatch com
`confirmar-migracao=true`, depois de revisão humana, e para o job automático
antes de qualquer DDL até o dispatch manual de `migrate.yml`. A confirmação
nunca dispensa CI. Migração nova traz o veredito revisado em
`tests/fixtures/migration-verdicts/<tag>.json` no mesmo commit.

Detalhes: [ADR 0028](../../adr/0028-migracao-automatica-so-aditiva.md),
[promotion.md](../promotion.md) ("Migrações, ancestralidade e publicação"),
[deploy.md](../deploy.md#migração-que-não-é-aditiva), skill
`drizzle-safe-migrations`.

<a id="g52"></a>
### G52 — O retorno `main` → `dev` não é opcional

**Obrigação.** Hotfix nasce em `main`, e correção nos próprios arquivos de fluxo
também. Sem devolver, `dev` fica sem esses commits e a promoção seguinte deixa de
ser fast-forward. `sincronizar-apos-main.yml` faz o retorno por fast-forward ou,
havendo divergência, por PR — sem reescrever `dev` e sem merge automático em
produção.

<a id="g47"></a>
### G47 — Toda PR tem responsável atribuído

**Obrigação.** Antes de abrir ou mesclar uma PR, confira a identidade local
(`git config user.name`, `git config user.email`) e o login da sessão
(`gh api user --jq .login`), e atribua a PR (`gh pr edit <número> --add-assignee
@me`; neste projeto, `andreustimm`). Se o cliente GraphQL falhar por causa do
recurso legado Projects, use o REST equivalente:
`gh api --method POST repos/andreustimm/master-jobs/issues/<número>/assignees -f 'assignees[]=andreustimm'`.
Nenhuma PR fica sem assignee — inclusive as abertas por workflow (promoção e
retorno), criadas ou reaproveitadas.

Prova: `tests/pr-producers.test.ts` acha todo `gh pr create` dos workflows e
reprova o passo sem atribuição da PR criada **e** da reaproveitada, ou com base
fora das exceções nomeadas (`staging → main`, `main → dev`); a execução com `gh`
falso está em `tests/promotion-provenance.test.ts`.

---

## Revisão, QA e documentação antes da PR

A ordem do fluxo, de ponta a ponta:

```
worktree/tarefa → check/e2e aplicável → QA de jornada aplicável → auditoria de agente aplicável → docs/ + changelogs → deslop → deep-review → ship-pr → PR → dev → (automático) → staging → PR humana → main → tag + volta para dev
```

<a id="g53"></a>
### G53 — Antes de abrir PR, rode a revisão profunda (regra 19)

**Obrigação.** `/deep-review` revisa o diff com evidência causal, cobertura por
hunk e veredito **SHIP / FIX_BEFORE_SHIP / REWORK**. Rode antes de pedir revisão
humana: o CI prova que o código roda; a revisão profunda diz se ele está certo.
Uma coisa não substitui a outra. Mudança relevante depois do veredito exige nova
rodada (incremental): revisão de um diff antigo não aprova o atual. Por isso a
PR registra o veredito **com o SHA revisado** (campo do
[modelo de PR](../../../.github/PULL_REQUEST_TEMPLATE.md)): quem lê compara com
a ponta da PR. O campo é declaração, não prova — nenhum gate julga se o texto é
verdadeiro; `tests/pr-producers.test.ts` só impede que o modelo perca a pergunta.

**O agente invoca.** O frontmatter da skill teve `disable-model-invocation` até
2026-09-20, e sete PRs seguiram para produção sem revisão profunda porque a
única pessoa que podia rodá-la estava ocupada. Gate que só um humano dispara é
fila. O agente roda a revisão em toda PR, e a pessoa lê o veredito. O mesmo vale
para `qa-report`, `qa-execution`, `agent-output-audit` e `ship-pr`.

**Publicar é outra autorização.** Sem `--publish`, o relatório fica local em
`.deep-review/`; comentar na PR exige `--publish` ou autorização explícita.

```bash
/deep-review --base origin/dev             # diff contra dev, relatório local
/deep-review --pr 7                        # uma PR do GitHub
/deep-review --worktree --base origin/dev  # trabalho não commitado
/deep-review --pr 7 --publish              # comenta na PR
```

Configuração opcional em `.deep-review.yaml`; sem ela vale o padrão do
repositório, e `path_instructions` do `.coderabbit.yaml` é lido como fallback.

<a id="g54"></a>
### G54 — Só SHIP é caminho normal; exceção é decisão humana registrada

**Obrigação** (resolve C11). O caminho normal para entregar é veredito **SHIP**
sobre o diff atual. Um `FIX_BEFORE_SHIP` que não foi corrigido nunca é tratado
como aprovado: a PR declara, na descrição, os achados remanescentes e a razão, e
só uma **pessoa** decide aceitá-los — a decisão fica escrita, vinculada aos
achados e ao diff. Agente e skill não concedem essa exceção a si mesmos, e
`REWORK` não vira PR pronta por texto genérico. `ship-pr` exige SHIP; quando
não há SHIP, ela para e relata.

<a id="g84"></a>
### G84 — Revisão, auditoria e QA respondem perguntas distintas

**Obrigação.** A revisão profunda **relata, não corrige**: quem corrige decide o
que aceitar, e essa separação é a garantia real, independente de quem aperta o
botão. `agent-output-audit` certifica que uma tarefa implementada fez o que
alega (arquivos, diffs, testes, CI), sem substituir revisão nem QA. QA de
jornada prova experiência pela interface pública. Nenhuma aceita autorrelato
como prova, e os artefatos ficam separados.

<a id="g55"></a>
### G55 — Mudança percebida por usuário atualiza e percorre o QA vivo (regra 20)

**Obrigação.** `qa-report` planeja em `docs/qa/`; `qa-execution` percorre as
jornadas pela interface pública e escreve os resultados de volta na mesma
árvore. Antes da PR, mudança visível segue a cadência de
[docs/qa/README.md](../../qa/README.md). Mudança sem efeito visível declara isso
no handoff e não inventa sessão.

**Implementador mantém o tracker vivo.** Comportamento novo cria cenário
`untested`; comportamento alterado reseta os cenários afetados para `untested`;
refactor puro declara "sem mudança visível". IDs, charters, bugs, relatórios e
evidências seguem o contrato de `docs/qa/README.md`. Artefatos autorais
(`personas`, `journeys`, `scenarios`, `charters`, `bugs`, `reports`) são
commitados; `docs/qa/state.csv` (visão gerada) e `docs/qa/evidence/` ficam
ignorados. Como a visão não é versionada, `pnpm check:qa-tracker` confere o
esquema dos cenários dentro do `pnpm check` e do CI — nenhum hook o roda no
commit. O formato válido não concede `Pass`.

**Ordem para mudança visível:** implementação → `rtk pnpm check` e E2E
aplicável → `qa-report` (tier targeted) → `qa-execution` → correções/reteste →
suíte completa → `deep-review` → PR para `dev`. Invoque `qa-report` e depois
`qa-execution` com o argumento `docs/qa` (formulação neutra entre harnesses).

<a id="g56"></a>
### G56 — Cadência única; `Pass` exige prova; release candidate cumpre full

**Obrigação.** O escopo de cada tier é definido uma única vez em
[docs/qa/README.md](../../qa/README.md); nenhum outro documento duplica a
cadência. Antes da PR humana `staging → main`, release candidate cumpre o tier
**full**. QA de jornada não substitui `rtk pnpm check`, `rtk pnpm test:e2e` nem
`deep-review`.

`qa-execution` exige build alcançável com paridade de produção, autenticação
real e suíte automatizada verde. Não usa mocks, banco, endpoints internos nem
devtools para substituir interação ou verificação pela interface pública;
devtools continuam permitidos para configurar e observar o ambiente da persona
(throttling de rede, por exemplo). O resultado só é `Pass` quando o observável
sobrevive a refresh e é confirmado por leitura independente. Perna que exige
ação humana fica `Blocked (needs human verify)` com instruções exatas.

O navegador de jornada é a dependência local fixada `agent-browser`: instale o
Chrome uma vez com `rtk pnpm qa:browser:install` e invoque com
`rtk pnpm exec agent-browser`.

<a id="g57"></a>
### G57 — Validação proporcional ao risco

**Obrigação.** PR apenas de Markdown ou de metadados de skills, sem alteração de
runtime, valida estrutura, links e scripts afetados — não roda as suítes
unitárias/E2E do produto. A extensão do arquivo não decide sozinha: script,
workflow ou arquivo interpretado em execução exige o teste do comportamento que
mudou. A tabela de evidência por tipo de mudança está em
[workflow.md](../workflow.md) ("Validar pelo risco").

A validação estrutural de Markdown e metadados usa os validadores únicos que já
existem, sem cópia: `pnpm check:instructions` (symlinks, links, âncoras e IDs de
regra), `pnpm check:release-ready` (changelogs e fragmentos) e
`pnpm check:qa-tracker` (esquema dos cenários). A proporcionalidade é de quem
valida antes da PR; o CI roda o portão inteiro em toda PR de propósito, porque
`qualidade` é check obrigatório, e check obrigatório filtrado por caminho fica
pendente ou pulado — e pulado conta como aprovado. A seleção por caminho que
existe é a do deploy (`scripts/vercel-ignore-build.sh`, provada por
`tests/vercel-ignore-build.test.ts`): só documentação, testes e automação não
publicam versão nova.

<a id="g60"></a>
### G60 — O changelog conta o que mudou; `docs/` conta como é agora (regra 23)

**Obrigação.** São perguntas diferentes, e só o changelog deixa a segunda
envelhecer em silêncio. Tarefa fechada revisa `docs/` e atualiza o que passou a
valer — recurso novo, contrato mudado, invariante descoberta, armadilha
aprendida — antes da revisão.

| Se a mudança toca | Atualize |
|---|---|
| schema, FK, migration | `docs/data-model.md` |
| adapter, board, elegibilidade | `docs/sources.md` |
| scorer, componente, peso | `docs/scoring.md` |
| comando, flag, saída | `docs/cli.md` |
| contrato de URL, estado de filtro | `docs/product/` |
| invariante de produção, limite, pool | `docs/operations.md` |
| regra, exceção ou precedência | `docs/engineering/rules/` |
| decisão que restringe o futuro | ADR em `docs/adr/` |

**PR sem alteração em `docs/` declara por quê**, na descrição, em uma linha —
como a regra 20 faz com QA. "Correção interna, sem contrato alterado" é resposta
legítima; ausência de resposta não é. Declarar é barato e mantém a pergunta
viva; ritual obrigatório viraria carimbo.

<a id="g15"></a>
### G15 — Documento de feature em `.compozy/tasks/`; o que sobrevive, em `docs/`

**Obrigação.** A fronteira é o ciclo de vida
([ADR 0011](../../adr/0011-fronteira-compozyos-e-docs.md)): spec, contrato de
testes e contexto técnico nascem e morrem com o slug; o grafo operacional é
projeção das relações remotas (R24). ADR, visão, personas, histórico de backlog,
mapa de contextos e estas regras atravessam features. Regra global nunca fica só
num slug, onde só quem conhece a feature a encontraria.

**Parte de `docs/` é teste de fitness.** `pnpm check` abre
`docs/engineering/context-map.md` e `docs/README.md` por caminho literal;
mover ou renomear esses arquivos quebra o gate.

<a id="g58"></a>
### G58 — Commit releaseável carrega a nota em um fragmento de changelog (regra 21)

**Obrigação.** Se a leva desde a última tag contém `fix:`, `feat:` ou outro
commit que pede bump, a PR adiciona `changelog.d/<slug-da-branch>.md` com os
blocos `## Técnico`, `## pt-BR` e `## en` (cada um com `### Seção` e itens
`- `; `pt-BR` e `en` podem ser só `<!-- sem-nota-usuario -->`, os dois juntos).
**Não edite** o `## [Unreleased]` de `CHANGELOG.md`, `USER_CHANGELOG.pt-BR.md`
e `USER_CHANGELOG.en.md`: cada PR editando os mesmos três trechos reabria
conflito em todas as outras a cada merge. A promoção junta os fragmentos no
carimbo da versão e os apaga no commit de release.

Não deixe para a promoção descobrir erro: `.githooks/commit-msg` valida o
índice (fragmento malformado reprova mesmo sem bump), e o CI repete o gate com
`pnpm check:release-ready`. `pnpm install` ativa os hooks versionados via
`core.hooksPath=.githooks`. O commit automático `chore(release): X.Y.Z` é a
única exceção, porque vem depois do preflight. Entrada escrita direto no
`Unreleased` ainda é aceita, só durante a transição.

Formato e exemplo: [workflow.md](../workflow.md#escrever-o-changelog). Prova:
`tests/changelog.test.ts`, `tests/changelog-fragments.test.ts`,
`tests/release-commit.test.ts`.

<a id="g59"></a>
### G59 — Toda tag SemVer tem uma GitHub Release (regra 22)

**Obrigação.** A tag `vX.Y.Z` e a entrada `## [X.Y.Z]` do changelog técnico são
a fonte da release. Tags anteriores à primeira versão documentada recebem só a
nota histórica padrão; lacuna posterior interrompe a sincronização. Não publique
texto paralelo à mão. O workflow pós-`main` roda
`scripts/release/github-releases.ts --apply`, cria só as releases ausentes e
preserva as existentes — inclusive backfill de tag histórica sem release.

Prova: `tests/release.test.ts`.

<a id="g83"></a>
### G83 — Estado, contagens e versões não moram nas instruções

**Obrigação.** Não descreva como pronto o que não está. Inventário de comandos,
contagens do acervo, versões e estado de implantação envelhecem a cada release;
eles moram onde há fonte verificável — [cli.md](../../cli.md) para comandos,
`jho stats` e [docs/product/vision.md](../../product/vision.md) para números
datados, `package.json` para versões de runtime, o código para
`SCORER_VERSION`, [deploy.md](../deploy.md) para o estado de produção,
[roadmap.md](../../roadmap.md) para o que ainda não existe. Onde a informação é
dinâmica, date a observação e não a chame de fonte da verdade.

---

## Instruções e harnesses

<a id="g62"></a>
### G62 — Instruções compartilhadas são lidas; skill não substitui regra

**Obrigação.** A entrada comum ([AGENTS.md](../../../AGENTS.md)) é lida em todo
harness e contém as invariantes críticas por escrito, porque link não garante
autoload. Antes de alterar uma área, leia a referência por domínio indicada no
roteador da entrada. Regras do repositório têm precedência sobre exemplos
genéricos das skills — em especial RTK, base `dev`, worktree obrigatória,
PostgreSQL/Supabase e os gates deste repositório. Skill ensina procedimento;
ela não define política nem concede autorização.

<a id="g61"></a>
### G61 — Skills em `.claude/skills/`; os outros harnesses por symlink

**Obrigação.** Skill de projeto é instalada **uma vez** em
`.claude/skills/<nome>/`. `.agents/skills` (onde o Codex procura), `.codex/skills`
e `.opencode/skills` são links simbólicos para `../.claude/skills`, e
`.opencode/commands` para `../.claude/commands`, portanto Codex, Claude Code e
OpenCode leem o mesmo conteúdo. Agentes não entram por symlink: o formato
difere entre os harnesses, e o espelho gerado segue [G85](#g85). Nunca copie
uma skill para os três diretórios: atualização e remoção acontecem só na cópia
canônica. O binding da regra 24 prevalece sobre
status/grafo locais sugeridos por skills globais: adapte o procedimento neste
projeto, sem editar a instalação global nem criar cópias por harness.

Prova: `pnpm check:instructions` (no `pnpm check` e no CI) reprova symlink
trocado por cópia, apontado para outro destino ou quebrado, instrução duplicada
por harness (`.codex/AGENTS.md` e afins que não sejam symlink para a entrada), e
link, âncora ou ID de regra quebrado na entrada, em `docs/engineering/rules/` e
no `SKILL.md` de cada skill — inclusive rótulo `[G44]` apontando para `#g43`,
regra sem linha no inventário e regra com dois destinos primários.
`tests/instructions-gate.test.ts` induz cada regressão numa árvore temporária.

O conjunto instalado cobre o ciclo: `documentation-writer` na autoria,
`drizzle-safe-migrations` em schema, `a11y-testing` no E2E,
`agent-output-audit` para conferir tarefas de agentes, `deslop` antes da revisão
e `ship-pr` depois do veredito de `deep-review`.

<a id="g72"></a>
### G72 — Configuração de harness adapta acesso, não redefine política

**Obrigação.** `AGENTS.md` é a única fonte autoral; `CLAUDE.md` é um symlink para
ela — edite só `AGENTS.md`. `.codex/config.toml`, `.claude/settings.json` e
equivalentes orientam descoberta, comandos e permissões do próprio harness; não
copiam regras nem as redefinem. Lista de permissões de um harness não vale como
política para os outros.

**Resolve C12.** O comentário de `.codex/config.toml` mandava "editar ambos"
AGENTS e CLAUDE; como CLAUDE é symlink, há um arquivo só.

<a id="g85"></a>
### G85 — Claude Code, Codex e OpenCode no mesmo contrato

**Obrigação.** Regras, skills, agentes, comandos e permissões valem igual nos
três harnesses. Cada assunto tem **uma** fonte canônica — `AGENTS.md` e
`docs/engineering/rules/` para instruções, `.claude/` para o resto; o que é
idêntico entre os harnesses chega aos outros por symlink, e o que muda de
formato chega por espelho **gerado** — nunca escrito à mão.

| Assunto | Fonte canônica | Claude Code | Codex | OpenCode |
|---|---|---|---|---|
| Instruções | `AGENTS.md` + `docs/engineering/rules/` | `CLAUDE.md` (symlink) | `AGENTS.md` (descoberta nativa) | `AGENTS.md` + regras em `opencode.json > instructions` |
| Skills | `.claude/skills/` | nativo | `.agents/skills` (symlink; `.codex/skills` para versões anteriores) | `.opencode/skills` (symlink) |
| Comandos | `.claude/commands/` | nativo | sem suporte de projeto — peça pelo nome e leia o arquivo | `.opencode/commands` (symlink) |
| Agentes | `.claude/agents/*.md` | nativo | `.codex/agents/*.toml` (gerado) | `.opencode/agents/*.md` (gerado) |
| Permissões | `.claude/settings.json` | nativo | `.codex/hooks.json` (gerado) → `scripts/harness/codex-guard.ts` | `opencode.json > permission` (gerado) |

Mudou uma fonte, rode `pnpm harness:sync` e commite fonte e espelhos juntos.

- **Agente canônico** tem só `name` (igual ao arquivo), `description`,
  `role`, `tools`, `model` e `effort`. Sem `tools` o Claude Code dá todas as
  ferramentas; por isso ele é obrigatório. `role` escolhe, em
  `config/model-routing.json`, o modelo e o effort de cada espelho; `model` e
  `effort` do canônico precisam ser os do Claude Code na mesma política
  ([G87](orchestration.md#g87)). Sem `Edit`/`Write`, o agente é de leitura: `sandbox_mode =
  "read-only"` no Codex e `edit: deny` no OpenCode. No OpenCode, toda
  ferramenta mapeada em `OPENCODE_TOOL` (`scripts/harness/permissions.ts`) que
  o `tools:` não dá (`webfetch`, `websearch`, `bash`…) é negada no agente, e o
  espelho só restringe — um `allow` no agente venceria o
  deny global, porque lá a regra do agente é avaliada depois.
- **Comando** tem só `description` no frontmatter: o OpenCode lê o mesmo
  arquivo e ignora o que só o Claude Code entende (`allowed-tools` ficaria
  mais largo do outro lado).
- **Permissões** não são reescritas por harness. No OpenCode, a tradução
  mantém a precedência do Claude Code (deny > ask > allow) dentro da regra do
  OpenCode (a última que casa vence) e alarga padrão de arquivo em vez de
  estreitar. No Codex, que não tem lista por padrão de texto, o hook aplica a
  própria lista do Claude a cada comando e `apply_patch`; `ask` vira
  bloqueio, porque o hook do Codex não sabe perguntar — o que no Claude espera
  aprovação, no Codex espera a pessoa rodar; se o processo da guarda falhar, o
  hook sai com código 2 e bloqueia. O `ask` implícito do Claude (comando sem
  regra, qualquer edição) fica com o sandbox e a aprovação que a pessoa
  escolheu no Codex (recomendado: `workspace-write` com `on-request`, ou mais
  estrito); o projeto não fixa esses valores, porque a camada de projeto
  sobrescreveria também a escolha pessoal mais estrita. O Codex só carrega
  hooks e agentes de projeto confiável (`trust_level` no
  `~/.codex/config.toml`).
- **Prefixo `rtk` e invólucros.** Codex e OpenCode escrevem `rtk sudo ls`
  (G63); no Claude Code o hook do rtk reescreve depois da decisão. Por isso a
  guarda do Codex julga cada trecho também sem `rtk`, sem invólucro (`env`,
  `command`, `timeout`…), sem o caminho do executável (`/bin/rm`) e com o
  corpo de `sh -c`, e só corta o comando fora de aspas simples. O que a
  leitura de texto não enxerga por inteiro — trecho que começa por invólucro,
  shell, `eval`, `xargs` e afins sem allow explícito, ou aspas `$'…'` — é
  `ask`, exatamente como no Claude Code, onde nada o libera; a guarda só deixa
  ao sandbox do Codex o que consegue ler. O OpenCode recebe cada padrão
  ancorado de `ask`/`deny` também como `rtk <padrão>` e `rtk proxy <padrão>`.
- **Limites conhecidos.** Comandos no Codex; ferramenta por agente no Codex
  (só `sandbox_mode` distingue leitura de escrita — não há lista de
  ferramentas por agente); regra `WebFetch`/`WebSearch` com domínio (a
  tradução recusa em vez de perder o deny, e a guarda do Codex só julga shell e
  patch); e a leitura automática das regras por domínio (só o OpenCode carrega
  por configuração; Claude Code e Codex leem pelo roteador da entrada) são
  diferenças do harness, não da política.

Prova: `pnpm check:harness` (no `pnpm check` e no CI) reprova espelho
ausente, divergente ou órfão, `.opencode/agents` como symlink, agente fora do
contrato ou com modelo diferente da política, e comando com campo de um
harness só. `tests/harness-parity.test.ts`
prova que a tradução do OpenCode nunca é mais permissiva que o Claude Code e
que a guarda do Codex nega o que ele nega ou perguntaria por regra explícita,
inclusive com o prefixo `rtk` e em comando composto.

<a id="g63"></a>
### G63 — RTK por harness

**Obrigação.** Conforme `~/.claude/RTK.md` (configuração global do usuário, não
copiada para cá): no Codex e no OpenCode todo comando de shell vai prefixado com
`rtk`; no Claude Code o hook global reescreve e não duplica o prefixo.
`rtk proxy <comando>` só quando a saída bruta é necessária — o resumo do `rtk`
já escondeu erro de ferramenta uma vez, então leia o log bruto quando o
resultado importa.

<a id="g64"></a>
### G64 — O bloco gerado pelo Next fica intacto

**Obrigação.** O bloco "This is NOT the Next.js you know", ao fim de
`AGENTS.md`, é escrito e re-adicionado por `next dev`
(`node_modules/next/dist/server/lib/generate-agent-files.js`). Não o edite como
texto autoral nem o mova. Ele manda ler o guia da versão instalada em
`node_modules/next/dist/docs/` antes de escrever código e respeitar avisos de
depreciação — obrigação que vale como está.
