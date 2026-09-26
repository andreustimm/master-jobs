# Regras de dados, ingestão e sourcing

Referência normativa do domínio de dados. Resumo crítico em
[AGENTS.md](../../../AGENTS.md); índice e procedimento de conflito em
[README.md](README.md). O contrato atual de tabelas, FKs e migrations está em
[data-model.md](../../data-model.md); o de cada fonte, em
[sources.md](../../sources.md).

---

<a id="g02"></a>
## G02 — Ingestão nunca escreve em `application` (regra 2)

**Obrigação.** Sync, import, captura e parsing de e-mail mexem em `job`;
jamais em decisões do usuário (`application`, `application_event`). E-mail
produz **sugestões** em `mail_suggestion`, que o usuário aceita ou descarta.
Quebrar isso destrói o único dado irrecuperável.

**Escopo.** Nenhum código sob `src/core/ingest/` ou `src/core/sources/`
importa `application` ou `applicationEvent` para escrita. Se o sync precisar
sinalizar algo sobre vaga já candidatada, o lugar é `job` ou um campo derivado.

**Agente em triagem (resolve C18).** O agente propõe o veredito; ele só registra
uma decisão (`jho track`) que o usuário tomou — respondendo à proposta ou por
pedido explícito que já a delegue. Rodar o sync não é essa autorização, e
`applied` registra uma candidatura que o próprio usuário enviou (G37). As skills
`job-triage` e os comandos `/vagas` e `/aplicar` seguem esta regra.

