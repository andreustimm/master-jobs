# master-jobs — instruções para agentes (Codex / OpenCode / Claude)

Sistema de sourcing, scoring e gestão de candidaturas de **Andreus Timm**
(Senior AI Software Architect, 20+ anos, São Paulo/Brasil, remoto B2B,
**sem autorização de trabalho nos EUA**).

Objetivo: encontrar vagas que dão match com o perfil, ranqueá-las de forma
auditável e gerenciar o funil de candidaturas. Duas superfícies sobre as mesmas
APIs: CLI (`pnpm jho`) e dashboard Next.js — local em `127.0.0.1:3000` e
hospedado em `jobs.mastertimm.com.br` (Vercel + PostgreSQL/Supabase), sempre
com login. **O gargalo é a decisão, não a descoberta:** leia toda proposta de
funcionalidade contra isso ([vision.md](docs/product/vision.md)).

Este arquivo é a **entrada comum** e a única fonte autoral das instruções.
`CLAUDE.md` é um symlink para ele — **edite só aqui.** Ele traz as regras
críticas por escrito, o roteador e o fluxo curto. O detalhe de cada regra —
escopo, exceções, origem e prova — está em
[`docs/engineering/rules/`](docs/engineering/rules/README.md). Link não é
leitura automática: antes de alterar uma área, **abra a referência dela** no
roteador abaixo.

---

## Regras invioláveis

A numeração é estável: comentários de código e testes citam "regra N".
Entre colchetes, o ID do detalhe em `docs/engineering/rules/`.

