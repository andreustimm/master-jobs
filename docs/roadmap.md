# Roadmap

## Por que isto existe

Este arquivo separa **o que já roda** de **o que ainda é intenção**. O
`master-jobs` tem muito scaffolding no repositório — `next.config.ts`
configurado, tabelas `post`/`engagement`/`target_account`/`positioning_task` já
criadas na migration, variáveis de LinkedIn e `CRON_SECRET` no `.env.example` —
e nada disso significa que a funcionalidade existe. Um agente (ou você, em três
meses) que confunda scaffolding com feature vai reportar como pronto algo que
nunca foi escrito.

> **Invariante:** Não descreva como pronto o que ainda não está. A regra vale
> para commits, para o `CLAUDE.md`/`AGENTS.md` e para este arquivo. Se um item
> da Fase 2 ou 3 for implementado, mova-o para a Fase 1 **no mesmo commit**.

Legenda usada nas tabelas abaixo:

| Marca | Significado |
|---|---|
| ✅ | Existe no código, foi executado de verdade |
| 🟡 | Scaffolding presente (config, schema, env, skill), sem código que use |
| ⬜ | Não existe nada |

---

## Fase 1 — Pronto (roda localmente, hoje)

Tudo nesta seção foi verificado contra `src/` e contra o banco em
`data/jobs.db`.

| Capacidade | Estado | Onde vive |
|---|---|---|
| CLI Commander completa (`jho`) | ✅ | `src/cli.ts` |
| 10 adapters registrados / 12 fontes configuradas | ✅ | `src/core/sources/registry.ts`, `config/sources.yaml` |
| Ingestão idempotente com `fingerprint` + `contentHash` | ✅ | `src/core/ingest/normalize.ts`, `src/core/ingest/run.ts` |
| Scoring determinístico versionado | ✅ | `src/core/scoring/score.ts` (`SCORER_VERSION = "1.0.0"`) |
| Persistência do score com upsert | ✅ | `src/core/scoring/apply.ts` |
| Funil de candidaturas com histórico append-only | ✅ | `application` + `application_event`, `setApplicationStatus()` |
| Export markdown para o vault Obsidian | ✅ | `src/core/report/markdown.ts` |
| Perfil validado por Zod v4 | ✅ | `profile/profile.yaml`, `src/core/profile/schema.ts` |
| Seed idempotente do banco | ✅ | `package.json` → `db:seed`; `src/cli.ts` → `db.command("seed")` |
| Migrations Drizzle (11 tabelas, 1 migration) | ✅ | `drizzle/0000_remarkable_solo.sql` |
| Skills de agente (triage, kit, perfil, posicionamento) | ✅ | `.claude/skills/*/SKILL.md` |
| Suíte Vitest do scorer e do normalizador (14 `describe`, 31 `it()`) | ✅ | `tests/scoring.test.ts`, `tests/normalize.test.ts` |
| ADRs das decisões estruturais (6) | ✅ | `docs/adr/` |

### O sync real que já aconteceu

Um sync completo já rodou contra as 12 fontes públicas e o banco acumula
**5.021 vagas**. Estado atual do `data/jobs.db` (72 MB, gitignored):

| Métrica | Valor |
|---|---|
| Linhas em `job` | 5021 (4997 abertas, 24 com `closed_at`) |
| Linhas em `job_score` | 5021 |
| Linhas em `source` | 12 (todas `ok`) |
| Vagas com `fit >= 45` (default do `jobs list`) | 346 abertas |
| Vagas com `fit >= 60` | 15 |
| Maior fit observado | 74.2 (cluster `ai_lead`) |

Distribuição por cluster: `other` 2491, `ai_lead` 1114, `eng_lead` 1032,
`architect` 236, `staff` 143, `senior_ic` 5. Hoje `job` e `job_score` estão
alinhados em 5021 linhas, mas essa igualdade não é garantida: rodar
`jobs sync --no-score` deixa as vagas novas sem score até o próximo
`pnpm jho jobs score` (sem `--all`), que seleciona exatamente as pendentes.

