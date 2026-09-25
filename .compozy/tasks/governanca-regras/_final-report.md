# Relatório final da verificação (task_11 / #205)

> **Atualização #308 (24/09/2026, branch `test/governanca-g41`).** P0-1
> (G41 / V03-06), E16 e E27 foram resolvidos; detalhe em "Atualização #308"
> no fim deste relatório. Restam P0-2 e P0-3, que dependem do dono. O texto
> abaixo continua sendo a fotografia de `c23f8ba2`.

**Veredito: governança NÃO certificada como concluída.** Há três pendências
ligadas a obrigações P0 (seção "Pendências P0"). Nenhuma delas indica uma
violação observada. Faltam uma prova planejada (V03-06) e duas observações que
só o dono pode fazer (G80, e o limite de identidade de G46, que só ele pode
aceitar ou mudar). O épico
[#194](https://github.com/andreustimm/master-jobs/issues/194) **não deve ser
fechado** enquanto cada uma delas não estiver resolvida, ou aceita por escrito
pelo dono como limite.

Este relatório separa quatro tipos de prova e não mistura um com outro:

- **[R]** configuração remota observada agora, por GET;
- **[X]** teste executado nesta verificação, ou CI observado no SHA verificado;
- **[L]** análise por leitura de código e documentos;
- **[H]** verificação humana pendente.

"Teste lido" nunca aparece como teste aprovado.

## Ambiente e alvo

| Item | Valor |
|---|---|
| Commit verificado | `c23f8ba21f53af8ddcfef1cf5641bb38a4e41076` (`origin/dev` = `origin/main` = v1.25.1, merge da PR #306) |
| Worktree | `.claude/worktrees/governanca-verificacao-final`, branch `docs/governanca-verificacao-final` |
| Data | 2026-09-24, entre 20:59 e 21:40 UTC |
| Node / pnpm | `v24.14.0` / `10.28.0`. O projeto pede `^24.19.0`; o aviso de engine apareceu e não bloqueou |
| Docker | PostgreSQL 17 descartável do global setup do Vitest, em loopback |
| Identidade GitHub | `andreustimm` (sessão `gh`). Nenhum secret lido e nenhuma escrita remota feita |

## Entregas das irmãs (#195–#204)

As dez issues estão fechadas como `COMPLETED`. Fecharam quando o commit com
`Closes #N` chegou a `main`, nas promoções de 22/09 e 23/09.

| Plano | Issue | PR para `dev` | Veredito declarado na PR |
|---|---|---|---|
| task_01 | #195 | #225 | SHIP, 6 Minor em follow-up |
| task_02 | #196 | #272 | SHIP, 1 Minor em follow-up (o verificador não acusa ruleset extra) |
| task_03 | #197 | #233 | SHIP, 2 Minor e **decisão do dono** sobre o filtro do CV público |
| task_04 | #198 | #232 | SHIP |
| task_05 | #199 | #231 | SHIP. **V05-05 declarada como não comprovada** |
| task_06/07 | #200, #201 | #274 | SHIP, 1 Minor |
| task_08 | #202 | #267 | SHIP. O E2E entra no CI, mas **não é obrigatório** |
| task_09 | #203 | #277 | SHIP |
| task_10 | #204 | #271 | SHIP, 2 Minor em follow-up |

Os vereditos acima estão declarados nas PRs e não foram refeitos aqui. O que
esta verificação refez está nas seções V11-01 a V11-04.

## V11-02 — Checks no diff final

| Prova | Tipo | Resultado |
|---|---|---|
| `pnpm check` na worktree, em `c23f8ba2` (21:02 UTC) | [X] | exit 0. **304 arquivos passaram, 1 pulado; 4178 testes passaram, 8 pulados** (186,7 s). Cobertura: statements 97,87%, branches 94,65%, functions 98,38%, lines 98,42%, todas acima dos limiares. `test:qa-skills`: 13 OK. `check:qa-tracker`: 96 cenários conforme o esquema |
| O arquivo pulado | [L] | `tests/pwa-chrome.test.ts`, condicionado a `JHO_PWA_BROWSER_TESTS=1`. Não rodou localmente |
| CI do SHA `c23f8ba2` | [X] (observado) | `qualidade`, `schema-e-migracao`, `contratos`, as 4 fatias de `testes`, `cobertura`, `build`, `pwa-browser`, `e2e-navegador`, `fumaca` e `migrar` terminaram em `success`. `validacao` foi pulado; ele só roda na chamada da promoção |
| CI de `dev` | [X] (observado) | As 14 execuções de push mais recentes, desde 23/09 16:02, terminaram verdes. Houve 1 cancelada antes delas |
| `pnpm test:e2e` local | não executado | O diff desta tarefa é só Markdown e JSON (G57). O E2E de navegador do mesmo SHA está verde no CI (`e2e-navegador`) |
| `node scripts/rules/check-instructions.ts` | [X] | "symlinks dos harnesses, links, âncoras e inventário de regras conferem" |
| Conferência avulsa de completude (script local, fora do repo) | [X] | 84 linhas no inventário, 84 âncoras `g01`–`g84` definidas uma vez cada, nenhuma faltando, duplicada ou sobrando. As 54 citações de G em `AGENTS.md` resolvem |

O gate `check-instructions` confere que âncora e linha do inventário são
coerentes. Ele **não** confere que G01–G84 estão todas presentes: se uma
obrigação sumisse das duas camadas ao mesmo tempo, ele passaria. A conferência
avulsa fez isso agora, uma vez só, e é fácil de repetir. Ela gera os IDs
`G01`–`G84`, lê as linhas `| Gnn |` de `docs/engineering/rules/README.md` e as
âncoras `<a id="gnn">` dos outros arquivos de `rules/`, e exige exatamente uma
linha e uma âncora por ID. Não há um gate permanente para isso.

## V11-03 — Proteções e configuração remota [R]

Os valores observados estão em
[evidencias/task_11-protecoes.json](evidencias/task_11-protecoes.json)
(20:59 UTC). Não houve nenhuma tentativa destrutiva nem escrita.

- **Rulesets ativos:** são três, iguais aos de 23/09
  ([task_02-depois.json](evidencias/task_02-depois.json)).
  - `main`: `qualidade` e `schema-e-migracao` obrigatórios, sem bypass.
  - `main`: PR com 1 aprovação. O bypass de admin vale só dentro de PR.
  - `main`, `staging` e `dev`: sem exclusão e sem force-push, sem bypass.
  - `node scripts/github/verify-protections.ts` imprimiu `ok` nas quatro linhas.
  - Não há ruleset extra fora da política. O Minor da #272 continua sem gate.
- **`dev` e `staging`:** o remoto recusa só exclusão e force-push. PR e CI
  nessas branches continuam por processo e hooks. A API recusa o GitHub Actions
  como bypass num repositório de conta pessoal (422), e isso está documentado em
  [github-protections.md](../../../docs/engineering/github-protections.md).
- **Ambiente `Production`:** só `main` implanta, com `can_admins_bypass: false`.
  Não há revisor obrigatório; a razão (cron e manutenção) está documentada.
- **Permissões do Actions:** `default_workflow_permissions: write` e
  `can_approve_pull_request_reviews: true`. O token dos workflows pode aprovar
  PR. O limite está documentado.
- **PRs de produção:** as cinco últimas (#262, #290, #298, #304, #306) têm como
  autor `github-actions[bot]` e foram mescladas por `andreustimm`, todas com
  `reviewDecision: REVIEW_REQUIRED`. Ou seja, entraram pelo bypass de admin
  dentro da PR, e não por aprovação. A regra permite isso. O GitHub não
  distingue se quem clicou foi a pessoa ou um agente com a mesma credencial
  (ver P0-3).
- **Deployments da Vercel:** o último deployment de `Production` registrado por
  `vercel[bot]` é de 23/09 às 14:38 UTC (`a3350b6a`). Não há registro da Vercel
  para 1.23.0–1.25.1 (`c23f8ba2`, por exemplo, só tem o registro do workflow
  `migrar`). O CI do SHA confirma que o CSS de produção é do build novo, então a
  publicação aconteceu. O que sumiu foi o registro. É justamente a conferência
  que [github-protections.md](../../../docs/engineering/github-protections.md)
  ("Deployments da Vercel") pede ao dono: **[H]**.
- **Variáveis do Actions:** só `JHO_SOURCE_ALLOWLIST` e
  `SUPABASE_CRAWL_ENABLED`. `TASKS_ENFORCEMENT` não existe, então
  `tasks-check.yml` (o assignee e a base das PRs de trabalho) está desligado.
  Isso é coerente com a regra 24: o escritor coordenado ainda não foi ativado.

## V11-01 — Matriz de obrigações e evidências

### G01–G84

Destino e preservação [X/L]: cada obrigação tem um destino primário em
`docs/engineering/rules/`, e a entrada comum resume sem divergir, conforme o
gate e o script acima. Pelo inventário de `rules/README.md`, C01–C22 estão
resolvidos. C19 está resolvido só em `main`.

Pela matriz da auditoria, a classificação é: P0 = G01–G03, G09, G14,
G16–G25, G27–G28, G36–G41, G43–G46, G48, G50–G52, G68, G73, G75–G76, G79–G80
(37 obrigações). P1 = 39 obrigações. P2 = 8.

| Grupo | Situação atual | Base |
|---|---|---|
| P0 com prova comportamental no `check` de hoje (G01–G03, G09, G17–G22, G24–G25, G27–G28, G36–G40, G73, G75–G76, G79) | preservadas | [X] suíte verde, cujo conteúdo foi conferido por leitura [L] |
| P0 provadas só no CI (G14, G16) | preservadas | [X] CI observado em `c23f8ba2`, não no `check` local. G14 roda no job `pwa-browser`, que é obrigatório. G16 (a matriz por papel) roda no `e2e-navegador`, que **não bloqueia** |
| G23 (CV público) | preservada com limite declarado | [X] `public-profile` e `public-cv`. Valor sem rótulo e telefone sem marcador passam: o limite está declarado no teste. O cenário `PUB-public-cv-protected-content` está `untested` desde o reset de 22/09 [H]. A decisão do dono pedida na #233 (filtrar por padrão ou não publicar) continua sem registro [H] |
| G41 (chave fora do banco e do log) | preservada por leitura; **prova V03-06 ausente** (resolvida na #308, ver o fim) | ver P0-1 |
| G43–G46, G48, G50–G52 (fluxo e produção) | `main` protegida no remoto [R]; proveniência por SHA [L+X], com `promotion-provenance` no `check`; retorno com assignee [L+X] | limites em P0-3 |
| G68, G80 (PostgreSQL e privilégio mínimo) | provisionador provado em fixture [X] | a role efetiva em produção não foi observada: P0-2 |
| P1/P2 | preservadas no inventário. Lacunas residuais abaixo, em E27/E32/E33/E34 | [L] |

### E01–E34, reavaliadas em `c23f8ba2` [L]

A reavaliação é por leitura dos testes e do código atuais. O `check` que
executa esses testes está em V11-02.

| E | Estado | O que mudou desde a baseline / o que falta |
|---|---|---|
| E01 | fechada | Symlinks conferidos [X]. `instructions-gate` reprova cópia, destino errado e instrução duplicada. Não prova que cada harness carrega o que lê |
| E02 | fechada, com limite | `e2e-navegador` roda `pnpm test:e2e` no CI, mas fica fora de `qualidade.needs` (`NON_BLOCKING_CI_JOBS`). Cobertura continua só de `src/` |
| E03 | fechada, com dívida nomeada | Grafo de imports em qualquer grafia (`module-graph.ts`); pureza transitiva descoberta por diretório; `Date.now()` saiu do scorer. Dívida em `AMBIENT_DEBT`: `auth/domain/policy.ts` ainda usa `now = Date.now()` como padrão |
| E04 | parcial | `db-decision-integrity` prova byte a byte que importar de novo não toca `application` nem os eventos. O detector estrutural continua regex e só cobre três diretórios |
| E05 | fechada | Corrida entre descarte e candidatura provada com duas conexões reais. `delete(job)` único e guardado em `retention.ts` |
| E06–E09 | sem mudança; nunca foram lacuna de P0 | Recortes continuam os descritos |
| E10 | fechada | `scorer-version.test.ts` compara a impressão da saída com a versão. Limite declarado: mudança que não afeta a amostra |
| E11 | fechada, com limite | Fixture de `growth` contaminado, transporte instrumentado sem chamada, inventário fechado de transporte de saída. Texto livre de agente/LLM continua procedimento (M) |
| E12 | fechada | Política pura + `entry-denial` em runtime |
| E13 | fechada no Vitest | `discoverEntries()` pela semântica do Next; guarda antes do efeito; `entry-denial` contra PostgreSQL. A lista de páginas por escopo de candidato continua literal |
| E14 | fechada | Duas redenções simultâneas do mesmo token: uma vence, sessões caem |
| E15 | fechada, com limite | `publicCvText()` no caminho público, sentinelas de piso, e-mail e telefone |
| **E16** | **aberta** | `architecture.test.ts:849` ainda ignora qualquer arquivo que contenha `apiKeyEnv`; o log só é conferido para `console.log/error` com `apiKey` literal; não há sentinela de chave atravessando erro, log e persistência (V03-06) |
| E17 | fechada | `pwa-browser` é obrigatório no agregador. Servidor sintético, não o Next autenticado |
| E18 | parcial | Inventário de rotas amarrado ao inventário de páginas; `gotoMeasured` exige destino igual ao pedido. O detector de idioma continua léxico; 6 páginas em `UNMEASURED_PAGES`, com motivo |
| E19 | parcial | `design.test.ts` pega hex curto, `rgb/oklch`, paleta crua e tamanho fora da escala. axe numa viewport, sem laço de temas |
| E20 | fechada, com limite | `fk-delete-intent` exige `onDelete` escrito. A identidade de produção não é observada (P0-2) |
| E21 | fechada | `deploy.md` alinhado à lista de permissão de `sslmode` |
| E22 | fechada | Skill em PostgreSQL; `postgres-upgrade` migra banco populado (0003→atual). Migração nova não ganha teste populado automaticamente |
| E23 | parcial | Hooks sem mudança. No remoto, só integridade em `dev`/`staging` |
| E24 | parcial | `main` exige PR; o cliente GitHub dos testes de release continua falso |
| E25 | fechada | Promoção por SHA com CI provado também no dispatch; assignee em PR nova e reaproveitada, inclusive no retorno |
| E26 | parcial | Proteções aplicadas e reobservadas hoje [R]. Nenhum job agendado roda `verify-protections.ts`; limites em P0-3 |
| **E27** | **aberta** (P1) | `materialize_state.py` sem mudança: não confere se a evidência e o relatório referenciados existem nem se o SHA é atual |
| E28 | parcial | Links, âncoras e symlinks cobertos. Nenhum gate lê o corpo real da PR (docs, veredito, SHA); o gate de PR de tarefa está desligado |
| E29 | fechada, com limite | `ship-pr` alinhada a G54; `.codex/config.toml` corrigido. Coerência texto × regra continua revisão humana |
| E30 | parcial | Bloqueio de LinkedIn por host em todo salto, com teste. IP literal, proxy e ferramentas de agente ficam fora (limite declarado) |
| E31 | fechada | `open-mode.ts` com lista de permissão de ambiente; ninguém mais lê `JHO_AUTH_MODE` |
| E32 | sem mudança | A ressalva "append-only no ciclo autorizado" continua documentada em G75 |
| E33 | parcial | Todo `Promise.all` em `app/` entra no inventário `FAN_OUT`. Paralelismo dentro de `src/contexts` não é descoberto; `POOL` copiado em `db-fan-out.test.ts` |
| E34 | sem mudança | Zod, probe real e isolamento de falha continuam procedimento (M) |

## Pendências P0 (impedem a certificação)

1. **P0-1 — G41 / V03-06: prova da chave fictícia ausente.** *(Resolvida
   pela #308; ver "Atualização #308".)* Nenhuma PR da
   #197 entregou o caso V03-06. Uma chave-sentinela precisa atravessar
   configuração, erro do provedor, persistência e log, e não pode chegar a DB,
   log nem cache. Por leitura, `src/core/llm/providers.ts` não põe a chave no
   `LlmError`, e `llm-registry.test.ts` prova que o seed não grava chave. A
   parte de cache está coberta pelo `pwa-browser`. Falta a prova
   comportamental, e o gate estrutural de E16 tem o escape `apiKeyEnv`.
   **Ação:** tarefa de código (teste de sentinela e correção do filtro de
   `architecture.test.ts`). Precisa de issue nova ou da reabertura do escopo da
   #197; a decisão é do dono.
2. **P0-2 — G80 / V05-05: role de runtime em produção não observada.**
   [deploy.md](../../../docs/engineering/deploy.md) ("Configuração verificada
   em 22/09/2026") diz que `DATABASE_URL` com `master_jobs_app` está cadastrada
   e que ela "será aplicada no próximo deploy de produção aprovado por humano".
   Diz também que O-01 continua "em validação" até alguém confirmar sessões de
   `master_jobs_app` no banco. Houve cinco deploys de produção desde então, e
   nenhuma evidência dessa confirmação foi registrada. Esta verificação não
   conecta ao banco de produção. **[H]:** o dono confere
   `pg_stat_activity`/`current_user` do runtime e registra o resultado em
   `deploy.md`.
3. **P0-3 — G46: limites da proteção de produção, que o dono precisa aceitar
   ou mudar.** Os três estão documentados em
   [github-protections.md](../../../docs/engineering/github-protections.md) e
   foram reobservados hoje:
   - agentes usam a credencial do dono, que tem bypass de PR em `main`. As cinco
     últimas publicações entraram pelo bypass, sem aprovação;
   - `can_approve_pull_request_reviews: true`;
   - `dev` e `staging` não exigem PR nem CI no remoto.

   A regra "nunca mesclada por robô ou agente" continua dependendo das
   permissões do harness. **[H]:** registrar a aceitação desses limites, ou
   adotar o desenho com deploy key ou organização. Enquanto nenhuma das duas
   coisas acontecer, esta verificação não trata G46 como garantida pelo
   servidor.

## Outras pendências (não P0)

- **[H] Vercel:** a conferência de "Deployments da Vercel" deu que não há
  registro desde 23/09 14:38 UTC (V11-03). Decidir entre manter e remover a
  política de branch do ambiente.
- **[H] #233:** a decisão sobre o filtro por padrão do CV público continua
  pendente, e o cenário `PUB-public-cv-protected-content` precisa de reteste.
  O tracker em `c23f8ba2` tem 96 cenários: 41 `pass`, 34 `untested`, 16
  `blocked-verify`, 4 `blocked-decision` e 1 `fail`. O último relatório full é o da
  1.22.0, e 1.22.1–1.25.1 foram publicadas depois dele. Pela regra 20, o dono
  confere se a cadência de full valeu para essas versões.
- **Follow-ups Minor declarados nas PRs** e ainda sem issue:
  - o verificador não acusa ruleset extra (#272);
  - `RELEASE_PAT` precisaria de `actions:read` (#225);
  - crypto importado com alias e `fetch` sem pacote de rede (#271);
  - telefone com final parecido com ano, e custo quadrático do filtro (#233);
  - G65 e o texto da regra 2 (#274).
- **Gates que ainda não existem:**
  - completude G01–G84 como gate permanente;
  - ~~existência dos arquivos citados pelo tracker de QA (E27)~~ — entregue
    na #308;
  - corpo real da PR (E28);
  - `verify-protections.ts` agendado;
  - `e2e-navegador` obrigatório, a decidir depois de medida a instabilidade
    (#202).

## V11-04 — Entrega

- Diff desta tarefa: este relatório,
  [evidencias/task_11-protecoes.json](evidencias/task_11-protecoes.json), a
  seção "Reavaliação final" em [_evidence.md](_evidence.md) e a linha de status
  do [README.md](README.md). Nenhum `docs/` mudou: o que vale hoje está correto,
  e as pendências já estão descritas em `deploy.md` e `github-protections.md`.
- Sem fragmento de changelog: o commit é `docs:`, sem efeito para o usuário.
  Sem QA de jornada, porque não há mudança visível.
- O commit leva **`Refs #205`**, não `Closes`, por causa das pendências P0.
  Nada foi publicado em `main`. A limpeza da worktree fica para depois do merge
  confirmado.

## Atualização #308 — P0-1, E16 e E27

Branch `test/governanca-g41`, a partir de `origin/dev` `c565478e`, em
24/09/2026.

| Item | Estado | Prova |
|---|---|---|
| **P0-1 / G41 / V03-06** | **resolvida** | [X] `tests/llm-key-sentinel.test.ts`, 4 casos. Uma sentinela `nvapi-G41-<8 hex>` passa pelo caminho real (cadastro pela CLI → `chooseModel` → `portFor` → adapter → cabeçalho), e o provedor falso a ecoa. Ela é procurada no erro (mensagem, pilha, JSON, `inspect`), no evento após `scrubEvent`, em `jho analyze`, `jho llm list` e `jho analysis run`, no console durante o processamento da fila, em todas as tabelas do banco e no painel admin da análise |
| Defeito achado pela sentinela | corrigido | `redactText` só apagava `sk-…`: uma chave `nvapi-…` ecoada chegava ao terminal e ao Sentry. Agora os adapters apagam o valor exato (`redactSecret`), e a falha de `fetch` volta sem `cause` nem pilha original |
| **E16** | **fechada** | [X] Exceção por ocorrência (`keyHandlingLines`) em `src/` + `app/`, com caso negativo "arquivo com `apiKeyEnv` e `apiKey`". O log estrutural passa a cobrir também `warn/info/debug` |
| **E27** | **fechada**, com limite | [X] `materialize_state.py` reprova jornada, bug, `last_report` e evidência versionada inexistentes. Fora: `evidence/` (ignorado pelo git) e o SHA do relatório |
| Mutação | [X] | Cada mutação local foi revertida em seguida: sem `redactSecret` → 3/4 casos reprovam; chave em `llm_provider.notes` → a varredura do banco reprova; chave em `errorCode` → o painel reprova; escape por arquivo → o caso negativo reprova; sem a checagem de referências → 5 subcasos reprovam |
| `pnpm check` | [X] verde | 4183 testes passaram e 8 foram pulados (306 arquivos); `test:qa-skills` com 15 OK; `check:qa-tracker` com 96 cenários, todas as citações resolvidas |

Com isso, só P0-2 e P0-3 continuam impedindo a certificação; as duas
dependem do dono.