1. **Nunca adquira dados do LinkedIn.** Nada lê `li_at`, dirige sessão
   autenticada, raspa HTML (mesmo deslogado) ou usa "LinkedIn MCP" não oficial
   — viola a §8.2 do User Agreement e arrisca a conta que é o principal ativo
   do usuário. Publicação só pela API oficial (`w_member_social`); comentários
   e conexões são **assistidos**. **Job alert por e-mail é permitido** (ADR
   0008). Leia [linkedin-policy.md](docs/linkedin-policy.md) antes de qualquer
   coisa de LinkedIn. [[G01](docs/engineering/rules/security.md#g01)]
2. **Ingestão nunca escreve em `application`.** Sync, import, captura e e-mail
   mexem em `job`; jamais em decisões do usuário. E-mail produz **sugestões**
   em `mail_suggestion`, que o usuário aceita ou descarta. É o único dado
   irrecuperável. [[G02](docs/engineering/rules/data-and-sourcing.md#g02)]
3. **Vaga que some é fechada (`closedAt`), nunca deletada.** O único descarte
   é a retenção administrativa, que protege toda vaga com candidatura mesmo sob
   concorrência. [[G03](docs/engineering/rules/data-and-sourcing.md#g03)]
4. **Variação real entra por porta; domínio é puro.** Fonte, fila, provedor de
   LLM, armazenamento: porta + adapter. Porta sem alternativa plausível é
   cerimônia. Lógica que decide fica sem banco, rede ou relógio; adapter busca,
   mapeia, devolve; injeção é composição de função, sem container.
   [[G04](docs/engineering/rules/architecture.md#g04), [G05](docs/engineering/rules/architecture.md#g05)]
5. **Só sintaxe TypeScript apagável.** Type stripping do Node 24: sem `enum`,
   parameter properties, `namespace` ou decorators (`erasableSyntaxOnly`).
   Imports relativos com extensão `.ts`. Sintoma:
   `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. [[G06](docs/engineering/rules/architecture.md#g06), [G07](docs/engineering/rules/architecture.md#g07)]
6. **Mexeu no scorer ou em `profile.yaml`? Bump `SCORER_VERSION`** (em
   `src/core/scoring/score.ts`; o valor mora só lá) e rode
   `pnpm jho jobs score --all`. `tests/scorer-version.test.ts` reprova saída
   nova com a versão antiga. [[G08](docs/engineering/rules/matching-and-evidence.md#g08)]
7. **Não invente evidência.** Texto que fala pela pessoa só cita `evidence:` do
   `profile.yaml`; `growth:` é lacuna assumida — sinalize, nunca maquie.
   [[G09](docs/engineering/rules/security.md#g09)]
8. **Dado faltante pontua neutro, nunca punitivo.** `freshness` sem data e
   `benefits` em texto curto valem 0,5 e nunca geram bloqueador.
   [[G10](docs/engineering/rules/matching-and-evidence.md#g10)]
9. **Texto de interface vem do dicionário** (`src/core/i18n/`), inclusive
   rótulo dentro de constante; procure a chave existente antes de criar. Rota
   nova entra nas listas de `tests/e2e/routes.mjs` no mesmo commit (ou em
   `UNMEASURED_PAGES`, com motivo — o `pnpm check` reprova a omissão); dado do usuário
   leva `data-user-content`; teste acha controle por `data-testid`.
   [[G29](docs/engineering/rules/frontend.md#g29)–[G31](docs/engineering/rules/frontend.md#g31)]
10. **Todo frontend segue o sistema de temas.** Componente lê só token
    semântico — nunca `#hex` nem paleta bruta (`--color-iris`; apelido de
    variável do tema, como `--color-brand`, é semântico); escala fechada de
    cor, tipo e espaço; nunca `max-w-xs`…`max-w-xl` (nem `w-`/`h-`/`min-w-`).
    Leia [DESIGN.md](DESIGN.md) antes. [[G32](docs/engineering/rules/frontend.md#g32)–[G34](docs/engineering/rules/frontend.md#g34)]
11. **Toda tela funciona no celular** — medido em 375px no E2E; viewport
    `device-width`, zoom livre. [[G35](docs/engineering/rules/frontend.md#g35)]
12. **Scripts locais fazem bind só em `127.0.0.1`** (`dev` e `start`, travado
    por teste). [[G36](docs/engineering/rules/security.md#g36)]
13. **Nada neste sistema envia uma candidatura.** `jho prep` monta o dossiê;
    quem envia é a pessoa. Não crie adapter de envio, nem "desabilitado"
    (ADR 0010). [[G37](docs/engineering/rules/security.md#g37)]
14. **Autenticação é exigida por omissão.** Nenhuma página nem API responde sem
    sessão, inclusive `/api/export`. `JHO_AUTH_MODE=open` só vale na máquina
    local; em deployment o código ignora o pedido. Primeiro acesso:
    `jho auth add-user <email> --role admin,candidate` e
    `jho auth set-password <email>`. [[G38](docs/engineering/rules/security.md#g38)]
15. **Autorização passa por `can()`, e o escopo vem da sessão.** Toda Server
    Action chama `guard(...)` antes de qualquer efeito; toda página chama
    `requirePage(...)`. Nenhuma action aceita `candidateId` da própria entrada. Entrada
    sem guarda só como exceção registrada, com o controle que a substitui; o
    inventário descobre entrada nova e reprova se ela não tiver política.
    [[G39](docs/engineering/rules/security.md#g39), [G40](docs/engineering/rules/security.md#g40)]
16. **Chave de API nunca vai para o banco** nem para log: guarda-se o nome da
    variável de ambiente. [[G41](docs/engineering/rules/security.md#g41)]
17. **`??` não protege contra string vazia.** Use `firstNonEmpty()`; entre
    apelidos de campo, decida pelo valor normalizado.
    [[G42](docs/engineering/rules/data-and-sourcing.md#g42), [G12](docs/engineering/rules/data-and-sourcing.md#g12)]
18. **Tarefa nasce em worktree a partir de `dev`, e a PR aponta para `dev`.**
    Nunca comite direto em `dev`, `staging` ou `main`; exceções são só as
    automações nomeadas e hotfix humano. [[G43](docs/engineering/rules/delivery.md#g43)]
19. **Antes de a PR ficar pronta, rode `deep-review` no nível do diff:** L0
    (só Markdown) dispensa; L1 é passada única; L2 (auth, `/p/`, schema,
    promoção/deploy, scorer, segredos) é completa. Só Critical/Major geram
    `FIX_BEFORE_SHIP`; Minor vira uma linha na PR. SHIP é o caminho normal;
    `FIX_BEFORE_SHIP` remanescente vai escrito na PR e só uma pessoa decide
    aceitá-lo — o agente não se concede a exceção.
    [[G53](docs/engineering/rules/delivery.md#g53), [G54](docs/engineering/rules/delivery.md#g54)]
20. **Mudança percebida por usuário atualiza e percorre o QA vivo**
    (`docs/qa/`); `Pass` só com observável que sobrevive a refresh e leitura
    independente. Markdown/metadados sem runtime validam só estrutura.
    [[G55](docs/engineering/rules/delivery.md#g55)–[G57](docs/engineering/rules/delivery.md#g57)]
21. **Commit releaseável carrega a nota em um fragmento de changelog:**
    `changelog.d/<slug-da-branch>.md`, com `## Técnico`, `## pt-BR` e `## en`.
    **Não edite** o `## [Unreleased]` dos três changelogs — a promoção junta os
    fragmentos (o hook `commit-msg` e o CI conferem).
    [[G58](docs/engineering/rules/delivery.md#g58)]
22. **Toda tag SemVer tem uma GitHub Release**, gerada do changelog técnico.
    [[G59](docs/engineering/rules/delivery.md#g59)]
23. **O changelog conta o que mudou; `docs/` conta como é agora.** Tarefa
    fechada atualiza `docs/`, ou a PR declara em uma linha por que nada mudou.
    [[G60](docs/engineering/rules/delivery.md#g60)]
24. **A issue e o GitHub Project 3 são a autoridade operacional da tarefa.**
    Toda demanda tem issue no Project antes de execução; estado, prioridade,
    assignee e dependências vêm do remoto (`rtk pnpm tasks show <issue>
    --json`). `.compozy/tasks/`, memória e backlog local nunca comandam estado.
    Integração em dev não é ativação do escritor remoto.
    [[R24](docs/engineering/rules/delivery.md#r24)]

**Outras invariantes que valem sem invocar skill** (detalhe no link):

- Política correta não basta: login e guarda de tela precisam funcionar para
  cada papel — cenário por papel no E2E. [[G16](docs/engineering/rules/security.md#g16)]
- Admin não lê dado privado: assume a identidade, fica registrado, e a sessão
  emprestada perde toda ação de administração. Ninguém além do candidato cria
  vínculo com recrutador; conta nova nunca aponta para candidato existente.
  [[G24](docs/engineering/rules/security.md#g24), [G25](docs/engineering/rules/security.md#g25)]
- Recuperar senha não revela quem está cadastrado; token de uso único, uma hora,
  queimado antes de gravar; trocar a senha derruba todas as sessões; em
  deployment o link nunca vai para o log. Hash de senha corrompido **nega**.
  [[G17](docs/engineering/rules/security.md#g17)–[G19](docs/engineering/rules/security.md#g19)]
- `/p/[slug]` é a única rota de conteúdo sem sessão e mostra só a lista de
  permissão: nunca e-mail, telefone, funil, candidaturas nem piso salarial.
  Não público responde **404**. Texto do CV exige segundo consentimento e
  continua filtrado. [[G21](docs/engineering/rules/security.md#g21)–[G23](docs/engineering/rules/security.md#g23)]
- O service worker não guarda nada autenticado: só `static-` e `shell-`; nunca
  `/login`, páginas, API nem `/p/`. [[G14](docs/engineering/rules/security.md#g14)]
- Só 404 e 410 fecham vaga; 401/403/429, 5xx e rede não decidem nada.
  [[G26](docs/engineering/rules/data-and-sourcing.md#g26)]
- FK declara `ON DELETE` escrito no schema e igual no DDL.
  [[G20](docs/engineering/rules/data-and-sourcing.md#g20)]
- Guarda de configuração recusa quem pede **menos** (lista de permissão), e
  variável Sensitive se testa com a forma que o provedor cadastra — nunca se
  extrai. [[G27](docs/engineering/rules/data-and-sourcing.md#g27), [G28](docs/engineering/rules/data-and-sourcing.md#g28)]
- Limite sob concorrência reserva o slot **antes** do `await`.
  [[G13](docs/engineering/rules/data-and-sourcing.md#g13)]
- O score é rubrica ponderada determinística, sem embedding nem LLM:
  "W2 on-site em Austin" é eliminatório, e similaridade não vê isso.
  [[G11](docs/engineering/rules/matching-and-evidence.md#g11)]
- Token de preenchimento (`--accent-2`, `--warn`) não serve como cor de texto
  (4.5:1); sintaxe do editor usa `--cm-*`. [[G32](docs/engineering/rules/frontend.md#g32)]
- Produção não sai sem gente: a PR `staging → main` nunca é mesclada por robô
  ou agente. [[G46](docs/engineering/rules/delivery.md#g46)]

---

## Roteador: o que ler antes de mexer

| Antes de alterar… | Leia |
|---|---|
| autenticação, sessão, papéis, perfil público, cache, segredos, rede, LinkedIn, dossiê | [rules/security.md](docs/engineering/rules/security.md), [security.md](docs/security.md) |
| estrutura de `src/`, contexto novo, porta, fila, runtime | [rules/architecture.md](docs/engineering/rules/architecture.md), [architecture.md](docs/architecture.md), [MIGRATION.md](MIGRATION.md), [ADR 0009](docs/adr/0009-fila-de-raspagem.md) |
| schema, FK, migration, ingestão, fonte, cota, retenção, e-mail | [rules/data-and-sourcing.md](docs/engineering/rules/data-and-sourcing.md), [data-model.md](docs/data-model.md), [sources.md](docs/sources.md), [email-ingestion.md](docs/email-ingestion.md), [sources-autenticadas.md](docs/sources-autenticadas.md) |
| scorer, `profile.yaml`, peso, componente | [rules/matching-and-evidence.md](docs/engineering/rules/matching-and-evidence.md), [scoring.md](docs/scoring.md) |
| tela, componente, texto de UI, tema | [rules/frontend.md](docs/engineering/rules/frontend.md), [DESIGN.md](DESIGN.md) |
| prompt de LLM | [docs/prompts/system/](docs/prompts/system/README.md) |
| envio de candidatura (mesmo que só "estudar") | [ADR 0010](docs/adr/0010-submissao-autonoma.md) |
| funcionalidade nova | [vision.md](docs/product/vision.md), [personas.md](docs/product/personas.md) |
| branch, PR, release, QA, docs, skills | [rules/delivery.md](docs/engineering/rules/delivery.md), [workflow.md](docs/engineering/workflow.md) |
| produção, variáveis, ambientes | [deploy.md](docs/engineering/deploy.md), [operations.md](docs/operations.md) |

Comandos: [docs/cli.md](docs/cli.md) (há uma referência rápida no topo).
Índice geral: [docs/README.md](docs/README.md). O que ainda não existe:
[roadmap.md](docs/roadmap.md) — **não descreva como pronto o que não está.**

---

## Começar ou retomar

1. Leia a issue remota e verifique a posse da execução (regra 24). O tamanho
   que ela declara decide a especificação: S (objetivo + aceite), M (techspec
   curta + `_tests.md`), L (PRD + techspec + `_tests.md`).
   [[R24](docs/engineering/rules/delivery.md#r24-tamanho)]
2. `rtk git status --short --branch` e `rtk pnpm worktrees`. Preserve WIP
   (patch **e** não rastreados) antes de reconciliar a raiz; HEAD já presente em
   `dev` não prova que uma worktree com WIP pode ser removida.
3. Trabalho novo: worktree `<tipo>/<slug>` a partir de `origin/dev`.

Roteiro completo, com os comandos de claim e retomada:
[workflow.md](docs/engineering/workflow.md).

## Fluxo curto

```
worktree/tarefa → validação local enxuta → PR draft (CI em paralelo) → QA de jornada aplicável → docs/ + changelogs → deslop → um revisor no nível do diff (L0/L1/L2) → ship-pr (PR pronta) → dev → (automático) → staging → PR humana → main → tag + volta para dev
```

- Gate local: `rtk pnpm typecheck` + testes relacionados ao diff
  (`vitest related`), E2E afetado quando toca navegador; a suíte completa é do
  CI (`qualidade`). PR draft logo após o primeiro verde; pronta após SHIP.
  Teto por gate (check 10 min, E2E 8, L1 10, L2 30): estourou, registre e siga.
  PR só de Markdown valida estrutura, links e scripts afetados.
  [[G57](docs/engineering/rules/delivery.md#g57)]
- PR para `dev` com responsável atribuído (`andreustimm`), descrição com docs,
  QA, plano de teste real e veredito do `deep-review`. Pelo menos um commit leva
  `Closes #N` (ou `Refs #N`) na **mensagem**: é ela que fecha a issue quando o
  commit chega a `main`. [[G47](docs/engineering/rules/delivery.md#g47), [R24](docs/engineering/rules/delivery.md#r24-closes)]
- Branch mesclada é removida, local e remota; `dev`, `staging` e `main` nunca.
  [[G48](docs/engineering/rules/delivery.md#g48)–[G50](docs/engineering/rules/delivery.md#g50)]
- Migração aditiva promove e se aplica sozinha no push para `main`; a não
  aditiva (detector em `src/core/db/migration-review.ts`) suspende a promoção
  e a migração automáticas até revisão humana.
  [[G51](docs/engineering/rules/delivery.md#g51)]

## Precedência e conflito

As regras desta entrada e de `docs/engineering/rules/` prevalecem sobre
exemplos genéricos de skills — em especial RTK, base `dev`, worktree
obrigatória, PostgreSQL/Supabase e os gates deste repositório. Encontrou uma
fonte dizendo o oposto? **Não enfraqueça a proteção para seguir o exemplo mais
fraco**: registre a discrepância com evidência e corrija a fonte responsável.
Mudar uma regra é mudar a entrada e o arquivo de domínio no mesmo commit.

## Skills e harnesses

Skill de projeto vive **uma vez** em `.claude/skills/<nome>/`; `.agents/skills`,
`.codex/skills`, `.opencode/skills` e `.opencode/commands` são symlinks para os
equivalentes em `.claude/`. Nunca copie uma skill por harness. Skill
ensina procedimento; não define política nem concede autorização. O agente
invoca `deep-review`, `qa-report`, `qa-execution`, `agent-output-audit` e
`ship-pr` por conta própria; publicar na PR exige `--publish` ou autorização
explícita. [[G61](docs/engineering/rules/delivery.md#g61)–[G62](docs/engineering/rules/delivery.md#g62)]

Agentes (`.claude/agents/`) e permissões (`.claude/settings.json`) são a fonte
dos três harnesses: os espelhos do Codex (`.codex/agents/`, `.codex/hooks.json`)
e do OpenCode (`.opencode/agents/`, `opencode.json`) são **gerados** por
`pnpm harness:sync` e conferidos por `pnpm check:harness` — nunca edite o
espelho. Agentes de papel: `task-analyst`, `executor`, `fixer`, `reviewer`,
`judge`. [[G85](docs/engineering/rules/delivery.md#g85)]

Conforme `~/.claude/RTK.md`: no Codex e no OpenCode todo comando de shell vai
prefixado com `rtk`. No Claude Code o hook global reescreve e não duplica o
prefixo. [[G63](docs/engineering/rules/delivery.md#g63)]

O bloco abaixo é gerado pelo `next dev`; não o edite nem o mova.
[[G64](docs/engineering/rules/delivery.md#g64)]


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
