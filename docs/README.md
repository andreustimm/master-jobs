# Índice da documentação

`master-jobs` é o cockpit de busca de vagas de **Andreus Timm** (Senior AI Software Architect, 20+ anos, Brasil, remoto B2B, **sem autorização de trabalho nos EUA**). Ele resolve três problemas que o LinkedIn não resolve: (1) as vagas boas estão espalhadas por dezenas de boards ATS públicos que ninguém consegue varrer à mão todo dia, (2) 90% do que aparece é ruído — júnior demais, restrito a `US only`, ou fora do stack — e (3) sem um registro próprio, o funil de candidaturas vira memória e planilha morta.

O sistema busca vagas em APIs **públicas e não autenticadas** de ATS e agregadores. O sourcing ativo são as **15 fontes de `config/sources.yaml`, cobrindo 9 `kind`s**: `greenhouse` (1), `ashby` (5), `lever` (1), `braintrust` (1), `himalayas` (1), `remotive` (2), `arbeitnow` (1), `remoteok` (1) e `careers` (2). `src/core/sources/registry.ts` também registra adapters para `smartrecruiters`, `recruitee` e `adzuna`; `adzuna` continua comentado no YAML e, por isso, não está entre as fontes ativas. O pipeline deduplica por `fingerprint`, aplica um **fit score determinístico** derivado de `profile/profile.yaml` — sem LLM, sem aleatoriedade, sempre auditável via `jho jobs show <id>` — e mantém o funil de candidaturas em tabelas separadas do fato observado. O runtime atual usa PostgreSQL por `DATABASE_URL`; local roda em uma instância isolada e o snapshot SQLite legado fica fora do fluxo normal. A migração Supabase e a reativação da varredura remota seguem os gates do [incidente de cota de 03/09/2026](operations/turso-quota-incident-2026-09-03.md).

> **Invariante:** Não descreva como pronto o que ainda não está. O histórico validado inclui UI Next.js em Vercel + Turso, 15 fontes configuradas, 4.824 vagas ingeridas num sync real, scoring auditável, funil e export markdown para o vault Obsidian (dependente de `JHO_VAULT_PATH`). O runtime atual já está preparado para PostgreSQL; o corte Turso → Supabase e a reativação da ingestão continuam pendentes. **Ainda não existe:** geração de CV/cover letter e integração de publicação no LinkedIn.

---

## Comece por aqui

Com uma instância PostgreSQL local isolada em `DATABASE_URL` (e
`DATABASE_MIGRATION_URL` apenas para migrations), quatro comandos levam um clone
limpo até uma lista de vagas pontuada:

```bash
pnpm install
pnpm jho db migrate                  # cria/atualiza o schema PostgreSQL local
pnpm jho jobs sync                   # busca as 15 fontes e pontua ao final
pnpm jho jobs list --min-fit 60      # as vagas que valem seu tempo, melhor fit primeiro
```

Notas que economizam confusão:

- `pnpm jho ...` é `node --experimental-strip-types --no-warnings --env-file-if-exists=.env src/cli.ts`. Exige **Node >= 24**.
- `jobs sync` já chama `runMigrations()` no início e `scoreAll()` no final — `db migrate` acima é redundante na prática, mas é a forma explícita de verificar que o banco abre antes de fazer rede. Use `--no-score` para pular a pontuação.
- `DATABASE_URL` é obrigatória para o runtime; `DATABASE_MIGRATION_URL` fica restrita a migrations. O adapter `adzuna` (comentado em `config/sources.yaml`) precisa de `ADZUNA_APP_ID`/`ADZUNA_APP_KEY`, e sem elas retorna 0 vagas com warning em vez de falhar.
- **`jho report` só grava arquivo se você disser onde.** `buildReport()` resolve o destino como `opts.outPath ?? (JHO_VAULT_PATH ? join(JHO_VAULT_PATH, JHO_REPORT_DIR, ...) : null)` (`JHO_REPORT_DIR` default `05_Interviews/LinkedIn`). Sem `JHO_VAULT_PATH` e sem `--out`, `target` é `null`, nada é escrito e a CLI cai no ramo `if (opts.stdout || !path)`, que apenas imprime o markdown. O repositório não versiona `.env` (está no `.gitignore`; existe só `.env.example`), então **na configuração default o export para o vault não acontece** — copie `.env.example` para `.env` e preencha `JHO_VAULT_PATH`.
- Todo comando é idempotente. Rodar de novo nunca estraga nada.

Depois do primeiro `list`, o ciclo normal é `jho jobs show <id>` → `jho track <id> shortlisted` → `jho pipeline` → `jho report` (com `JHO_VAULT_PATH` ou `--out`; sem isso, `report` só imprime no stdout).

---

## Mapa dos documentos