O ciclo que funciona hoje, ponta a ponta:

```bash
pnpm jho db migrate
pnpm jho jobs sync                  # 12 fontes, concurrency 4, score automático
pnpm jho jobs list --min-fit 60
pnpm jho jobs show <id>             # breakdown auditável do score
pnpm jho track <id> shortlisted -n "motivo"
pnpm jho pipeline
pnpm jho report                     # markdown no vault Obsidian
```

### Dívidas conhecidas da Fase 1

São pequenas e devem ser pagas antes de começar a Fase 2 — nenhuma delas exige
arquitetura nova.

| Dívida | Evidência | Primeiro passo |
|---|---|---|
| Cobertura de ingestão e adapters | ✅ | Fixtures de adapters e do pipeline em `tests/adapters.test.ts` e `tests/cov-ingest-run.test.ts`, incluindo idempotência e falhas de fonte |
| `smartrecruiters` e `recruitee` têm adapter mas nenhuma entrada em `config/sources.yaml` | `registry.ts` registra os dois | Validar um handle real com `pnpm jho sources probe` antes de adicionar |

> **Invariante:** Mexeu em `profile.yaml` ou no scorer? Bump `SCORER_VERSION` em
> `src/core/scoring/score.ts` e rode `pnpm jho jobs score --all`. Sem o bump,
> `scoreAll()` sem `--all` só reprocessa jobs sem score ou com
> `scorer_version <> SCORER_VERSION`, e os scores velhos ficam misturados com os
> novos sem ninguém perceber.

---

## Fase 2 — Automação e interface

Os itens 1 e 2 já sustentam o uso diário; 3 e 4 continuam como melhorias da
qualidade da decisão; 5 e 6 são o lado de posicionamento.

### 2.1 Dashboard Next.js 16

**Estado: ✅ entregue.** O dashboard Next.js tem board, detalhe da vaga,
funil, referrals, comparação, área do candidato, administração e perfil
público em `app/`. As páginas são Server Components por omissão e reutilizam
as APIs dos contextos proprietários; autenticação e autorização são exigidas
por padrão.

> **Invariante:** A UI nunca escreve SQL próprio. Toda leitura compartilhada
> entra em `src/core/db/repo.ts` — é essa a razão de o arquivo existir
> ("queries compartilhadas entre CLI e futura UI"). Duplicar o `LEFT JOIN` de
> `listBoard()` dentro de um componente cria dois rankings que divergem em
> silêncio.

### 2.2 Sync agendado

**Estado: ⏸️ entregue, temporariamente pausado.** `.github/workflows/varredura.yml`
foi configurado para executar diariamente em produção e também aceitar
`workflow_dispatch`. A rodada sincroniza fontes,
captura descrições, reconfere vagas, drena a fila de repontuação por candidato,
pontua vagas novas para todos os candidatos elegíveis e termina conferindo a
saúde das fontes. Desde 03/09/2026, workflow e cron da Vercel estão desligados
pelo [incidente de cota do Turso](operations/turso-quota-incident-2026-09-03.md);
a reativação depende dos gates registrados ali.

> **Invariante:** Uma fonte que falha é registrada e pulada; nunca aborta a run
> (`src/core/ingest/run.ts`, item 2). Um agendador que trate exit code != 0 como
> "sync falhou" está lendo o sinal errado — o estado por fonte está em
> `source.last_status` / `source.last_error`.

### 2.3 Re-ranking por LLM apenas do topo

**Estado: ⬜.** Isto já está previsto no cabeçalho de
`src/core/scoring/score.ts`: *"An LLM pass is worth adding later, but only on the
top slice this scorer already surfaced."* O determinístico é o filtro barato
sobre as 5.021 linhas de `job`; o LLM é o desempate caro sobre dezenas. Com os números de
hoje o slice é minúsculo: 346 vagas acima de 45 de fit, 17 acima de 60.

