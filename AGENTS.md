# master-jobs — instruções para agentes

Sistema de sourcing, scoring e gestão de candidaturas de Andreus Timm (Senior
AI Software Architect, São Paulo, remoto B2B, sem autorização de trabalho nos
EUA — por isso W2 ou on-site nos EUA é eliminatório). CLI (`pnpm jho`) e
dashboard Next.js sobre as mesmas APIs, local em `127.0.0.1:3000` e hospedado
em `jobs.mastertimm.com.br` (Vercel + Supabase), com login por omissão. O
gargalo do produto é a decisão, não a descoberta: avalie toda funcionalidade
contra isso ([vision.md](docs/product/vision.md)).

Esta é a entrada comum de qualquer agente (Claude Code a lê pelo symlink
`CLAUDE.md`); edite só este arquivo. Aqui fica o que vale sempre. Escopo,
exceções e prova de cada regra estão em
[docs/engineering/rules/](docs/engineering/rules/README.md): abra o arquivo da
área, listado em "Antes de mexer", quando a tarefa a tocar.

## Como trabalhar

- Leve a tarefa até a entrega exigida na issue; decisões rotineiras são suas.
  Pergunte ao dono só antes de ação irreversível fora do fluxo (force-push,
  `reset --hard`, apagar branch permanente ou dado), escrita no banco de
  produção, afrouxar uma regra ou aceitar `FIX_BEFORE_SHIP` remanescente.
- Entregue o pedido, no escopo pedido; melhoria fora dele vira uma frase na PR
  ou uma issue.