| Documento | Quando ler |
|---|---|
| [`architecture.md`](architecture.md) | Entender o sistema inteiro: o fluxo `sources → ingest → scoring → application → report` e por que `src/core/` é puro e separado da CLI. |
| [`data-model.md`](data-model.md) | Antes de mexer em `src/core/db/schema.ts` ou escrever qualquer query — as 11 tabelas, os índices, e a fronteira entre fato observado e decisão do usuário. |
| [`sources.md`](sources.md) | Adicionar, debugar ou entender uma fonte: endpoint real, significado do `handle` por `kind`, e as armadilhas de cada API (unidades de data, HTML escapado, itens que não são vagas). |
| [`scoring.md`](scoring.md) | Ajustar o ranking: os pesos (`title` 35, `keyword` 30, `geo` 15, `seniority` 12, `comp` 8), a curva saturante de keywords, os blockers e a regra de penalidade. |
| [`linkedin-policy.md`](linkedin-policy.md) | **Antes de qualquer coisa que envolva LinkedIn.** O que é publicação oficial via `w_member_social`, o que é assistido, e o que é proibido. |
| [`cli.md`](cli.md) | Referência completa de comandos, flags e defaults de `jho`. |
| [`operations.md`](operations.md) | A rotina diária/semanal: sincronizar, triar, mover o funil, exportar o relatório, podar vagas velhas. |
| [`product/job-lifecycle-and-application-history.md`](product/job-lifecycle-and-application-history.md) | Regras de fechamento, arquivamento e leitura do histórico para candidato e recrutador. |
| [`engineering/session-2026-09-16.md`](engineering/session-2026-09-16.md) | Registro durável das decisões, bloqueios e próximos passos discutidos na sessão. |
| [`.compozy/tasks/job-lifecycle-retention/`](../.compozy/tasks/job-lifecycle-retention/) | PRD, especificação e testes para arquivar vagas preservando candidaturas. |
| [`.compozy/tasks/environment-sample-only/`](../.compozy/tasks/environment-sample-only/) | Tarefa desta semana para manter dev/staging pequenos e sem ingestão externa. |
| [`operations/turso-quota-incident-2026-09-03.md`](operations/turso-quota-incident-2026-09-03.md) | Incidente ativo: contenção dos agendadores, diagnóstico do consumo Turso e gates obrigatórios antes da reativação. |
| [`qa/README.md`](qa/README.md) | Planejar e executar QA vivo por personas, jornadas, cenários, charters, bugs e relatórios. |
| [`engineering/skills-evaluation.md`](engineering/skills-evaluation.md) | Entender quais skills de desenvolvimento estão instaladas, sua origem e onde entram no fluxo. |
| [`engineering/workflow.md`](engineering/workflow.md) | Começar, retomar e limpar worktrees com validação proporcional. |
| [`engineering/compozy-backlog-map.md`](engineering/compozy-backlog-map.md) | Ordem de decomposição do backlog e ponte entre discovery e tarefas Compozy. |
| [`roadmap.md`](roadmap.md) | O que vem depois e em que ordem — e a lista explícita do que ainda não existe. |
| [`adr/`](adr/) | Por que cada decisão estrutural foi tomada, com as alternativas descartadas. Leia antes de propor reverter qualquer uma delas. |

### Architecture Decision Records

| ADR | Decisão |
|---|---|
| [`0001`](adr/0001-nao-fazer-scraping-do-linkedin.md) | Não fazer scraping do LinkedIn |
| [`0002`](adr/0002-libsql-em-vez-de-better-sqlite3.md) | libSQL em vez de better-sqlite3 |
| [`0003`](adr/0003-sourcing-via-ats-publicos.md) | Sourcing via APIs públicas de ATS e agregadores |
| [`0004`](adr/0004-scoring-deterministico.md) | Scoring determinístico em vez de LLM |
| [`0005`](adr/0005-separacao-entre-fato-observado-e-decisao-do-usuario.md) | Separação entre fato observado e decisão do usuário |
| [`0006`](adr/0006-typescript-apagavel-sem-build-step.md) | TypeScript apagável, sem build step |
| [`0007`](adr/0007-arquitetura-hexagonal-monolito-modular.md) | Arquitetura hexagonal, monólito modular |
| [`0008`](adr/0008-ingestao-de-email-como-fonte-de-sourcing.md) | E-mail como fonte de sourcing |
| [`0009`](adr/0009-fila-de-raspagem.md) | Fila de raspagem em tabela, não em broker |
| [`0010`](adr/0010-submissao-autonoma.md) | Submissão autônoma: preparar sim, enviar não |
| [`0011`](adr/0011-fronteira-compozyos-e-docs.md) | A fronteira entre o CompozyOS e `docs/` |
| [`0012`](adr/0012-novidades-cards-expansiveis-independentes.md) | Versões em cards expansíveis independentes |
| [`0013`](adr/0013-publicacao-local-sem-inventar-horario.md) | Hora de publicação local sem inventar precisão histórica |
| [`0014`](adr/0014-notas-localizadas-em-markdown-seguro.md) | Notas localizadas em Markdown editorial seguro |
| [`0015`](adr/0015-modal-nativo-com-ilha-cliente.md) | Modal nativo com uma ilha cliente estreita |
| [`0016`](adr/0016-changelogs-localizados-e-react-markdown.md) | Changelogs localizados separados e react-markdown |
| [`0017`](adr/0017-precisao-publicacao-e-autoridade-da-versao.md) | Precisão de publicação e autoridade de criação da versão |
| [`0018`](adr/0018-fronteira-de-confianca-da-varredura-compozy.md) | Fronteira de confiança da varredura Compozy |
| [`0019`](adr/0019-retencao-de-payloads-de-ingestao.md) | Payload de ingestão temporário e texto normalizado durável |
| [`0020`](adr/0020-ciclo-de-vida-e-historico-de-candidaturas.md) | Arquivamento de vagas preserva candidaturas |
| [`0021`](adr/0021-ambientes-nao-produtivos-com-dados-sinteticos.md) | Dev e staging usam fixtures, não ingestão real |