**Primeiro passo concreto:** um subcomando `jho jobs rerank --min-fit 60 --limit 25`
que lê pelo `listBoard()`, manda ao modelo o `title`, o `descriptionText`
truncado e — importante — os `reasons` e `blockers` que o scorer já produziu,
para o modelo criticar o ranking em vez de recomeçar do zero. A saída vai para
uma tabela **nova** (ex.: `job_llm_review`), com uma migration própria.

> **Invariante:** Nenhuma saída de LLM escreve em `job_score`. Essa tabela é
> derivada, determinística e reproduzível — é o que sustenta o contrato de
> `SCORER_VERSION` e o "safe to wipe and recompute" do schema. Misturar
> julgamento de modelo ali destrói a auditabilidade que o `jobs show` entrega.

### 2.4 Geração de CV e cover letter por cluster

**Estado: 🟡 scaffolding.** `profile/profile.yaml` já declara `cv.base` e
`cv.variants` (`architect`, `staff`, `ai`, `lead`, `senior`), e cada cluster em
`targets.clusters` aponta seu `cv_variant`. A tabela `application` tem as colunas
`cv_variant` e `cover_letter_path`. A skill
`.claude/skills/application-kit/SKILL.md` já descreve o processo. O que **não**
existe: os arquivos em `profile/variants/` (o diretório `profile/` contém apenas
`profile.yaml`) e qualquer código que gere ou grave documentos.

**Primeiro passo concreto:** escrever à mão `profile/variants/architect.md` —
só o cluster de maior peso (`weight: 1.0`) e maior valor. Depois um
`jho apply kit <id>` que resolve o `cv_variant` a partir de `job_score.cluster`,
monta o prompt com as `matched_keywords`/`missing_keywords` daquela vaga e grava
o caminho do resultado em `application.cover_letter_path`. Sem variante escrita,
não há o que adaptar.

> **Invariante:** Não invente evidência. O agente de tailoring só pode citar o
> que está sob a chave `evidence` de `profile.yaml`. O que está em `growth` é
> lacuna assumida — sinalize, nunca maquie. A regra está escrita no próprio
> YAML: *"facts only. Anything aspirational goes under `growth`, never under
> `evidence`."*

### 2.5 Fila de engajamento assistido no LinkedIn

**Estado: 🟡 scaffolding.** As tabelas `engagement`, `target_account` e
`metric_snapshot` existem na migration. **Nenhum código escreve em nenhuma
delas.** A skill `linkedin-positioning` já descreve o fluxo.

**Primeiro passo concreto:** `jho engage add --kind comment --url <post> --draft "<texto>"`
e `jho engage next`, que apenas listam e marcam `status` (`queued` → `done` |
`skipped`). O comando **imprime a URL para o humano abrir**. Nada de HTTP contra
o LinkedIn nesse caminho de código.

> **Invariante:** Nunca faça scraping do LinkedIn. Nada no repositório pode ler
> `li_at`, dirigir uma sessão autenticada ou usar um "LinkedIn MCP" não oficial
> — viola a seção 8.2 do User Agreement e arrisca a conta que é o principal
> ativo de posicionamento. O próprio schema carimba a fronteira na tabela
> `engagement`: *"Rows here are NEVER executed automatically. The agent drafts,
> the human opens the URL and acts."* Ver `docs/adr/0001-nao-fazer-scraping-do-linkedin.md`.

### 2.6 Loops Compozy para as rodadas recorrentes

**Estado: 🟡 registrado, agendamento pausado durante a migração.** O loop de
triagem diária existe em `compozy/loops/job-sweep.yaml`
(`apiVersion: compozy.loop/v1`, `kind: Loop`, `meta.name: job-sweep`) e separa
um operador, que executa `pnpm jho jobs sweep` e grava apenas agregados, de um
revisor `deny-all`, que recebe o snapshot por `file-import` e devolve
`status`/`summary`/`candidates`. O `compozy/README.md` registra o estado exato:
a definição local aguarda publicação após a migração segura, o workspace está
registrado e há uma única automation job de dias úteis (`0 9 * * 1-5`),
desabilitada até a execução manual da definição revisada. A última execução
manual documentada (`looprun-a066b558ff6b112d`) concluiu sem falhas de fonte e
sem mutar o funil.