Origem: regra 2. Detalhes: [data-model.md](../../data-model.md) ("Ingestão nunca
escreve em `application`"),
[ADR 0005](../../adr/0005-separacao-entre-fato-observado-e-decisao-do-usuario.md).
Prova: `tests/db-decision-integrity.test.ts`, `tests/cov-cli-ingestao.test.ts`,
`tests/mail-suggestion.test.ts`.

<a id="g03"></a>
## G03 — Vaga que some é fechada, nunca deletada (regra 3)

**Obrigação.** Ausência na fonte marca `closedAt`; ingestão e desaparecimento
**nunca** apagam vaga. Apagar quebra o histórico de candidaturas por foreign
key.

**Exceção nomeada** (resolve C04). O único descarte autorizado é a retenção
administrativa (`jho db prune`, `jho db cleanup --apply`), que passa por
`deleteClosedJobsWithoutApplication()` em `src/core/db/retention.ts`: só vaga
fechada e elegível, **sem** candidatura, com `SELECT ... FOR UPDATE` seguido de
nova conferência do predicado, para que uma candidatura confirmada durante o
descarte não seja apagada em cascata. Explicitar a exceção não amplia a
autorização: nenhum outro caminho apaga `job`.

Origem: regra 3. Detalhes: [data-model.md](../../data-model.md) ("Vaga que some
é fechada, não deletada"). Prova: `tests/db-retention.test.ts`,
`tests/db-decision-integrity.test.ts`, `tests/job-lifecycle.test.ts`.

<a id="g76"></a>
## G76 — Retenção protege decisões, inclusive sob concorrência

**Obrigação.** Retenção descarta só vaga elegível sem decisão, oferece
dry-run/relatório e preserva histórico. A disputa descarte × criação de
candidatura é resolvida pelo lock descrito em G03, não pela ordem dos comandos.

Origem: [data-model.md](../../data-model.md) (retenção). Prova:
`tests/db-decision-integrity.test.ts` (falhava antes da correção nos dois
caminhos de descarte).

<a id="g75"></a>
## G75 — `application_event` é append-only; transição atômica

**Obrigação.** `application_event` nunca é atualizada nem deletada pelo ciclo
de vida do funil: correção é evento novo. Voltar de estágio é uma transição
comum, e desfazer grava um `status_change` compensatório com
`reverts_event_id` apontando para o revertido (#316). Status e evento são
gravados na mesma transação, `applied_at` é carimbado na entrada em `applied`
sem data gravada e só o desfazer dessa entrada o limpa, e o status anterior é
token de concorrência otimista — do mesmo `commitOverSnapshot` para transição e
desfazer. Desfazer o primeiro registro não apaga a candidatura: ela fica
`untracked`, fora do funil e dentro da proteção de G03.

**Limite** (resolve C14). Append-only não é retenção absoluta: a FK é
`cascade`, e apagar candidatura, candidato ou vaga leva o histórico junto — por
isso o único descarte de vaga (G03) deixa de fora toda vaga com candidatura. Não
troque o cascade para satisfazer uma frase; mudar o ciclo de vida é decisão
própria.

Origem: [data-model.md](../../data-model.md) (`application_event`),
[ADR 0020](../../adr/0020-ciclo-de-vida-e-historico-de-candidaturas.md). Prova:
`tests/repo.application.test.ts` (inclusive um gatilho que recusa UPDATE e
DELETE em `application_event` enquanto a candidatura avança, volta e desfaz).

<a id="g20"></a>
## G20 — FK declara `ON DELETE` no schema e no DDL

**Obrigação.** FKs são contrato de dados, não detalhe de migration. Toda
alteração em `REFERENCES` declara a ação `ON DELETE` no schema e no DDL
aplicado. Uma divergência deixa a migration incompleta, mesmo que a sintaxe
aceite a tabela.

**Intenção além de paridade** (resolve C05). O Drizzle completa com `no action`
o que ninguém escreveu, então paridade não prova intenção: `onDelete` é escrito
em toda FK, inclusive quando a escolha é `no action`.

Origem: AGENTS (invariante "FKs são contrato de dados"). Prova:
`tests/cov-db-schema.test.ts` (paridade em `pg_constraint`, PostgreSQL real),
`tests/fk-delete-intent.test.ts` (intenção escrita).

<a id="g68"></a>
## G68 — PostgreSQL é o runtime; SQLite é só legado

**Obrigação.** `DATABASE_URL` é o runtime; `DATABASE_MIGRATION_URL` é a conexão
privilegiada de migrations. Produção é PostgreSQL (Supabase, schema
`production`); local é PostgreSQL isolado. SQLite/Turso só aparecem no fluxo de
importação do snapshot legado (`data/jobs.db`, gitignored, não é runtime) e em
material histórico rotulado. Procedimento de migration segue a skill
`drizzle-safe-migrations`, escrita para PostgreSQL.

**Migração não aditiva suspende a promoção e a migração automáticas** — ver
[delivery.md](delivery.md#g51).

Origem: AGENTS ("Convenções de código"). Detalhes:
[architecture.md](../../architecture.md) ("PostgreSQL explícito no runtime"),
[deploy.md](../deploy.md), [local-postgres.md](../local-postgres.md). Prova:
`tests/postgres-schema.test.ts`, `tests/postgres-upgrade.test.ts`.

<a id="g27"></a>
## G27 — Guarda de configuração recusa quem pede MENOS

**Obrigação.** Valide contra o que a política **perde**, não contra a presença
do parâmetro, e use lista de permissão para que valor desconhecido recuse. Na
URL do banco, `sslmode=require`, `verify-ca` e `verify-full` pedem o mesmo ou
mais do que o cliente já impõe e são aceitos; `disable`, `allow`, `prefer`,
valor inventado e os demais parâmetros de TLS são recusados com erro que nomeia
a variável, nunca apagados em silêncio.

**Por quê.** A validação recusava qualquer `sslmode`, e a integração do Supabase
com a Vercel cadastra `POSTGRES_URL` **com** `sslmode=require`: o corte de
produção da 1.13.1 subiu e devolveu 500 em toda página que toca o banco, por 28
minutos.

Origem: AGENTS (invariante "Guarda de configuração"). Contrato em
`src/core/db/config.ts` e [deploy.md](../deploy.md) ("Query string"). Prova:
`tests/db-config-diagnostics.test.ts`.

<a id="g28"></a>
## G28 — Variável Sensitive não é legível: teste com a forma do provedor

**Obrigação.** `POSTGRES_URL`, `POSTGRES_PASSWORD`, `DATABASE_CA_CERT` e
`DATABASE_URL` estão marcadas **Sensitive** na Vercel, e Sensitive é
*write-only* — não volta pela API, pelo painel, nem pelo `vercel env pull`
(que devolve `[SENSITIVE]`). A única defesa é o teste usar a forma **real** que
o provedor cadastra, query string inclusive. Nunca tente extrair, imprimir ou
copiar esses valores.

Origem: AGENTS (invariante "Variável de provedor não é legível"). Prova:
`tests/db-config-diagnostics.test.ts`.

<a id="g26"></a>
## G26 — Só 404 e 410 fecham uma vaga

**Obrigação.** 401/403/429 são bloqueio de robô, não prova de ausência — o
Himalayas devolve 403 em toda requisição, e fechar nele apagaria uma fonte viva
inteira. 5xx e falha de rede não decidem nada. URL do LinkedIn devolve
`inconclusive` sem pedido (G01). `alive` reabre: um 404 transitório não pode
sumir com a vaga para sempre.

A regra é função pura em `src/core/ingest/probe.ts` porque é a única capaz de
esconder uma vaga boa por engano.

Origem: AGENTS (invariante "Só 404 e 410"). Prova:
`tests/cov-ingest-verify.test.ts`, `tests/verify-queue.test.ts`.

<a id="g12"></a>
## G12 — Apelido de campo decide pelo VALOR normalizado

**Obrigação.** Escolha entre apelidos de campo decide pelo valor normalizado,
nunca pela presença da chave. `{ company: { name: "  " }, employer: "Acme" }`
entrava como "Desconhecida" porque um objeto passa no teste de presença e
`employer` nunca era lido — e vaga sem nome de empresa some do `jho referrals`.
É G42 um nível mais fundo.

Origem: AGENTS (invariante "Escolha entre apelidos"). Prova:
`tests/import-field-alias.test.ts`, `tests/cov-ingest-import.test.ts`.

<a id="g42"></a>
## G42 — `??` não protege contra string vazia (regra 17)

**Obrigação.** Várias APIs devolvem `""` para campo não preenchido. Use
`firstNonEmpty()` de `src/core/sources/http.ts`. Esse bug já apagou 4.538
descrições uma vez. `??` continua correto onde a semântica é de fato nullish.

Origem: regra 17. Prova: `tests/cov-sources-http.test.ts`,
`tests/extraction.test.ts`, `tests/cov-core-contacts.test.ts`.

<a id="g13"></a>
## G13 — Limite sob concorrência reserva o slot ANTES do `await`

**Obrigação.** A reserva síncrona é atômica porque o laço de eventos não
interrompe código síncrono; conferir depois do `await` deixava N−1 workers
passarem juntos. Entre processos, a reserva é no banco (G74).

Origem: AGENTS (invariante "Limite sob concorrência"). Prova:
`tests/fetcher-limit.test.ts`, `tests/platform-quota.test.ts`.

<a id="g74"></a>
## G74 — Cota por plataforma; captura não reatribui nem fecha

**Obrigação.** A cota é compartilhada por plataforma e reservada por upsert
condicional (nunca passa do limite com trabalhadores concorrentes). Um 429 leva
o dia da plataforma ao teto. Captura por termo nunca fecha, arquiva, apaga nem
reatribui vaga; vaga existente conserva fonte, id externo, URLs e payload de
quem a trouxe primeiro. Os números de limite são configuração datada, não
promessa das plataformas.

Origem: [sources.md](../../sources.md) ("O livro de cota", "A fonte `~terms`").
Prova: `tests/platform-quota.test.ts`, `tests/term-captures.test.ts`.

<a id="g77"></a>
## G77 — `fingerprint` é identidade; `content_hash` detecta edição

**Obrigação.** `fingerprint` é a identidade global da vaga (UNIQUE). Mudar sua
receita invalida a deduplicação do banco inteiro e exige migração de dados na
mesma transação. `content_hash` é diagnóstico de mudança: nunca chave de
lookup, nunca `UNIQUE`.

**Efeito atual** (resolve C09 na parte de dados). Conteúdo alterado reescreve a
linha **e descarta o score** da vaga, que é repontuada; `applyUrl` e demais
metadados que não entram no hash não invalidam a nota.

Origem: [data-model.md](../../data-model.md) ("Fingerprint vs contentHash").
Prova: `tests/job-observation.test.ts`, `tests/cov-ingest-observe.test.ts`.

<a id="g70"></a>
## G70 — Fonte nova é validada contra a API real

**Obrigação.** Ao adicionar fonte:

1. Adapter em `src/core/sources/` implementando `SourceAdapter`.
2. Registrar em `registry.ts` e no union `SourceKind` de `types.ts`.
3. Adicionar em `config/sources.yaml` com `rationale`.
4. **Validar contra a API real:** `pnpm jho sources probe <kind> <handle>`,
   registrando data e resultado.

Nunca mapeie campos a partir de documentação sem conferir resposta real.

**Board vazio não prova handle errado** (resolve C17). Zero vagas com status e
formato válidos pode ser legítimo; o que prova erro é status (404), formato ou
contrato divergente. Não feche board inteiro por resultado vazio nem insista em
retry indevido.

Origem: AGENTS ("Ao adicionar uma fonte"). Detalhes:
[sources.md](../../sources.md). Procedimento: comando `fonte-nova`.

<a id="g71"></a>
## G71 — Fonte que nomeia o empregador vale mais que volume anônimo

**Obrigação.** Qualidade de fonte é julgada por empregador identificado,
elegibilidade estruturada e links vivos, não por volume. Exemplo registrado: o
Jobgether chegou a responder por 74% do acervo, oculta a empresa por design e
teve 25% de links mortos na verificação; o Braintrust trazia 119 vagas, empresa
nomeada e elegibilidade por país estruturada. A prioridade é match **possível**
com o perfil. Não crie score oculto de fonte a partir disso.

Origem: AGENTS (invariante de qualidade de fonte). Detalhes:
[sources.md](../../sources.md), [scoring.md](../../scoring.md).

<a id="g81"></a>
## G81 — Re-seed atualiza texto, nunca progresso

**Obrigação.** `seedPositioning()` nunca reseta o `status` de uma tarefa de
posicionamento: re-seed refresca redação, não estado. O progresso pertence ao
usuário. O mesmo vale para qualquer seed que toque tabela com decisão do
usuário.

Origem: [architecture.md](../../architecture.md) ("Posicionamento"). Prova:
`tests/cov-positioning-plan.test.ts` (re-seed depois de `done` preserva
`status` e `doneAt`).
