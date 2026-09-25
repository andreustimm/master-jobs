# Trabalhar e retomar sem deixar trabalho perdido

O fluxo continua sendo worktree de `dev` → PR para `dev` → promoção automática
para `staging` → aprovação humana para `main`. A regra 24 de
[AGENTS.md](../../AGENTS.md) define a autoridade operacional: issue e
[Project 3 — Master Jobs](https://github.com/users/andreustimm/projects/3).
Git continua sendo a fonte de specs, código e evidências. Este documento é o
roteiro; as regras que ele executa, com escopo e exceções, estão em
[rules/delivery.md](rules/delivery.md).

## Preparação e ativação

Este roteiro acompanha o [épico #181](https://github.com/andreustimm/master-jobs/issues/181).
Integrar a CLI e estas instruções em `dev` **não ativa o escritor remoto**.
O workflow de `issue_comment` precisa do código confiável na branch default
`main`, de `PROJECTS_TOKEN` e da chave do escritor validados, de `preflight` aprovado e
do piloto de rollout confirmado. A promoção para `main` continua humana.

Durante o bootstrap do próprio épico, o coordenador registra na issue remota
a execução, branch, worktree, motivo e evidência dessa preparação. Esse registro
permite construir o controle antes de ele estar disponível; não equivale a recibo
da CLI nem autoriza anunciar enforcement ativo. A exceção termina no corte
registrado no épico. Fora desse bootstrap, CLI/escritor indisponível impede
iniciar ou retomar execução sob o novo fluxo; não há fallback autoritativo local.

A referência detalhada da CLI, entregue com o épico, fica em
`docs/engineering/github-project-tasks.md`. Antes de usar os comandos abaixo,
confira sua disponibilidade no checkout e a prontidão remota:

```bash
rtk pnpm tasks preflight
```

A promoção roda às 15:00 e 21:00 UTC com a ponta de `dev` cujo CI de push está
verde, ou por dispatch com um SHA explícito. O commit de release recebe o mesmo
CI antes de avançar `staging`; retentativas conservam o alvo. Veja o
[contrato e a retomada da promoção](promotion.md).

## Começar ou retomar

Use Node 24.19.0, fixado em `.nvmrc` e compatível com `package.json`.
Quem usa nvm pode executar `nvm use` antes dos comandos.

1. Rode `rtk git status --short --branch` e `rtk pnpm worktrees`.
   O segundo comando só consulta o estado local; atualize as referências com
   `rtk git fetch origin --prune` antes de decidir sobre integração.
2. Consulte a issue remota e seus campos, dependências, entrega exigida,
   execução e revisão antes de iniciar **e a cada retomada**:
   `rtk pnpm tasks show <issue> --json`. Confirme vínculo ao Project 3 e
   ausência de bloqueio ou posse incompatível. Assignee humano não identifica
   uma execução: duas sessões da mesma pessoa continuam concorrentes.
3. Reuse a worktree da demanda se ela já existir. Para trabalho novo, crie
   `<tipo>/<slug>` a partir de `origin/dev` em worktree própria.
   `.githooks/pre-push` valida o nome; `codex/*` permanece legado aceito.
   Se houver WIP na raiz, preserve patch **e arquivos não rastreados** em
   `data/workspace-recovery/` ou na worktree responsável e confira a cópia.
   Nunca use `reset --hard` ou `clean -fd` como solução genérica.
4. Obtenha claim remoto antes de editar. Use ID novo por execução, associado
   pelo comando à branch e ao worktreeId do checkout. Guarde o ID para as
   próximas operações da mesma execução; não o substitua por nome de pessoa.
5. Confirme o vínculo com `verify`. Uma execução interrompida retoma com
   `resume`, revisão remota atual e evidência; recibo antigo não concede posse.
   Não atualize base nem remova worktree de outro trabalho. Portas, banco e
   build de teste pertencem à execução; dados reais ficam fora.

Toda demanda tem issue, inclusive correção pequena. Se não existir, escreva
objetivo, aceite, **Entrega exigida** e **tamanho** em arquivo e use `create`.
O tamanho decide a especificação ([R24](rules/delivery.md#r24-tamanho)):

| Tamanho | Antes de executar |
|---|---|
| S | objetivo + critério de aceite, na issue |
| M | techspec curta + `_tests.md` em `.compozy/tasks/<slug>/` |
| L | PRD + techspec + `_tests.md` (skills `cy-create-prd`, `cy-create-techspec`) |

Na dúvida entre dois tamanhos, fique com o maior.

Nos exemplos, substitua os valores entre `<...>`. Obtenha UUIDs com
`rtk proxy uuidgen`: um para a execução e um por operação de escrita.
Reutilize o UUID da operação somente ao repetir a mesma intenção/payload.

```bash
rtk pnpm tasks create --title "<título>" --body-file "<arquivo>" --priority "<Crítica|Alta|Média|Baixa>" --type "<tipo>" --delivery "<dev|production|artifact|operation>" --operation "<uuid-da-operação>"
rtk pnpm tasks show <issue> --json
rtk pnpm tasks claim <issue> --execution "<uuid-da-execução>" --operation "<uuid-da-operação>"
rtk pnpm tasks verify <issue> --execution "<uuid-da-execução>"
```

`create` também aceita `--parent <issue>` e `--depends-on <issues>`.
Confirme a issue criada e seu vínculo remoto antes do claim. Para issue existente
sem vínculo, preserve seu número: o coordenador usa a adoção administrativa,
sem criar uma cópia:

```bash
rtk pnpm tasks adopt <issue> --delivery "<dev|production|artifact|operation>" --type "<tipo>" --priority "<prioridade>" --operation "<uuid>"
```

## Atualizar, bloquear, retomar ou transferir

Use os nomes de status configurados no Project e a revisão retornada por
`show`; não calcule revisão nem traduza status a partir do frontmatter local.
A escrita envia intenção durável e aguarda recibo do coordenador. Sem recibo
confirmado, o resultado permanece pendente/falha, mesmo que um arquivo tenha
sido atualizado.

```bash
rtk pnpm tasks transition <issue> --execution "<id>" --revision "<revisão>" --status "<status>" --evidence "<url>" --operation "<uuid>"
rtk pnpm tasks block <issue> --execution "<id>" --revision "<revisão>" --reason "<motivo>" --operation "<uuid>"
rtk pnpm tasks resume <issue> --execution "<id>" --revision "<revisão>" --evidence "<url>" --operation "<uuid>"
rtk pnpm tasks heartbeat <issue> --execution "<id>" --revision "<revisão>" --operation "<uuid>"
rtk pnpm tasks release <issue> --execution "<id>" --revision "<revisão>" --reason "<motivo>" --operation "<uuid>"
rtk pnpm tasks transfer <issue> --execution "<id>" --revision "<revisão>" --to-execution "<novo-id>" --to-branch "<branch>" --to-worktree "<worktreeId>" --to-public-key "<SPKI-base64>" --reason "<motivo>" --operation "<uuid>"
```

`transition` aceita `--reason <texto>` quando a decisão precisa de justificativa.
`heartbeat` renova somente lease válido; não recupera uma execução expirada.
Antes da transferência, combine o destinatário e preserve WIP/evidências; depois,
o destinatário lê o remoto e verifica seu próprio checkout antes de trabalhar.

A CLI assina os comandos de execução automaticamente. A chave privada Ed25519
fica no gitdir da worktree, com modo `0600`; não deve entrar em commit, issue ou
log. O destinatário obtém a chave **pública** no próprio checkout para informar
`--to-public-key` ao transferente:

```bash
rtk pnpm tasks key --execution "<novo-id>"
```

A identidade GitHub autoriza o ator; a assinatura comprova a execução. Copiar
IDs públicos de outra execução não transfere sua posse.

O escritor também assina recibos, controle e coordenação com uma chave própria.
`TASKS_WRITER_PRIVATE_KEY` fica somente no CI confiável; a chave pública fica em
`config/tasks-project.json`. O provisionamento é explícito, sem reutilizar outra
credencial. Um comentário do mesmo login GitHub não comprova um recibo: a
assinatura do escritor precisa ser validada.

| Situação | Procedimento |
|---|---|
| Lease vencido ou claim incompatível | Pare a edição; consulte `show` e `verify`. O recibo `task-claim.json` fica no gitdir da worktree, consultável com `rtk git rev-parse --git-path task-claim.json`; é descartável e não autoriza offline. Lease vencido exige recuperação administrativa antes de novo claim; não use retry de heartbeat nem assuma que expiração transfere a execução. |
| Timeout após enviar escrita | Consulte o remoto e repita a mesma operação com o mesmo UUID/payload para obter o recibo; não gere outra intenção para “garantir”. |
| Conflito de revisão confirmado | Releia a issue e avalie a mudança concorrente antes de decidir uma nova operação. Não sobrescreva snapshot remoto com a versão da branch. |
| GitHub indisponível | Preserve WIP e registre diagnóstico técnico local; não avance status, conclua tarefa ou inicie execução com base no cache. |
| Bloqueio ou abandono | Use `block` ou `release` com motivo e revisão. Mensagem no chat ou checkbox local não libera claim. |
| Edição manual de Status | Use comando coordenado ou pause e drene o escritor antes da edição; reconcilie antes de retomar. Não há garantia de exclusão contra UI irrestrita. |

Os comandos administrativos abaixo exigem confirmação remota. `pause` e
`unpause` são globais, pela issue de controle: espere a pausa e a drenagem antes
de editar Status manualmente. `unpause` incrementa o epoch e invalida revisões
anteriores; as execuções devem reler o remoto. `reconcile` recupera intenção
parcial ou libera lease expirado com motivo e evidência de WIP preservado;
nunca escolhe automaticamente um novo detentor.

```bash
rtk pnpm tasks pause --reason "<motivo>" --operation "<uuid>"
rtk pnpm tasks reconcile <issue> --revision "<revisão>" --reason "<motivo>" --evidence "<url>" --operation "<uuid>"
rtk pnpm tasks unpause --reason "<motivo>" --operation "<uuid>"
```

Esses comandos não publicam snapshots da branch. Transições automáticas não
reescrevem prioridade nem ordem do quadro. Dependências são relações nativas
do GitHub; nenhuma execução pode atualizar tarefas concorrentes por
sincronização em lote.

Eventos de PR, CI e deploy produzem evidências ou sugestões que precisam de
revalidação; não substituem a transição assinada pelo detentor. Um evento
atrasado não deve sobrescrever uma decisão manual mais recente.

## Compozy, memória e evidências

Trabalho que atravessa sessões pode manter contexto técnico em
`.compozy/tasks/<slug>/`: decisões, comandos, provas e próximo passo, com link
da issue. Estado, prioridade, assignee, dependências e claim vêm do remoto.
O backlog antigo fica como histórico ou referência; uma lista editável local
não vira outra fila operacional.

Para obter uma projeção identificada de issue, subtarefas e grafo:

```bash
rtk pnpm tasks refresh <issue> --out "<diretório-de-projeção>"
```

A projeção deve indicar proveniência/revisão; `refresh` não altera specs
autorais. Não editar projeção para comandar o remoto, nem executar bulk sync
de `_tasks.md`, `state.yaml` ou frontmatter. Specs e contratos de testes
continuam autorais em Git; resultados de cenário QA, achados de revisão e
vereditos locais são evidência, distintos do status da issue.

O binding vale também para skills globais usadas neste projeto, sem alterá-las
para outros repositórios:

| Skill | Aplicação no Master Jobs |
|---|---|
| `cy-create-tasks` | Autorar decomposição/spec; registrar issues e relações remotas; grafo operacional local é projeção, não autoridade. |
| `cy-execute-task` | Ler/claim/verify antes de executar; verificação local não autoriza escrever `completed` como status operacional. |
| `cy-workflow-memory` | Guardar memória técnica e evidência; retomada sempre consulta o remoto. |
| `cy-review-round` | Conferir contrato e entrega exigida da issue; apontar URL da issue/PR e veredito de revisão. |
| `cy-fix-reviews` | `valid/invalid/resolved` de achados descreve análise; resolução do achado não conclui automaticamente a tarefa. |

## Validar pelo risco

| Mudança | Evidência local necessária | Revisão (G53) |
|---|---|---|
| Markdown e metadados | Estrutura, links e scripts afetados: `pnpm check:instructions`, `pnpm check:release-ready`, `pnpm check:qa-tracker` | L0 (só `.md`): nenhuma |
| Ferramenta de desenvolvimento | Testes de comportamento da ferramenta e comandos afetados | L1 |
| Runtime | `rtk pnpm typecheck`, `rtk pnpm exec vitest related --run <arquivos>` e E2E afetado | L1 |
| Comportamento percebido pelo usuário | Os de runtime e QA targeted conforme [QA vivo](../qa/README.md) | L1 |
| Schema, autenticação, `/p/`, promoção, scorer ou segredos | Os de runtime e os gates específicos existentes; não reduzir os testes por conveniência | L2 |

A suíte completa roda no CI da PR, que abre como **draft** logo depois do
primeiro verde local e vira pronta depois do SHIP e do CI verde
([G57](rules/delivery.md#g57)). Orçamento por gate: check local ≤ 10 min, E2E
afetado ≤ 8 min, deep-review L1 ≤ 10 min, L2 ≤ 30 min. Estourou: registre na
PR, delegue ao CI o que ele cobre e siga; o que o CI não cobre fica pendente.

O nível da revisão sai de
`python3 .claude/skills/deep-review/scripts/review_level.py --out <out>`
depois do manifesto; a tabela acima é o resumo, o script é a regra. Um revisor
por diff ([G84](rules/delivery.md#g84)): `agent-output-audit` só para trabalho
delegado que chegou sem veredito da deep-review. Minor e advisory viram uma
linha na PR; só Critical/Major pedem nova rodada, que revisa só o delta, com
teto de 3.

Rode suites pesadas em sequência na mesma máquina. Se código/base mudar depois
da validação, renove os checks afetados. Registre comando, resultado e revisão
na PR e vincule essa evidência à issue. Execução não realizada continua pendente.
Um resultado `Pass`, `SHIP` ou uma checkbox não confirma a entrega exigida.

## Escrever o changelog

Cada PR com mudança releaseável (`fix:`, `feat:` e afins) cria **um arquivo
próprio** em `changelog.d/`, com o slug da branch: `fix/filtro-de-estagio` →
`changelog.d/filtro-de-estagio.md`. Ela **não edita** o `## [Unreleased]` de
`CHANGELOG.md`, `USER_CHANGELOG.pt-BR.md` nem `USER_CHANGELOG.en.md`. Quando
toda PR editava os mesmos três trechos, cada merge em `dev` — e cada
`chore(release)` da promoção — reabria conflito em todas as PRs abertas, com
merge manual e CI de novo. Arquivos distintos não conflitam.

```markdown
## Técnico

### Corrigido

- O que mudou, para quem mexe no código: módulo, decisão, defeito fechado.

## pt-BR

### Corrigido

- O efeito para quem usa, em linguagem simples.

## en

### Fixed

- The effect for users, in plain language.
```

- Os três blocos são obrigatórios, com esses nomes exatos. Conteúdo fica sob
  `### Seção` (`Adicionado`, `Alterado`, `Corrigido`, `Segurança`…; nos de
  usuário, `Novidade`, `Melhorado`, `Corrigido`…) e começa por item `- `.
- Sem efeito visível, `pt-BR` e `en` trazem só `<!-- sem-nota-usuario -->`,
  os dois juntos. O bloco técnico sempre tem conteúdo.
- Cabeçalho `#` ou `##` além dos três blocos é recusado: dentro do changelog
  ele viraria uma versão.
- Todo arquivo em `changelog.d/` precisa ser `[a-z0-9][a-z0-9._-]*.md`; um
  `.MD` ou `.txt` reprova em vez de sumir.

A promoção junta os fragmentos no `Unreleased`, em ordem de nome de arquivo e
com as seções na ordem da primeira aparição, carimba a versão e apaga os
fragmentos no mesmo commit `chore(release)`. `pnpm check:release-ready` e o
hook `commit-msg` aceitam o fragmento como nota da leva e reprovam fragmento
malformado mesmo sem bump. Entrada escrita direto no `Unreleased` continua
aceita durante a transição e aparece antes das dos fragmentos. Até a versão que
traz os fragmentos chegar a `main`, o controlador da promoção ainda é o antigo:
fragmento criado nessa janela sai uma versão depois do código (ver
[promotion.md](promotion.md#evidência-e-limites)).

## Entregar e limpar

Antes de a PR ficar pronta: `show` e `verify` da execução, deslop, deep-review
com veredito SHIP no nível do diff (L0 dispensa) e responsável atribuído — a
PR draft já ganha o responsável ao nascer. A descrição liga issue, entrega exigida, evidências
e pendências. Para este projeto, merge em dev só conclui entrega `dev`;
entrega `production` exige publicação correspondente; `artifact` ou
`operation` exigem o resultado declarado. Workflow novo em `issue_comment`
só opera depois de disponível na default main e ativado. Fechamento automático
da issue reflete decisão comprovada, nunca substitui essa prova.

**`Closes #N` vai na mensagem do commit, não só na descrição da PR.** A
branch padrão é `main`, e a PR aponta para `dev`: palavra-chave na descrição
não fecha nada, porque o GitHub só a lê quando a PR entra na branch padrão. Na
**mensagem do commit** ela fecha a issue quando o commit chega a `main` — ou
seja, quando entrou em produção pela PR `staging → main`, que é o critério da
entrega `production`. Pelo menos um commit da PR carrega uma linha
`Closes #N` por issue entregue por inteiro; entrega parcial usa `Refs #N`.
Issue com entrega `dev`, `artifact` ou `operation` continua sendo concluída
pela transição explícita, com a prova correspondente.

Depois do merge:

1. Confirme no GitHub integração do último commit da PR; em squash, compare
   conteúdo com o commit do merge. Registre a evidência e efetue a transição
   adequada à entrega exigida; não conclua tudo só porque entrou em dev.
2. Antes de remover a worktree, resolva/libere o claim conforme o estado remoto,
   usando `release` quando necessário. Se a escrita não confirmar, preserve
   checkout/recibo para recuperar a operação.
3. Confirme worktree limpa e preserve evidências locais relevantes. Estar no
   mesmo HEAD de dev não torna seguro apagar WIP.
4. Remova worktree e branch de trabalho local/remota apenas após a integração.
   Rode `rtk git fetch origin --prune` e `rtk pnpm worktrees`; atualize a raiz
   limpa com `rtk git merge --ff-only origin/dev`.

Sem PR mesclada ou com commits posteriores, preserve a branch e registre a
pendência na issue. `dev`, `staging` e `main` permanecem sempre.

## Proteção local

`pnpm install` configura `.githooks`. `prepare-commit-msg` impede commit
em branches permanentes; `pre-push` impede push direto para elas, inclusive
feature:dev, e valida o nome da branch de trabalho. Hooks não protegem escritas
pela API; não substituem política remota, claim ou recibo.

## Proteção remota

Rulesets do GitHub impedem exclusão e force-push em `main`, `staging` e `dev`
para todos, e exigem em `main` PR aprovada e CI verde sem bypass de CI. `dev` e
`staging` ainda não exigem PR nem CI no remoto: a plataforma não aceita a
exceção de que a promoção automática precisaria. O que está aplicado, o
caminho humano do hotfix, os limites e a reversão estão em
[github-protections.md](github-protections.md). Confira com
`rtk node scripts/github/verify-protections.ts`.

## O que foi adaptado de contas_casal

Mantemos isolamento por demanda, preservação antes de reconciliar a raiz,
validação proporcional e limpeza após merge. A antiga dispensa de sincronização
com GitHub Project está **revogada**: toda tarefa segue a regra 24 e o corte
de ativação acima. Specs extensas e Compozy continuam opcionais conforme o
trabalho; issue no Project é obrigatória. Contas Casal e Project 2 não fazem
parte deste fluxo.