O próximo passo operacional é publicar a definição revisada, executar e
inspecionar as duas sessões, e só então reabilitar o agendamento. Os loops de
kit de candidatura (2.4) e de engajamento (2.5) permanecem fora desta onda.

> **Invariante:** O Loop recomenda, não move o funil. `job-sweep` não pode
> chamar `jho track` — a tabela `application` é a única coisa que o sistema não
> consegue recriar por sync, e a decisão de candidatar-se é do usuário. A regra
> está escrita no prompt do próprio loop e no `compozy/README.md`.

---

## Fase 3 — Deploy

**Estado: ✅ implantado em Vercel + Turso, sem retirar o modo local.** O
default de `TURSO_DATABASE_URL` continua sendo `file:./data/jobs.db`, portanto
`pnpm jho` funciona com zero configuração local. Produção, staging e dev usam
bancos Turso separados e seguem o fluxo de branches descrito em
`docs/engineering/deploy.md`.

O que já foi decidido para não travar depois:

| Decisão | Onde |
|---|---|
| libSQL em vez de `better-sqlite3` — mesmo driver para arquivo local e Turso | `src/core/db/client.ts`, `docs/adr/0002-libsql-em-vez-de-better-sqlite3.md` |
| `drizzle.config.ts` já usa `dialect: "turso"` | `drizzle.config.ts` |
| `@libsql/client` fora do bundle do Next | `next.config.ts` → `serverExternalPackages` |
| Falha alta quando a URL é remota e o token está vazio | `getDb()` lança antes de qualquer query |

> **Invariante:** Sem dependência nativa. libSQL, nunca `better-sqlite3`. O
> filesystem da Vercel é efêmero — um banco só-arquivo lá perderia silenciosamente
> cada candidatura registrada. Essa é a única razão de a escolha existir.

> **Invariante:** URL remota sem token falha alto e cedo. `getDb()` lança se
> `TURSO_DATABASE_URL` não começa com `file:` e `TURSO_AUTH_TOKEN` está vazio —
> *"failing loudly here beats a confusing 401 deep inside a cron run."*

### 3.1 Turso + Vercel

Os três ambientes remotos e o procedimento de migração estão documentados em
`docs/engineering/deploy.md`. As credenciais Turso continuam pertencendo ao
operador e ficam nos secrets de cada ambiente, nunca em arquivos versionados.

### 3.2 Rotas de cron protegidas por `CRON_SECRET`

**Estado: ✅ entregue para reconferência em lotes.**
`app/api/cron/recheck/route.ts` valida `CRON_SECRET` e processa um lote compatível
com o limite da Vercel. A varredura completa pertence ao GitHub Actions, onde
os comandos longos cabem, mas os dois agendadores estão temporariamente
desligados desde 03/09/2026.

> **Invariante:** A rota de cron não pode virar um segundo pipeline. Se ela
> precisar de lógica que a CLI não tem, a lógica está no lugar errado — vai para
> `src/core/`, e os dois chamadores compartilham.

### 3.3 Publicação oficial no LinkedIn

**Estado: 🟡 scaffolding.** `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` e
`LINKEDIN_REDIRECT_URI` estão no `.env.example`; nenhum é lido por código hoje.
A tabela `post` existe (com `linkedin_urn`, `impressions`, `reactions`,
`comment_count`) e ninguém escreve nela. O `.env.example` já registra o fato que
torna isso viável: *"Both are self-serve. `w_member_social` needs NO partner
review for posting to your own profile."*

