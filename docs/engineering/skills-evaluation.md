# Avaliação do catálogo `pedronauck/skills`

Catálogo analisado em 23/08/2026, no commit
[`4f0146e`](https://github.com/pedronauck/skills/commit/4f0146e8f1c102337e8627658b223de34a00774c).
O repositório tinha 139 skills distribuídas entre `mine`, `curated`,
`community`, `marketing` e `deprecated`.

## Critérios

A seleção considera o que este projeto realmente usa: Next.js 16, TypeScript
apagável no Node 24, Drizzle/PostgreSQL, Playwright, documentação extensa,
worktrees, Compozy, três harnesses e gates próprios de segurança,
acessibilidade e arquitetura. Skill genérica que repete o `AGENTS.md` ou pode
contradizer as regras locais não entra só porque compartilha o stack.

## Selecionadas e instaladas

| Skill | Papel neste projeto | Integração local |
|---|---|---|
| `qa-report` | Mantém personas, jornadas, cenários, charters e bugs como documentos vivos. | Fonte de verdade em `docs/qa/`. |
| `qa-execution` | Percorre o produto pela interface pública e grava evidências e vereditos. | Usa o mesmo `docs/qa/` e o CLI local de navegador. |
| `agent-browser` | Fornece o driver real exigido por `qa-execution`. | `agent-browser@0.26.0` está fixado como dependência de desenvolvimento; `rtk pnpm qa:browser:install` instala o Chrome. A versão é a última anterior à exigência de pnpm 11, pois o projeto fixa pnpm 10.28. |
| `ship-pr` | Fecha o trabalho com impacto, descrição, commit e PR. | Regras locais têm precedência: worktree desde `dev`, `deep-review` antes da PR e base `dev`. |
| `drizzle-safe-migrations` | Ordena backfill e alteração de schema com revisão explícita. | Adaptada a pnpm, PostgreSQL/Supabase, `rtk pnpm db:generate` e à suspensão da promoção automática. A adaptação só ficou completa com [#199](https://github.com/andreustimm/master-jobs/issues/199): até ali o procedimento ainda trazia passos de SQLite/libSQL e `pragma`, que hoje aparecem só como histórico rotulado. |
| `a11y-testing` | Acrescenta o gate automatizado de WCAG ao browser E2E. | `@axe-core/playwright` roda dentro do runner isolado existente, sem criar outra infraestrutura. |
| `agent-output-audit` | Audita alegações e provas de tarefas implementadas por agente. | Invocada sob demanda; não substitui QA de jornada nem `deep-review`. |
| `deslop` | Remove ruído introduzido no diff por agentes antes da revisão. | Compara a branch de tarefa contra `dev`, sem tocar arquivos fora do escopo. |
| `documentation-writer` | Ajuda a separar tutorial, how-to, referência e explicação por Diátaxis. | A fronteira de ciclo de vida da ADR 0011 e o estilo local continuam soberanos. |

As oito skills disponíveis na branch principal, somadas à instalação histórica
de `agent-output-audit`, formam as nove skills desta PR. As atuais vieram dos caminhos
[`skills/mine`](https://github.com/pedronauck/skills/tree/main/skills/mine),
[`skills/curated`](https://github.com/pedronauck/skills/tree/main/skills/curated)
e [`skills/community`](https://github.com/pedronauck/skills/tree/main/skills/community).
`agent-output-audit` foi removida do catálogo em
[`36b43b4`](https://github.com/pedronauck/skills/commit/36b43b4d954720ca5d6104f8fb51924373a95a3f);
por isso esta instalação está congelada no pai
[`e0f1e47`](https://github.com/pedronauck/skills/commit/e0f1e4770de1e92eb46817e91afb2eee8ff29117),
o último commit que contém a skill completa.

## Onde entram no fluxo

1. Durante autoria, use `documentation-writer` quando o artefato exigir
   estrutura Diátaxis e `drizzle-safe-migrations` em qualquer mudança de schema.
2. Para mudança visível, `qa-report` planeja o tier e `qa-execution` percorre
   as jornadas com `agent-browser`; o E2E também executa axe.
3. Para implementação relevante por agente ou tarefa Compozy concluída,
   `agent-output-audit` verifica alegações contra arquivos, testes e CI.
4. Antes da entrega, `deslop` limpa somente o diff da tarefa, `deep-review`
   emite o veredito obrigatório e `ship-pr` cria a PR contra `dev`.

## Avaliadas e não instaladas

- `next-best-practices`, `react`, `tailwindcss`, `typescript-advanced`, `zod` e
  `vitest`: úteis em geral, mas o projeto já tem regras mais específicas e, no
  caso do Next.js, exige consultar a documentação da versão instalada.
- `drizzle-orm`: genérica demais diante das invariantes PostgreSQL/Supabase locais;
  `drizzle-safe-migrations` é a variante adequada.
- `obsidian-markdown`, `obsidian-cli` e `obsidian-bases`: o repositório vive num
  vault, mas a aplicação produz Markdown comum e não depende desses recursos.
- `find-rules`: redundante; `AGENTS.md` e
  [`docs/engineering/rules/`](rules/README.md) já são a fonte única das regras.
- skills de deploy/Kubernetes/Cloudflare: o deploy Vercel/Supabase está
  documentado, mas a promoção de produção ainda depende dos gates de migração.
- qualquer item em `skills/deprecated/`: excluído por definição.

Todas as instalações são canônicas em `.claude/skills/`. Codex e OpenCode leem
esse mesmo conteúdo pelos symlinks existentes; não há cópias por harness.

## Como as skills se ligam às regras

As 14 skills de `.claude/skills/` — as nove acima e as cinco do próprio projeto
(`application-kit`, `candidate-profile`, `deep-review`, `job-triage`,
`linkedin-positioning`) — ensinam procedimento; a política está em `AGENTS.md`
e em [`docs/engineering/rules/`](rules/README.md). Cada skill que toca uma regra
aponta para ela em vez de reescrevê-la, e nenhuma concede autorização que a
regra não dá. O alinhamento foi revisto em
[#201](https://github.com/andreustimm/master-jobs/issues/201):

- `ship-pr` e `deep-review`: só `SHIP` segue; `FIX_BEFORE_SHIP` remanescente é
  decisão humana escrita na PR, nunca exceção que a skill concede a si mesma
  (G54). Nota de release é o fragmento em `changelog.d/` (G58).
- `qa-report` e `qa-execution`: o validador do tracker confere esquema, não
  execução; `Pass` exige o observável (G56).
- `job-triage`, `/vagas` e `/aplicar`: o agente propõe; `track` registra o que
  o usuário decidiu, e nada envia candidatura (G02, G37).
- `/fonte-nova`: board vazio não prova handle errado (G70).
- `agent-browser` e `linkedin-positioning`: ferramenta disponível não autoriza
  agir no LinkedIn (G01).
- `candidate-profile`: pesos e lacunas são lidos do `profile.yaml`, não
  copiados.