- Relate só o que um comando desta sessão mostrou; o resto é "não verificado".
- Escreva issue, PR, commit e docs em português do Brasil, com acentuação.
- Estado, contagens e versões ficam fora daqui (`jho stats`, `package.json`,
  [deploy.md](docs/engineering/deploy.md)); o que não existe está em
  [roadmap.md](docs/roadmap.md) e não se descreve como pronto.
  [[G83](docs/engineering/rules/delivery.md#g83)]

## Regras invioláveis

A numeração é estável: código e testes citam "regra N".

1. **Não adquira dados do LinkedIn:** nada de `li_at`, sessão autenticada, HTML
   raspado (mesmo deslogado) ou "LinkedIn MCP" não oficial — viola a §8.2 do
   User Agreement e arrisca a conta do dono. Permitidos: job alert por e-mail
   (ADR 0008), API oficial (`w_member_social`), comentário e conexão
   assistidos. Leia [linkedin-policy.md](docs/linkedin-policy.md) antes.
   [[G01](docs/engineering/rules/security.md#g01)]
2. **Ingestão escreve só em `job`, nunca em `application`.** Sync, import,
   captura e e-mail geram no máximo sugestões (`mail_suggestion`) que a pessoa
   aceita: a decisão dela é o único dado irrecuperável.
   [[G02](docs/engineering/rules/data-and-sourcing.md#g02)]
3. **Vaga que some é fechada (`closedAt`), não deletada**; o único descarte é a
   retenção administrativa, que preserva vaga com candidatura.
   [[G03](docs/engineering/rules/data-and-sourcing.md#g03)]
4. **Variação real entra por porta; domínio é puro.** Fonte, fila, LLM e
   armazenamento: porta + adapter; porta sem alternativa plausível é cerimônia.
   Lógica que decide fica sem banco, rede ou relógio; adapter busca, mapeia e
   devolve; injeção por composição de função.
   [[G04](docs/engineering/rules/architecture.md#g04), [G05](docs/engineering/rules/architecture.md#g05)]
5. **Só TypeScript apagável** (type stripping do Node 24): sem `enum`,
   parameter properties, `namespace` ou decorators; imports relativos com
   `.ts`. [[G06](docs/engineering/rules/architecture.md#g06), [G07](docs/engineering/rules/architecture.md#g07)]
6. **Mudou o scorer ou `profile.yaml`: aumente `SCORER_VERSION`** (em
   `src/core/scoring/score.ts`) e rode `pnpm jho jobs score --all`.
   [[G08](docs/engineering/rules/matching-and-evidence.md#g08)]
7. **Não invente evidência:** texto que fala pela pessoa cita só `evidence:` do
   `profile.yaml`; `growth:` aparece como lacuna.
   [[G09](docs/engineering/rules/security.md#g09)]
8. **Dado faltante pontua neutro:** `freshness` sem data e `benefits` curto
   valem 0,5 e não geram bloqueador — punir ausência rebaixa a fonte, não a
   vaga. [[G10](docs/engineering/rules/matching-and-evidence.md#g10)]
9. **Texto de UI vem do dicionário** (`src/core/i18n/`), inclusive rótulo em
   constante; procure a chave antes de criar. Rota nova entra em
   `tests/e2e/routes.mjs` (ou `UNMEASURED_PAGES`, com motivo) no mesmo commit;
   dado do usuário leva `data-user-content`; teste acha controle por
   `data-testid`. [[G29](docs/engineering/rules/frontend.md#g29)–[G31](docs/engineering/rules/frontend.md#g31)]
10. **Componente lê só token semântico do tema** e a escala fechada — sem
    `#hex`, paleta bruta (`--color-iris`) nem `max-w-xs`…`max-w-xl` (ou `w-`,
    `h-`, `min-w-`), que no Tailwind v4 viram espaçamento. Leia
    [DESIGN.md](DESIGN.md). [[G32](docs/engineering/rules/frontend.md#g32)–[G34](docs/engineering/rules/frontend.md#g34)]
11. **Toda tela funciona em 375px** (E2E); viewport `device-width`, zoom livre.
    [[G35](docs/engineering/rules/frontend.md#g35)]
12. **`dev` e `start` fazem bind só em `127.0.0.1`.**
    [[G36](docs/engineering/rules/security.md#g36)]
13. **Nada envia candidatura**, nem adapter "desabilitado": `jho prep` monta o
    dossiê e a pessoa envia (ADR 0010). [[G37](docs/engineering/rules/security.md#g37)]
14. **Autenticação por omissão:** nenhuma página nem API (inclusive
    `/api/export`) responde sem sessão; `JHO_AUTH_MODE=open` só vale local.
    Primeiro acesso: `jho auth add-user <email> --role admin,candidate` e
    `jho auth set-password <email>`. [[G38](docs/engineering/rules/security.md#g38)]
15. **Autorização por `can()`, escopo da sessão:** Server Action chama
    `guard(...)` antes de qualquer efeito, página chama `requirePage(...)`, e
    nenhuma action aceita `candidateId` da entrada. Entrada sem guarda só como
    exceção registrada no inventário.
    [[G39](docs/engineering/rules/security.md#g39), [G40](docs/engineering/rules/security.md#g40)]
16. **Chave de API não vai para banco nem log:** grave o nome da variável.
    [[G41](docs/engineering/rules/security.md#g41)]
17. **`??` não protege contra `""`:** use `firstNonEmpty()`; entre apelidos de
    campo, decida pelo valor normalizado.
    [[G42](docs/engineering/rules/data-and-sourcing.md#g42), [G12](docs/engineering/rules/data-and-sourcing.md#g12)]
18. **Trabalho nasce em worktree `<tipo>/<slug>` de `origin/dev`; a PR aponta
    para `dev`.** Commit direto em `dev`, `staging` ou `main` só nas automações
    nomeadas e no hotfix decidido pelo dono.
    [[G43](docs/engineering/rules/delivery.md#g43), [G49](docs/engineering/rules/delivery.md#g49)]
19. **Antes de a PR ficar pronta, um revisor no nível do diff:** L0 (só
    Markdown) dispensa `deep-review`; L1 é passada única; L2 (auth, `/p/`,
    schema, promoção/deploy, scorer, segredos) é completa. Só Critical/Major
    geram `FIX_BEFORE_SHIP`, e o remanescente só uma pessoa aceita.
    [[G53](docs/engineering/rules/delivery.md#g53), [G54](docs/engineering/rules/delivery.md#g54)]
20. **Mudança visível atualiza e percorre o QA vivo** (`docs/qa/`); `Pass`
    exige observável que sobrevive a refresh e leitura independente.
    [[G55](docs/engineering/rules/delivery.md#g55)–[G57](docs/engineering/rules/delivery.md#g57)]
21. **Nota releaseável vai em `changelog.d/<slug-da-branch>.md`** (`## Técnico`,
    `## pt-BR`, `## en`); o `## [Unreleased]` dos changelogs fica intocado,
    porque a promoção junta os fragmentos.
    [[G58](docs/engineering/rules/delivery.md#g58)]
22. **Toda tag SemVer tem GitHub Release**, gerada do changelog técnico.
    [[G59](docs/engineering/rules/delivery.md#g59)]
23. **Changelog conta o que mudou; `docs/`, como é agora:** tarefa fechada
    atualiza `docs/` ou a PR diz em uma linha por que não.
    [[G60](docs/engineering/rules/delivery.md#g60)]
24. **A issue e o GitHub Project 3 mandam no estado da tarefa.** Todo trabalho
    que vira commit tem issue no Project (pergunta, análise e revisão sem
    commit não exigem); antes de começar ou retomar, leia
    `pnpm tasks show <issue> --json` e confira a posse da execução.
    `.compozy/tasks/` e memória dão contexto, não estado.
    [[R24](docs/engineering/rules/delivery.md#r24)]

## Antes de mexer

Abra o arquivo de regras da área antes de alterá-la. As invariantes citadas
valem mesmo sem abri-lo; o ID leva ao detalhe.

- **Segurança** (`src/contexts/auth/`, `app/p/`, `app/login/`, service worker,
  segredos, rede, dossiê): [rules/security.md](docs/engineering/rules/security.md).
  Cada papel entra e usa suas telas — cenário por papel no E2E (G16). Admin
  assume identidade registrada e perde ação de administração; só o candidato
  cria vínculo com recrutador, e conta nova não aponta para candidato
  existente (G24, G25). Recuperar senha não revela cadastro; token único de uma
  hora, queimado antes de gravar; trocar senha derruba as sessões; em
  deployment o link não vai para o log; hash corrompido nega (G17–G19).
  `/p/[slug]` mostra só a lista de permissão, nunca contato, funil nem piso
  salarial; o CV exige segundo consentimento; não público responde 404
  (G21–G23). O service worker guarda só `static-` e `shell-` (G14).
- **Dados e fontes** (`src/core/db/`, `drizzle/`, `src/core/ingest/`,
  `src/core/sources/`, `src/core/mail/`):
  [rules/data-and-sourcing.md](docs/engineering/rules/data-and-sourcing.md);
  e-mail em [email-ingestion.md](docs/email-ingestion.md), plataforma logada
  em [sources-autenticadas.md](docs/sources-autenticadas.md). Só 404 e 410 fecham vaga (G26). Toda FK declara `ON DELETE` no schema e no
  DDL (G20). Guarda de configuração recusa quem pede menos, por lista de
  permissão (G27, G28). Limite sob concorrência reserva o slot antes do
  `await` (G13).
- **Arquitetura** (estrutura de `src/`, contexto, porta, fila):
  [rules/architecture.md](docs/engineering/rules/architecture.md),
  [MIGRATION.md](MIGRATION.md), fila em [ADR 0009](docs/adr/0009-fila-de-raspagem.md).
- **Score** (`src/core/scoring/`, `profile.yaml`):
  [rules/matching-and-evidence.md](docs/engineering/rules/matching-and-evidence.md).
  É rubrica ponderada determinística, sem embedding nem LLM: similaridade não
  vê que "W2 on-site em Austin" é eliminatório (G11).
- **Interface** (`app/`, `components/`, tema):
  [rules/frontend.md](docs/engineering/rules/frontend.md). Token de
  preenchimento (`--accent-2`, `--warn`) não é cor de texto; a sintaxe do
  editor usa `--cm-*` (G32).
- **Entrega** (branch, PR, release, QA, docs, skills):
  [rules/delivery.md](docs/engineering/rules/delivery.md),
  [workflow.md](docs/engineering/workflow.md). **Produção e ambientes:**
  [deploy.md](docs/engineering/deploy.md).
- **Delegar a outro agente, modelo, effort, modo de assinatura:**
  [rules/orchestration.md](docs/engineering/rules/orchestration.md),
  [`config/model-routing.json`](config/model-routing.json).
- **Prompt de LLM:** [docs/prompts/system/](docs/prompts/system/README.md).
  **Envio de candidatura**, mesmo para estudar:
  [ADR 0010](docs/adr/0010-submissao-autonoma.md). **Funcionalidade nova:**
  [personas.md](docs/product/personas.md).

Comandos: [docs/cli.md](docs/cli.md). Índice: [docs/README.md](docs/README.md).

## Fluxo de entrega

1. Leia a issue (regra 24); o tamanho decide a especificação: S (objetivo +
   aceite), M (techspec + `_tests.md`), L (PRD + techspec + `_tests.md`).
   [[R24](docs/engineering/rules/delivery.md#r24-tamanho)] Confira
   `git status` e `pnpm worktrees`; preserve WIP antes de reconciliar a raiz.
   [[G44](docs/engineering/rules/delivery.md#g44)]
2. Valide local e enxuto: `pnpm typecheck` + `vitest related` do diff, E2E
   afetado se toca navegador; a suíte completa é do CI. Só Markdown:
   `pnpm check:instructions`, `check:release-ready`, `check:qa-tracker`. Gate
   estourou o teto (check 10 min, E2E 8, L1 10, L2 30): registre e siga.
   [[G57](docs/engineering/rules/delivery.md#g57)]
3. Abra PR draft para `dev` logo no primeiro verde, com assignee
   `andreustimm`. Um commit leva `Closes #N` (ou `Refs #N`) na mensagem, que é
   o que fecha a issue quando chega a `main`.
   [[G47](docs/engineering/rules/delivery.md#g47), [R24](docs/engineering/rules/delivery.md#r24-closes)]
4. QA de jornada se visível, `docs/` e fragmento, `deslop`, e um revisor
   (regra 19): `agent-output-audit` só em trabalho delegado, nunca somado à
   `deep-review`. [[G84](docs/engineering/rules/delivery.md#g84)]
5. PR pronta após SHIP (ou validadores, em L0). Mesclada, a branch sai local e
   remota. [[G50](docs/engineering/rules/delivery.md#g50)]

## Produção

`dev → staging` é automático a cada CI de push verde em `dev`, por
fast-forward do SHA validado. A PR `staging → main` é aberta pelo robô e, por
delegação do dono (23/09/2026),
mesclada pelo agente com `gh pr merge <n> --merge --admin` quando `qualidade`
e `schema-e-migracao` estão verdes, nenhuma migração não aditiva espera
revisão e, se a leva tem mudança visível ao usuário, o QA de jornada full
passou (sem mudança visível, basta a fumaça pós-deploy); fora disso, o agente
relata e não mescla. Hotfix é decisão do dono. Migração não aditiva para a promoção
até revisão humana; o retorno `main → dev` é automático.
[[G46](docs/engineering/rules/delivery.md#g46), [G51](docs/engineering/rules/delivery.md#g51), [G56](docs/engineering/rules/delivery.md#g56)]

## Precedência

Estas regras prevalecem sobre exemplos genéricos de skills. Achou fonte
dizendo o oposto: siga a mais protetora, registre a discrepância e corrija a
fonte. Mudar uma regra é mudar a entrada e o arquivo de domínio no mesmo
commit. [[G62](docs/engineering/rules/delivery.md#g62)]

## Harnesses

- Skills vivem uma vez em `.claude/skills/`; os outros harnesses as leem por
  symlink. Skill ensina procedimento, não concede autorização; publicar na PR
  exige `--publish` ou pedido explícito.
  [[G61](docs/engineering/rules/delivery.md#g61)]
- Agentes (`.claude/agents/`) e permissões (`.claude/settings.json`) são a
  fonte; os espelhos de Codex e OpenCode saem de `pnpm harness:sync` e são
  conferidos por `pnpm check:harness`. Papéis: `task-analyst`, `executor`,
  `fixer`, `reviewer`, `judge`. [[G85](docs/engineering/rules/delivery.md#g85)]
- Ao delegar, passe o modelo de `pnpm route <papel> <complexidade> --session
  <harness>` (política em `config/model-routing.json`; modo `claude_only`,
  `codex_only` ou `multi_provider`; política inválida ou modo desconhecido
  falham fechado). O juiz nunca é o modelo que escreveu o delta
  (`pnpm route judge <complexidade> --author <modelo>`), e o agente não
  rebaixa por conta própria o modelo do turno principal.
  [[G86](docs/engineering/rules/orchestration.md#g86), [G87](docs/engineering/rules/orchestration.md#g87)]
- Com `rtk` instalado, Codex e OpenCode prefixam cada comando com `rtk` (no
  Claude Code, um hook reescreve); sem ele, rode o comando puro. Um comando por
  chamada de shell, sem `&&`, `|` ou `;`: a lista de permissão do Claude Code
  casa pelo prefixo, e composto cai em aprovação manual.
  [[G63](docs/engineering/rules/delivery.md#g63)]
- O bloco abaixo é gerado pelo `next dev`; não o edite nem o mova.
  [[G64](docs/engineering/rules/delivery.md#g64)]


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