**Primeiro passo concreto:** o callback OAuth —
`app/api/linkedin/callback/route.ts` — trocando o code por um token com escopo
`openid profile w_member_social` e guardando-o fora do git (o `.gitignore` já
cobre `*.token.json`). Publicar vem depois, lendo `post` com `status = 'ready'` e
gravando o `urn:li:share:...` retornado em `post.linkedin_urn`.

> **Invariante:** Publicação usa **apenas** a API oficial com
> `w_member_social`, e apenas no perfil do próprio usuário. Comentários,
> conexões e busca de vagas continuam **assistidos** em qualquer fase — a Fase 3
> automatiza o post, nunca a interação.

---

## Fora do roadmap (não-objetivos)

| Ideia | Por que não |
|---|---|
| Scraping de LinkedIn / Indeed / Glassdoor autenticados | Viola os termos e arrisca a conta; `docs/adr/0003-sourcing-via-ats-publicos.md` |
| Envio automático de candidaturas | O funil é estado do usuário; a decisão de aplicar não é delegável |
| Trocar o scorer determinístico por um LLM | O determinístico é o filtro reproduzível sobre milhares de linhas; o LLM entra só no topo (2.3), `docs/adr/0004-scoring-deterministico.md` |
| Build step / bundler para a CLI | Type stripping nativo do Node 24, `docs/adr/0006-typescript-apagavel-sem-build-step.md` |

> **Invariante:** Só sintaxe TypeScript apagável em tudo que a CLI carrega —
> sem `enum`, sem parameter properties, sem `namespace`, sem decorators.
> `erasableSyntaxOnly: true` está ligado no `tsconfig.json`; o sintoma em runtime
> é `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Vale para cada arquivo novo das Fases 2
> e 3.


## Status em 2026-08-18, fim do dia

Muita coisa da Fase 2 foi entregue no mesmo dia em que foi planejada. O que
mudou de estado:

| Item | Antes | Agora |
|---|---|---|
| Dashboard Next.js | ⬜ planejado | ✅ 5 rotas, shadcn/ui, Server Components |
| Remuneração com moeda | ⬜ não existia | ✅ `Money`, faixas por moeda, câmbio do BCE |
| Ingestão de e-mail e OAuth do Gmail | ⬜ planejado | ✅ código completo; credenciais e autorização pertencem ao operador |
| Referrals | ⬜ planejado | ✅ `contacts` + `referrals` |
| Cadastro por URL | ⬜ planejado | ✅ `jobs add`, resolvendo pelo ATS |
| Import de plataforma logada | ⬜ não existia | ✅ `jobs import` |
| Verificação de links | ⬜ não existia | ✅ `jobs verify` — 314 vagas mortas fechadas |
| Braintrust | ⬜ não existia | ✅ elegibilidade por país estruturada |
| Export CSV | ⬜ não existia | ✅ `/api/export`, respeitando filtros |
| Arquitetura hexagonal | ⬜ indecisa | 🟡 decidida (ADR 0007), passo 1 de 12 feito |

### O que continua não existindo

- **Geração de CV e cover letter.** A skill `application-kit` descreve o
  processo; não há comando.
- **Publicação no LinkedIn.** A API oficial permite; não foi integrada.
- **Submissão autônoma.** Último passo da migração, e o mais irreversível.
- **Re-ranking por LLM.** A arquitetura certa é híbrida — determinístico para a
  massa, LLM para os finalistas —, mas o segundo estágio não existe.

### O que o benchmark mudou de prioridade

Duas conclusões do `docs/benchmark/` reordenam a fila:

**Fonte que nomeia o empregador vale mais que volume anônimo.** O Jobgether é
74% do acervo, oculta a empresa e teve 25% de links mortos. Reduzir o peso dele
e adicionar boards diretos rende mais que qualquer refinamento de scorer.

**Canal decide mais que ranqueamento.** Referrals são ~40% das contratações.
O `contacts`/`referrals` existe, mas as 30 contas-alvo da auditoria §2.2 ainda
precisam ser cadastradas — é pesquisa, não código.