---

## As seis regras que um agente não pode quebrar

O texto normativo está em `AGENTS.md`. `CLAUDE.md` é apenas um symlink para a
mesma fonte, assim como Codex e OpenCode compartilham as skills canônicas.
Resumo, com o ponteiro para o documento que explica cada uma:

> **Invariante:** Nunca faça scraping do LinkedIn. Nada aqui pode ler `li_at`, dirigir sessão autenticada ou usar um "LinkedIn MCP" não oficial — viola a seção 8.2 do User Agreement e arrisca a conta que é o principal ativo de posicionamento. Publicação usa a API oficial (`w_member_social`); comentários, conexões e busca são **assistidos** — o agente redige, o humano executa. Ver [`linkedin-policy.md`](linkedin-policy.md) e [ADR 0001](adr/0001-nao-fazer-scraping-do-linkedin.md).

> **Invariante:** Ingestão nunca escreve em `application`. O sync pode inserir, atualizar e fechar `job`, mas jamais toca decisões do usuário. Ver [`data-model.md`](data-model.md) e [ADR 0005](adr/0005-separacao-entre-fato-observado-e-decisao-do-usuario.md).

> **Invariante:** Vaga que some é fechada, não deletada. Marque `closedAt`. A única exclusão permitida é `pruneClosed()`, e ela protege explicitamente o que tem candidatura. Ver [`operations.md`](operations.md).

> **Invariante:** Só sintaxe TypeScript apagável. O runtime é o type stripping nativo do Node 24 — sem `enum`, sem parameter properties, sem `namespace`, sem decorators. `erasableSyntaxOnly: true` está ligado no `tsconfig.json`; o sintoma em runtime é `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Ver [ADR 0006](adr/0006-typescript-apagavel-sem-build-step.md).

> **Invariante:** Mexeu em `profile.yaml` ou no scorer? Bump `SCORER_VERSION` em `src/core/scoring/score.ts` (hoje `"1.0.0"`) e rode `pnpm jho jobs score --all`. Sem o bump, `scoreAll()` considera os scores antigos válidos e eles se misturam com os novos sem ninguém perceber. Ver [`scoring.md`](scoring.md).

> **Invariante:** Não invente evidência. O agente de tailoring de CV só pode citar o que está sob a chave `evidence` de `profile.yaml`. O que está em `growth` é lacuna assumida — sinalize, nunca maquie.

> **Invariante:** edite somente `AGENTS.md`; nunca substitua nem edite o symlink `CLAUDE.md` como uma cópia independente.


## Documentos adicionados depois

| Documento | Quando ler |
|---|---|
| [email-ingestion.md](email-ingestion.md) | Mexer no pipeline de e-mail |
| [sources-autenticadas.md](sources-autenticadas.md) | Revelo, BairesDev, marketplaces logados |
| [adr/0007](adr/0007-arquitetura-hexagonal-monolito-modular.md) | Arquitetura de destino |
| [adr/0008](adr/0008-ingestao-de-email-como-fonte-de-sourcing.md) | Por que e-mail é legítimo |
| [product/backlog.md](product/backlog.md) | Backlog priorizado por impacto |
| [benchmark/](benchmark/) | Concorrentes, mercado e riscos |
| [../MIGRATION.md](../MIGRATION.md) | **Antes de criar arquivo novo em `src/`** |

## Números, em 2026-08-18

| Item | Valor |
|---|---:|
| Vagas abertas | 6.239 |
| Vagas fechadas (verificação) | 314 |
| Empresas | 1.031 |
| Fontes ativas | 13 |
| Acima de 45 / 60 / 70 | 1.207 / 175 / 23 |
| Melhor fit | 85,9 |
| Tabelas | 14 |
| Testes | 126 |
