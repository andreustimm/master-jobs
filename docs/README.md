# Índice da documentação

`job-hunt-os` é o cockpit de busca de vagas de **Andreus Timm** (Senior AI Software Architect, 20+ anos, Brasil, remoto B2B, **sem autorização de trabalho nos EUA**). Ele resolve três problemas que o LinkedIn não resolve: (1) as vagas boas estão espalhadas por dezenas de boards ATS públicos que ninguém consegue varrer à mão todo dia, (2) 90% do que aparece é ruído — júnior demais, restrito a `US only`, ou fora do stack — e (3) sem um registro próprio, o funil de candidaturas vira memória e planilha morta.

O sistema busca vagas em APIs **públicas e não autenticadas** de ATS e agregadores (Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, Himalayas, Remotive, Arbeitnow, RemoteOK, Adzuna), deduplica por `fingerprint`, aplica um **fit score determinístico** derivado de `profile/profile.yaml` — sem LLM, sem aleatoriedade, sempre auditável via `jho jobs show <id>` — e mantém o funil de candidaturas em tabelas separadas do fato observado. Hoje roda **localmente**, com libSQL como arquivo em `data/jobs.db`; Turso + Vercel é caminho preparado, não modo atual.

> **Invariante:** Não descreva como pronto o que ainda não está. Pronto e validado: 12 fontes configuradas, 4.824 vagas ingeridas num sync real, scoring auditável, funil, export para o vault Obsidian. **Não existe ainda:** UI Next.js, deploy Vercel, geração de CV/cover letter, integração de publicação no LinkedIn.

---

## Comece por aqui

Quatro comandos levam um clone limpo até uma lista de vagas pontuada:

```bash
pnpm install
pnpm jho db migrate                  # cria/atualiza o schema em data/jobs.db
pnpm jho jobs sync                   # busca as 12 fontes e pontua ao final
pnpm jho jobs list --min-fit 60      # as vagas que valem seu tempo, melhor fit primeiro
```

Notas que economizam confusão:

- `pnpm jho ...` é `node --experimental-strip-types --no-warnings --env-file-if-exists=.env src/cli.ts`. Exige **Node >= 24**.
- `jobs sync` já chama `runMigrations()` no início e `scoreAll()` no final — `db migrate` acima é redundante na prática, mas é a forma explícita de verificar que o banco abre antes de fazer rede. Use `--no-score` para pular a pontuação.
- Nenhuma variável de ambiente é obrigatória. `TURSO_DATABASE_URL` tem default `file:./data/jobs.db`; só o adapter `adzuna` (comentado em `config/sources.yaml`) precisa de credenciais, e sem elas ele retorna 0 vagas com warning em vez de falhar.
- Todo comando é idempotente. Rodar de novo nunca estraga nada.

Depois do primeiro `list`, o ciclo normal é `jho jobs show <id>` → `jho track <id> shortlisted` → `jho pipeline` → `jho report`.

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

---

## As seis regras que um agente não pode quebrar

O texto normativo está em `CLAUDE.md` (e no espelho `AGENTS.md`). Resumo, com o ponteiro para o documento que explica cada uma:

> **Invariante:** Nunca faça scraping do LinkedIn. Nada aqui pode ler `li_at`, dirigir sessão autenticada ou usar um "LinkedIn MCP" não oficial — viola a seção 8.2 do User Agreement e arrisca a conta que é o principal ativo de posicionamento. Publicação usa a API oficial (`w_member_social`); comentários, conexões e busca são **assistidos** — o agente redige, o humano executa. Ver [`linkedin-policy.md`](linkedin-policy.md) e [ADR 0001](adr/0001-nao-fazer-scraping-do-linkedin.md).

> **Invariante:** Ingestão nunca escreve em `application`. O sync pode inserir, atualizar e fechar `job`, mas jamais toca decisões do usuário. Ver [`data-model.md`](data-model.md) e [ADR 0005](adr/0005-separacao-entre-fato-observado-e-decisao-do-usuario.md).

> **Invariante:** Vaga que some é fechada, não deletada. Marque `closedAt`. A única exclusão permitida é `pruneClosed()`, e ela protege explicitamente o que tem candidatura. Ver [`operations.md`](operations.md).

> **Invariante:** Só sintaxe TypeScript apagável. O runtime é o type stripping nativo do Node 24 — sem `enum`, sem parameter properties, sem `namespace`, sem decorators. `erasableSyntaxOnly: true` está ligado no `tsconfig.json`; o sintoma em runtime é `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Ver [ADR 0006](adr/0006-typescript-apagavel-sem-build-step.md).

> **Invariante:** Mexeu em `profile.yaml` ou no scorer? Bump `SCORER_VERSION` em `src/core/scoring/score.ts` (hoje `"1.0.0"`) e rode `pnpm jho jobs score --all`. Sem o bump, `scoreAll()` considera os scores antigos válidos e eles se misturam com os novos sem ninguém perceber. Ver [`scoring.md`](scoring.md).

> **Invariante:** Não invente evidência. O agente de tailoring de CV só pode citar o que está sob a chave `evidence` de `profile.yaml`. O que está em `growth` é lacuna assumida — sinalize, nunca maquie.

> **Invariante:** `CLAUDE.md` e `AGENTS.md` devem dizer a mesma coisa. Editou um, edite o outro.
