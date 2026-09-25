// Application tables live in the private PostgreSQL production schema.
/**
 * master-jobs data model.
 *
 * Design rules:
 *  - `job` rows are immutable facts observed from a source; anything the user
 *    decides lives in `application` so re-ingesting never destroys decisions.
 *  - Every job carries a stable `fingerprint` so the same posting seen through
 *    two sources (e.g. the company's Ashby board and Himalayas) collapses.
 *  - Scores are derived and versioned, so the scorer can be rerun freely.
 *  - Nothing here stores LinkedIn session material. See docs/linkedin-policy.md.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  foreignKey,
  primaryKey,
  doublePrecision,
  pgSchema,
  boolean,
  json,
  jsonb,
  text,
  uniqueIndex,
  type AnyPgColumn,
  type PgColumn,
  unique,
} from "drizzle-orm/pg-core";
import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from "../../contexts/pursuit/domain/application.ts";

export { APPLICATION_STATUSES, type ApplicationStatus };

export const production = pgSchema("production");
const now = sql`to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/* -------------------------------------------------------------------------- */
/* Sourcing                                                                    */
/* -------------------------------------------------------------------------- */

/** One configured feed: an ATS board, an aggregator, or a manual import. */
export const source = production.table(
  "source",
  {
    id: text("id").primaryKey(), // "greenhouse:stripe"
    kind: text("kind").notNull(), // greenhouse | lever | ashby | smartrecruiters | workable | himalayas | remotive | arbeitnow | remoteok | adzuna | manual
    handle: text("handle").notNull(), // board token / company slug / query
    label: text("label").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Why this source is on the list — keeps the config self-documenting. */
    rationale: text("rationale"),
    lastSyncedAt: text("last_synced_at"),
    lastStatus: text("last_status"), // ok | error
    lastError: text("last_error"),
    lastJobCount: integer("last_job_count"),
    createdAt: text("created_at").notNull().default(now),
    /**
     * Aposentadoria suave: fonte não é apagada (as vagas apontam para ela).
     * Aposentada sai do sync e de toda execução; vagas e histórico ficam.
     */
    retiredAt: text("retired_at"),
    // `origin` e `config_revision` têm padrão mas aceitam nulo: `source`
    // atravessa a importação do snapshot legado, e coluna posterior a ele é
    // opcional por contrato (`tests/postgres-schema.test.ts`). Nada no código
    // grava nulo nelas.
    /** Quem criou a linha: `yaml` (arquivo), `admin` (tela) ou `system` (importação, captura por termo). */
    origin: text("origin").default("system"),
    /** Sobe a cada edição; entra na chave de idempotência e no retrato da execução. */
    configRevision: integer("config_revision").default(1),
    /** NOME da variável de ambiente com a credencial — nunca o valor (G41). */
    secretRef: text("secret_ref"),
    /**
     * Não nulo = o banco governa a linha (importação ou edição do admin), e o
     * YAML só insere o que falta. Nulo = a linha ainda espelha o arquivo.
     */
    managedAt: text("managed_at"),
  },
  (t) => [uniqueIndex("source_kind_handle_idx").on(t.kind, t.handle)],
);

/** Companies, deduplicated across sources, plus contractor-eligibility facts. */
export const company = production.table(
  "company",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    website: text("website"),
    careersUrl: text("careers_url"),
    /** null = unknown. Set by research, never guessed by the ingester. */
    hiresContractors: boolean("hires_contractors"),
    hiresLatam: boolean("hires_latam"),
    /** Was this company reached through BairesDev? Feeds the markup hypothesis. */
    viaAgency: text("via_agency"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("company_slug_idx").on(t.slug)],
);

/**
 * O texto sem espaço e hífen: a forma que os índices trigrama da busca por
 * termo guardam (#214). Índice e consulta usam esta mesma função, porque uma
 * expressão diferente — mesmo equivalente — faz o planner ignorar o índice
 * sem erro nenhum.
 */
export const withoutSeparators = (column: PgColumn) => sql`replace(replace(${column}, ' ', ''), '-', '')`;

/** A job posting as observed. Re-ingest updates lastSeenAt, never user state. */
export const job = production.table(
  "job",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    /** Stable dedupe key; manual comparisons use an isolated namespace. */
    fingerprint: text("fingerprint").notNull(),
    /** sha256 over the meaningful content — detects edits to a live posting. */
    contentHash: text("content_hash").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    // `no action`, declared rather than defaulted: a company that still names
    // jobs cannot be deleted. Nothing deletes companies today; if something
    // starts to, the refusal is the prompt to decide, not a silent cascade
    // through `job` into `application`.
    companyId: integer("company_id").references(() => company.id, { onDelete: "no action" }),
    companyName: text("company_name").notNull(),
    title: text("title").notNull(),
    descriptionHtml: text("description_html"),
    descriptionText: text("description_text"),
    /**
     * Quem cadastrou a vaga, quando ela não veio da internet.
     *
     * O RÓTULO de origem (web · recrutador · manual) deriva de `source.kind` e
     * não é duplicado aqui: coluna denormalizada diverge. Esta guarda outra
     * coisa — a atribuição, para saber *qual* recrutador ofereceu.
     */
    postedByUserId: integer("posted_by_user_id").references(() => authUser.id, {
      onDelete: "set null",
    }),
    /** Quando o link foi sondado pela última vez. Null = nunca. */
    checkedAt: text("checked_at"),
    /** `alive` | `gone` | `inconclusive` — o veredito da última sondagem. */
    checkStatus: text("check_status"),
    /** Código HTTP observado, para diagnóstico. Null em falha de rede. */
    checkCode: integer("check_code"),
    locationRaw: text("location_raw"),
    /** null = the posting does not say. */
    remote: boolean("remote"),
    employmentType: text("employment_type"), // full-time | contract | ...
    seniorityRaw: text("seniority_raw"),
    // Hourly and project rates commonly include cents (e.g. 27.02 USD).
    // Keep the source value instead of making ingestion fail on an integer cast.
    compMin: doublePrecision("comp_min"),
    compMax: doublePrecision("comp_max"),
    compCurrency: text("comp_currency"),
    compPeriod: text("comp_period"), // year | month | hour
    url: text("url").notNull(),
    applyUrl: text("apply_url"),
    postedAt: text("posted_at"),
    firstSeenAt: text("first_seen_at").notNull().default(now),
    lastSeenAt: text("last_seen_at").notNull().default(now),
    /** Set when a previously seen posting disappears from its source. */
    closedAt: text("closed_at"),
    /**
     * Quando a vaga saiu do quadro ativo — decisão de apresentação, não fato da
     * fonte. Separado de `closedAt` porque um é observação e o outro é
     * política: o corte de retenção muda sem que o anúncio mude. Null = ativa.
     * Reversível: um `alive` posterior limpa esta coluna (ADR 0020).
     */
    archivedAt: text("archived_at"),
    raw: json("raw").notNull(),
  },
  (t) => [
    uniqueIndex("job_fingerprint_idx").on(t.fingerprint),
    index("job_source_idx").on(t.sourceId),
    // Identidade estável dentro da fonte (#291): a sincronização procura
    // primeiro por (fonte, id externo) e só depois pelo fingerprint. Não é
    // único de propósito: o acervo já tem, da época em que só o fingerprint
    // identificava, a mesma vaga duas vezes quando o título mudou — e um índice
    // único faria a migração falhar em produção. `resolveObservedIdentity`
    // escolhe entre as duplicatas sem apagar nenhuma (regra 3).
    index("job_source_external_idx").on(t.sourceId, t.externalId),
    index("job_company_idx").on(t.companyName),
    index("job_last_seen_idx").on(t.lastSeenAt),
    index("job_closed_idx").on(t.closedAt),
    // A varredura de arquivamento pergunta sempre a mesma coisa: fechada antes
    // do corte e ainda não arquivada. Índice composto nessa ordem serve à
    // varredura e ao filtro do quadro ativo com a mesma estrutura.
    index("job_archive_scan_idx").on(t.closedAt, t.archivedAt),
    // Pré-filtro da busca por termo (#214). O `~*` de palavra inteira não
    // aproveita trigrama — o separador opcional `[ -]?` entre letras não deixa
    // o pg_trgm extrair nenhum trigrama garantido —, mas o texto sem espaço e
    // hífen contém a chave sempre que o padrão casa. O índice responde ao
    // `ilike` sobre essa forma; o `~*` exato continua decidindo. Só vagas
    // abertas: é o único conjunto que o quadro lê. `termPrefilterLike` em
    // `src/core/term.ts` tem a prova; a expressão precisa ser idêntica à de
    // `termTextCandidates` em `repo.ts`, ou o planner não usa o índice.
    index("job_description_trgm_idx")
      .using("gin", sql`${withoutSeparators(t.descriptionText)} gin_trgm_ops`)
      .where(sql`${t.closedAt} is null`),
    // Grupo "termos parecidos" (#223): o `termo <% title` de `nearMatchesQuery`.
    // Sobre o título cru, sem tirar separador: a similaridade por palavra
    // compara palavras, e é o espaço que as separa.
    index("job_title_trgm_idx")
      .using("gin", sql`${t.title} gin_trgm_ops`)
      .where(sql`${t.closedAt} is null`),
    // A ordem da passada de pontuação (#288): mais recente primeiro, só
    // abertas. A expressão precisa ser idêntica à de `RECENCY` em
    // `scoring/apply.ts`, ou o planner não usa o índice.
    index("job_recency_open_idx")
      .on(sql`coalesce(${t.postedAt}, ${t.firstSeenAt})`, t.id)
      .where(sql`${t.closedAt} is null`),
    // As abertas com descrição completa (#222). A faceta "com descrição" lia o
    // TOAST de cada vaga aberta para testar o 200º caractere; o predicado é
    // calculado na escrita e a leitura só percorre o índice. Precisa ser
    // idêntico ao de `describedOpenJobIds` em `repo.ts`.
    index("job_described_open_idx")
      .on(t.id)
      .where(sql`${t.closedAt} is null and substr(coalesce(${t.descriptionText}, ''), 200, 1) <> ''`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Scoring (derived — safe to wipe and recompute)                              */
/* -------------------------------------------------------------------------- */

export const jobScore = production.table(
  "job_score",
  {
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidate.id, { onDelete: "cascade" }),
    /**
     * The target track this fit measures against (ADR-008). The primary track
     * scores every open job; an accepted track only the jobs relevant to it.
     */
    trackId: integer("track_id")
      .notNull()
      .references(() => targetTrack.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    /** 0..100 overall fit. */
    fit: doublePrecision("fit").notNull(),
    titleScore: doublePrecision("title_score").notNull(),
    keywordScore: doublePrecision("keyword_score").notNull(),
    seniorityScore: doublePrecision("seniority_score").notNull(),
    geoScore: doublePrecision("geo_score").notNull(),
    compScore: doublePrecision("comp_score").notNull(),
    /** Conversion signal, not fit: how likely applying still does anything. */
    freshnessScore: doublePrecision("freshness_score").notNull().default(0),
    benefitScore: doublePrecision("benefit_score").notNull().default(0),
    /** Negative points from disqualifiers (on-site only, visa required, ...). */
    penalty: doublePrecision("penalty").notNull().default(0),
    /** architect | staff | ai-lead | backend | other — drives CV variant choice. */
    cluster: text("cluster").notNull(),
    matchedKeywords: json("matched_keywords").notNull(),
    missingKeywords: json("missing_keywords").notNull(),
    /** Canonical benefit keys the posting mentions, independent of the profile. */
    detectedBenefits: json("detected_benefits"),
    /** Age in days at scoring time; null when no date was available. */
    ageDays: integer("age_days"),
    /** Human-readable justification lines, for the UI and for agent review. */
    reasons: json("reasons").notNull(),
    /** Hard blockers found in the text, e.g. "requires US work authorization". */
    blockers: json("blockers").notNull(),
    eligibilityStatus: text("eligibility_status").notNull().default("unverifiable"),
    eligibilityReasons: json("eligibility_reasons")
      .notNull()
      .default(sql`'[]'`),
    scorerVersion: text("scorer_version").notNull(),
    /** Hash of the candidate-owned scoring profile used for this result. */
    profileHash: text("profile_hash").notNull().default("legacy"),
    scoredAt: text("scored_at").notNull().default(now),
  },
  (t) => [
    primaryKey({
      columns: [t.candidateId, t.trackId, t.jobId],
      name: "job_score_candidate_track_job_pk",
    }),
    index("job_score_fit_idx").on(t.fit),
    index("job_score_candidate_idx").on(t.candidateId),
    index("job_score_candidate_track_fit_idx").on(t.candidateId, t.trackId, t.fit),
    // Leituras por vaga — a melhor nota da reconferência, a invalidação quando o
    // anúncio muda e o cascade de `job` — não podem usar a chave primária, que
    // começa por candidato. Sem este índice cada uma varre a tabela inteira.
    index("job_score_job_idx").on(t.jobId, t.fit),
    // `job_score_board_cover_idx (candidate_id, track_id, job_id) INCLUDE (fit,
    // cluster, blockers)` existe no banco e NÃO aqui: o Drizzle não declara
    // colunas incluídas, então ele nasce na migração custom
    // `0026_job_score_board_cover` (#222). Com as três colunas no índice, ler
    // as notas de uma trilha não visita a tabela, onde cada linha ocupa quase
    // uma página. `tests/facet-read-indexes.test.ts` confere a definição.
  ],
);

/**
 * Onde a passada de pontuação de uma trilha parou (#288).
 *
 * A pontuação percorre as vagas abertas da mais recente para a mais antiga, em
 * lotes de cem (`src/core/scoring/batch.ts`). Depois de cada lote, a posição da
 * última vaga lida é gravada aqui, e a chamada seguinte — outra função da
 * Vercel, trinta segundos depois ou uma hora depois — retoma dela.
 *
 * `profile_hash` e `scorer_version` são os da passada em curso: se o perfil
 * efetivo mudou, a posição não vale mais e a passada recomeça do topo.
 * `last_completed_at` é o que separa a fila "sem nota" (nunca completou uma
 * passada na trilha principal) da manutenção de hora em hora.
 *
 * Derivado, como `job_score`: apagar a linha só faz a próxima passada começar
 * do topo.
 */
export const scoreCursor = production.table(
  "score_cursor",
  {
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidate.id, { onDelete: "cascade" }),
    trackId: integer("track_id")
      .notNull()
      .references(() => targetTrack.id, { onDelete: "cascade" }),
    profileHash: text("profile_hash").notNull(),
    scorerVersion: text("scorer_version").notNull(),
    /** `coalesce(posted_at, first_seen_at)` da última vaga lida; null = topo. */
    positionKey: text("position_key"),
    positionJobId: integer("position_job_id"),
    /** A passada completa mais recente: o atraso da manutenção se mede daqui. */
    lastCompletedAt: text("last_completed_at"),
    /** A primeira passada completa da trilha, gravada uma vez: "tempo até completo". */
    firstCompletedAt: text("first_completed_at"),
    /** Quando o primeiro lote da trilha foi gravado: "tempo até o primeiro lote". */
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.candidateId, t.trackId], name: "score_cursor_candidate_track_pk" })],
);

/* -------------------------------------------------------------------------- */
/* Application pipeline (user-owned state — never touched by ingestion)         */
/* -------------------------------------------------------------------------- */

export const application = production.table(
  "application",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidate.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    status: text("status", { enum: APPLICATION_STATUSES }).notNull().default("backlog"),
    /** direct | ats | referral | recruiter | agency */
    channel: text("channel"),
    appliedAt: text("applied_at"),
    /** Exact immutable document version sent with this application. */
    candidateDocumentId: integer("candidate_document_id"),
    coverLetterPath: text("cover_letter_path"),
    contactName: text("contact_name"),
    contactUrl: text("contact_url"),
    /** Salary or rate actually discussed. */
    rateDiscussed: text("rate_discussed"),
    nextAction: text("next_action"),
    nextActionAt: text("next_action_at"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("application_candidate_job_idx").on(t.candidateId, t.jobId),
    foreignKey({
      columns: [t.candidateDocumentId, t.candidateId],
      foreignColumns: [candidateDocument.id, candidateDocument.candidateId],
      name: "application_candidate_document_fk",
    }).onDelete("restrict"),
    index("application_candidate_idx").on(t.candidateId),
    index("application_candidate_document_idx").on(t.candidateDocumentId),
    index("application_status_idx").on(t.status),
    index("application_next_action_idx").on(t.nextActionAt),
  ],
);

/** Append-only history so the funnel metrics are reconstructable. */
export const applicationEvent = production.table(
  "application_event",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    at: text("at").notNull().default(now),
    kind: text("kind").notNull(), // status_change | note | email | interview | followup
    fromStatus: text("from_status", { enum: APPLICATION_STATUSES }),
    toStatus: text("to_status", { enum: APPLICATION_STATUSES }),
    detail: text("detail"),
  },
  (t) => [index("application_event_app_idx").on(t.applicationId)],
);

/* -------------------------------------------------------------------------- */
/* LinkedIn positioning                                                        */
/* -------------------------------------------------------------------------- */

/** Content drafts. Published through the official w_member_social API only. */
export const post = production.table(
  "post",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    slug: text("slug").notNull(),
    /** Maps to the content pillars in section 13.2 of the positioning audit. */
    pillar: text("pillar").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    lang: text("lang").notNull().default("en"),
    status: text("status").notNull().default("draft"), // draft | ready | published | archived
    scheduledFor: text("scheduled_for"),
    publishedAt: text("published_at"),
    /** URN returned by the LinkedIn Posts API, e.g. urn:li:share:123. */
    linkedinUrn: text("linkedin_urn"),
    impressions: integer("impressions"),
    reactions: integer("reactions"),
    commentCount: integer("comment_count"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("post_slug_idx").on(t.slug)],
);

/**
 * Assisted engagement queue.
 *
 * Rows here are NEVER executed automatically. The agent drafts, the human
 * opens the URL and acts. This is the deliberate boundary that keeps the
 * account inside the LinkedIn User Agreement.
 */
export const engagement = production.table(
  "engagement",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    kind: text("kind").notNull(), // comment | connect | follow | message | endorse
    targetUrl: text("target_url").notNull(),
    targetName: text("target_name"),
    targetRole: text("target_role"),
    targetCompany: text("target_company"),
    /** Why this target matters — keeps the queue from becoming spray-and-pray. */
    rationale: text("rationale"),
    draft: text("draft"),
    status: text("status").notNull().default("queued"), // queued | done | skipped
    queuedFor: text("queued_for"),
    doneAt: text("done_at"),
    outcome: text("outcome"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("engagement_status_idx").on(t.status, t.queuedFor)],
);

/** The 30 target accounts from section 2.2 of the audit. */
export const targetAccount = production.table(
  "target_account",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    name: text("name").notNull(),
    linkedinUrl: text("linkedin_url"),
    category: text("category").notNull(), // recruiter | ai-leader | peer | company
    company: text("company"),
    role: text("role"),
    country: text("country"),
    status: text("status").notNull().default("identified"), // identified | following | engaged | connected | conversing
    lastTouchAt: text("last_touch_at"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("target_account_url_idx").on(t.linkedinUrl)],
);

/** Manually recorded funnel metrics — SSI, search appearances, profile views. */
export const metricSnapshot = production.table(
  "metric_snapshot",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    at: text("at").notNull(),
    key: text("key").notNull(),
    value: doublePrecision("value").notNull(),
    note: text("note"),
  },
  (t) => [uniqueIndex("metric_at_key_idx").on(t.at, t.key)],
);

/** The action plan from section 14, as executable rows. */
export const positioningTask = production.table("positioning_task", {
  id: text("id").primaryKey(), // PT-0001
  horizon: text("horizon").notNull(), // 24h | week | 30d | 60d | 90d
  title: text("title").notNull(),
  why: text("why"),
  how: text("how"),
  expected: text("expected"),
  priority: text("priority").notNull(), // P0 | P1 | P2 | P3
  effort: text("effort"),
  status: text("status").notNull().default("todo"), // todo | doing | done | skipped
  doneAt: text("done_at"),
  /** Pointer back into the audit, e.g. "§14 Primeiras 24 horas". */
  sourceRef: text("source_ref"),
  createdAt: text("created_at").notNull().default(now),
});

/* -------------------------------------------------------------------------- */
/* Candidate (ADR 0007 — the aggregate the product is built around)            */
/* -------------------------------------------------------------------------- */

/**
 * The candidate, as data rather than as a config file.
 *
 * `profile/profile.yaml` still owns the *scoring* parameters — target clusters,
 * keyword weights, hard blockers — because those are tuning knobs that belong
 * in version control where a diff is meaningful. What lives here is the
 * candidate's own material: the CV text, the headline, the summary. That
 * distinction matters because the CV is edited constantly and by a human, and
 * because ADR 0007 anticipates more than one candidate.
 *
 * > **Invariante:** this table holds what the candidate *wrote*. It never holds
 * > a claim the system inferred. Anything derived — extracted keywords, gap
 * > analysis — is computed on read and is safe to discard.
 */
export const candidate = production.table(
  "candidate",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    /** Stable handle so a future multi-candidate setup can scope by it. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    headline: text("headline"),
    location: text("location"),
    email: text("email"),
    linkedinUrl: text("linkedin_url"),
    githubUrl: text("github_url"),
    /** Marks the profile the CLI and UI operate on when none is specified. */
    isDefault: boolean("is_default").notNull().default(false),
    /**
     * Quem pode ver este perfil: `private` | `recruiters` | `public`.
     *
     * **`private` é o padrão, e o padrão é a decisão de segurança.** `public`
     * significa currículo legível sem sessão nenhuma, pela internet inteira —
     * a mesma exposição que este projeto já corrigiu uma vez, quando o
     * dashboard servia o CV para a rede local. Uma coluna cujo default fosse
     * `public` transformaria "esqueci de configurar" em vazamento.
     *
     * Só o próprio candidato muda este valor. Nem admin nem recrutador.
     */
    visibility: text("visibility").notNull().default("private"),
    /**
     * Publicar o TEXTO do currículo no perfil público. Segundo consentimento.
     *
     * `visibility = public` significa "alcançável sem sessão"; publicar o
     * currículo inteiro é outra decisão, e derivá-la da primeira seria
     * surpresa. O CV é o dado que esta instalação inteira protege — foi o
     * vazamento dele na rede local que motivou as regras de bind e de PII.
     * Publicá-lo por escolha do dono é legítimo; publicá-lo como efeito
     * colateral de marcar "público" não é.
     */
    publicCv: boolean("public_cv").notNull().default(false),
    /**
     * O endereço público: `/p/<public_slug>`. Escolhido pelo próprio candidato.
     *
     * Separado de `slug` de propósito. `slug` é o identificador interno — a
     * CLI, o modo aberto e `syncCandidateFromProfile` acham o dono por
     * `slug = 'default'`, e trocá-lo faria o próximo `jho db seed` criar um
     * segundo candidato para ele. O endereço público muda quando a pessoa
     * quiser sem mexer em nada disso.
     *
     * Anulável de propósito: nulo é "sem endereço", e perfil sem endereço não
     * responde em `/p/`. Fica nulo o candidato cujo `slug` é `user-<e-mail>`
     * (publicaria o e-mail) e o que chega pela importação do snapshot legado,
     * até a própria pessoa escolher um em `/candidate`.
     */
    publicSlug: text("public_slug"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("candidate_slug_idx").on(t.slug),
    uniqueIndex("candidate_public_slug_idx").on(t.publicSlug),
  ],
);

/**
 * A CV, cover letter or other document belonging to a candidate.
 *
 * Versioned rather than overwritten: a CV is edited often, and being able to
 * see what was sent to a company three weeks ago is the difference between
 * answering an interview question and guessing.
 *
 * `format` and `sourceBytes` exist for the PDF path that is not built yet —
 * when it is, extraction fills `content` and the original stays recoverable.
 */
export const candidateDocument = production.table(
  "candidate_document",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidate.id, { onDelete: "cascade" }),
    /** cv | cover_letter | portfolio | other */
    kind: text("kind").notNull().default("cv"),
    /** Free label: "ATS EN 2026-07", "variante architect". */
    label: text("label").notNull(),
    /** text | pdf | markdown — pdf means `content` came from extraction. */
    format: text("format").notNull().default("text"),
    content: text("content").notNull(),
    /** Original file, when it was not typed in. Null for pasted text. */
    sourceFilename: text("source_filename"),
    /** Only one document per kind is current; the rest are history. */
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    unique("candidate_document_identity_idx").on(t.id, t.candidateId),
    index("candidate_document_candidate_idx").on(t.candidateId, t.kind),
    uniqueIndex("candidate_document_one_current_idx")
      .on(t.candidateId, t.kind)
      .where(sql`${t.isCurrent} = true`),
  ],
);

/** Candidate-owned scoring policy; profile.yaml is only the default seed. */
export const candidateMatchingProfile = production.table(
  "candidate_matching_profile",
  {
    candidateId: integer("candidate_id")
      .primaryKey()
      .references(() => candidate.id, { onDelete: "cascade" }),
    profileJson: text("profile_json").notNull(),
    updatedAt: text("updated_at").notNull().default(now),
  },
);

/**
 * A target the candidate pursues: one primary and several accepted tracks.
 *
 * `target_json` holds only the target-level part of the profile — clusters,
 * keywords, seniority thresholds, compensation ranges. Eligibility, blockers and
 * evidence stay person-level in `candidate_matching_profile`; the scorer reads
 * the merge of the two (ADR-009). A null target is a pending primary: the
 * candidate has no own profile and is not scored (M-06).
 */
export const targetTrack = production.table(
  "target_track",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidate.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** `lower(trim(name))`: names are unique per candidate ignoring case. */
    nameKey: text("name_key").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    /** active | archived — tracks are archived, never deleted. */
    status: text("status").notNull().default("active"),
    /** Display order; also breaks ties between tracks with the same fit. */
    position: integer("position").notNull(),
    targetJson: text("target_json"),
    /** Target fields inherited from the default profile and not saved since. */
    unreviewedJson: text("unreviewed_json").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("target_track_name_idx").on(t.candidateId, t.nameKey),
    uniqueIndex("target_track_one_primary_idx")
      .on(t.candidateId)
      .where(sql`${t.isPrimary} = true`),
  ],
);

/**
 * A term the candidate wants more jobs about, linked to exactly one track
 * (ADR-003). Private to the candidate; captures are shared per term key.
 */
export const savedTerm = production.table(
  "saved_term",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidate.id, { onDelete: "cascade" }),
    trackId: integer("track_id")
      .notNull()
      .references(() => targetTrack.id, { onDelete: "cascade" }),
    /** Trimmed display form, as the candidate typed it. */
    term: text("term").notNull(),
    /** Equivalence key: case, spaces and hyphens removed (`src/core/term.ts`). */
    termKey: text("term_key").notNull(),
    /** active | paused */
    status: text("status").notNull().default("active"),
    /** manual | track_archived — restoring a track resumes only its own pauses. */
    pausedReason: text("paused_reason"),
    /** Anchor of the 24-hour manual re-run cooldown; the first run counts. */
    lastRunRequestedAt: text("last_run_requested_at"),
    /** Anchor of "new since your last visit". */
    lastVisitAt: text("last_visit_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("saved_term_candidate_key_idx").on(t.candidateId, t.termKey),
    index("saved_term_key_status_idx").on(t.termKey, t.status),
  ],
);

/**
 * Searches a candidate started from the screen, per UTC day. Deleting a term
 * does not delete the count: it is the daily ceiling that keeps a save/delete
 * loop from taking every tenant's per-minute platform slots.
 */
export const savedTermRequest = production.table(
  "saved_term_request",
  {
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidate.id, { onDelete: "cascade" }),
    windowDay: text("window_day").notNull(),
    requested: integer("requested").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.candidateId, t.windowDay], name: "saved_term_request_pk" })],
);

/* -------------------------------------------------------------------------- */
/* Skills                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The global skill catalogue.
 *
 * Exists because the same capability is written a dozen ways — "Node.js",
 * "NodeJS", "node", "Node" — and without a canonical row you cannot count,
 * compare or audit anything. The catalogue is shared: it is not scoped to a
 * candidate, so a future multi-candidate setup compares like with like.
 *
 * `aliases` is what makes detection work on real CVs and real job postings,
 * which never agree on spelling.
 */
export const skill = production.table(
  "skill",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    slug: text("slug").notNull(),
    /** How it should be written when the system displays it. */
    canonicalName: text("canonical_name").notNull(),
    category: text("category").notNull(),
    /** Every spelling seen in the wild, as JSON. Drives detection. */
    aliases: json("aliases").notNull(),
    /** Set when a human vetted this catalogue entry — the admin audit hook. */
    verifiedAt: text("verified_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("skill_slug_idx").on(t.slug),
    index("skill_category_idx").on(t.category),
  ],
);

/**
 * A skill attributed to a candidate.
 *
 * Detection is automatic; **confirmation is not**. A row starts as `detected`
 * with the sentence from the CV that produced it, and a human promotes it to
 * `confirmed` or knocks it down to `rejected`. That distinction is the whole
 * point: the system may claim it *found* a skill, never that the candidate
 * *has* one.
 *
 * > **Invariante:** only `confirmed` skills may be cited as experience. This is
 * > rule 6 of CLAUDE.md expressed in the schema — a detector that reads
 * > "migrating away from Kafka" and lets an agent claim Kafka experience is
 * > exactly the failure mode this column prevents.
 */
export const candidateSkill = production.table(
  "candidate_skill",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidate.id, { onDelete: "cascade" }),
    skillId: integer("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("cv"),
    status: text("status").notNull().default("detected"),
    /** The sentence that produced the detection, so a human can judge it. */
    evidence: text("evidence"),
    /** Optional, and deliberately not inferred: only a human sets this. */
    level: text("level"),
    /** How many times it appears in the source document. */
    occurrences: integer("occurrences").notNull().default(1),
    detectedAt: text("detected_at").notNull().default(now),
    auditedAt: text("audited_at"),
    auditedBy: text("audited_by"),
  },
  (t) => [
    uniqueIndex("candidate_skill_unique_idx").on(t.candidateId, t.skillId),
    index("candidate_skill_status_idx").on(t.status),
  ],
);

/* -------------------------------------------------------------------------- */
/* Correspondence (ADR 0008)                                                   */
/* -------------------------------------------------------------------------- */

export const MAIL_KINDS = [
  "job_alert",          // LinkedIn/board alert listing openings
  "ats_received",       // "we received your application"
  "ats_screening",      // invitation to a screen or assessment
  "ats_interview",      // scheduling or interview confirmation
  "ats_rejection",      // "we decided to move forward with other candidates"
  "ats_offer",
  "recruiter_inbound",  // a human reaching out
  "unknown",
] as const;

export type MailKind = (typeof MAIL_KINDS)[number];

/**
 * An email the user received, parsed.
 *
 * Per ADR 0008 this is a SOURCING and EVIDENCE channel: the message is parsed
 * locally and never triggers an action on the platform that sent it.
 *
 * Note what this table does NOT have: a foreign key that lets a parsed email
 * mutate an application. Emails produce *suggestions* (see `mail_suggestion`);
 * only the user moves the funnel. That keeps ADR 0005 intact — ingestion of any
 * kind never overwrites a decision.
 */
export const mailMessage = production.table(
  "mail_message",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    /** RFC 5322 Message-ID; the natural dedupe key across re-imports. */
    messageId: text("message_id").notNull(),
    fromAddress: text("from_address"),
    fromName: text("from_name"),
    subject: text("subject"),
    receivedAt: text("received_at"),
    kind: text("kind").notNull().default("unknown"),
    /** linkedin | greenhouse | lever | ashby | workday | unknown */
    provider: text("provider"),
    /** Company inferred from the sender or body, when identifiable. */
    companyGuess: text("company_guess"),
    bodyText: text("body_text"),
    /** How many jobs were extracted, for job_alert messages. */
    extractedJobs: integer("extracted_jobs").notNull().default(0),
    importedAt: text("imported_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("mail_message_id_idx").on(t.messageId),
    index("mail_kind_idx").on(t.kind),
    index("mail_received_idx").on(t.receivedAt),
  ],
);

/**
 * A funnel change an email implies, awaiting the user's confirmation.
 *
 * > **Invariante:** parsing email never writes to `application`. It writes here,
 * > and the user accepts or dismisses. An automated rejection parser that is
 * > wrong once and silently archives a live opportunity is worse than no parser.
 */
export const mailSuggestion = production.table(
  "mail_suggestion",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    mailId: integer("mail_id")
      .notNull()
      .references(() => mailMessage.id, { onDelete: "cascade" }),
    /** Null when we could not match the email to a tracked application. */
    applicationId: integer("application_id").references(() => application.id, {
      onDelete: "cascade",
    }),
    jobId: integer("job_id").references(() => job.id, { onDelete: "cascade" }),
    suggestedStatus: text("suggested_status"),
    /** Why we think so — shown to the user before they accept. */
    rationale: text("rationale"),
    /** 0..1, from how unambiguous the signal was. */
    confidence: doublePrecision("confidence").notNull().default(0),
    status: text("status").notNull().default("pending"), // pending | accepted | dismissed
    decidedAt: text("decided_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("mail_suggestion_status_idx").on(t.status)],
);

/* -------------------------------------------------------------------------- */
/* Foreign exchange                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Cached exchange rates.
 *
 * Rates are stored rather than fetched per score for two reasons: the scorer
 * must stay pure and offline, and a score has to remain reproducible — knowing
 * only that a job "was above the floor" is useless without the rate that made
 * it so.
 */
export const fxRate = production.table(
  "fx_rate",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    /** Quote date as published by the provider, not the fetch time. */
    date: text("date").notNull(),
    base: text("base").notNull(),
    currency: text("currency").notNull(),
    /** 1 unit of `base` buys `rate` units of `currency`. */
    rate: doublePrecision("rate").notNull(),
    provider: text("provider").notNull(), // frankfurter | erapi | manual
    fetchedAt: text("fetched_at").notNull().default(now),
  },
  (t) => [uniqueIndex("fx_rate_unique_idx").on(t.date, t.base, t.currency)],
);

/* -------------------------------------------------------------------------- */
/* Inferred types                                                              */
/* -------------------------------------------------------------------------- */

export type Source = typeof source.$inferSelect;
export type NewSource = typeof source.$inferInsert;
export type Job = typeof job.$inferSelect;
export type NewJob = typeof job.$inferInsert;
export type JobScore = typeof jobScore.$inferSelect;
export type Application = typeof application.$inferSelect;
export type Post = typeof post.$inferSelect;
export type Engagement = typeof engagement.$inferSelect;
export type PositioningTask = typeof positioningTask.$inferSelect;
export type FxRate = typeof fxRate.$inferSelect;
export type Skill = typeof skill.$inferSelect;
export type NewSkill = typeof skill.$inferInsert;
export type CandidateSkill = typeof candidateSkill.$inferSelect;
export type Candidate = typeof candidate.$inferSelect;
export type NewCandidate = typeof candidate.$inferInsert;
export type CandidateDocument = typeof candidateDocument.$inferSelect;
export type MailMessage = typeof mailMessage.$inferSelect;
export type NewMailMessage = typeof mailMessage.$inferInsert;
export type MailSuggestion = typeof mailSuggestion.$inferSelect;
export type NewPositioningTask = typeof positioningTask.$inferInsert;
export type NewTargetAccount = typeof targetAccount.$inferInsert;
export type MetricSnapshot = typeof metricSnapshot.$inferSelect;

/* -------------------------------------------------------------------------- */
/* Scraping queue                                                             */
/* -------------------------------------------------------------------------- */

// Compatibility exports: queue state belongs to the pure scrape domain, not
// to its current Drizzle representation.
export { SCRAPE_STATUSES } from "../scrape/domain/status.ts";
export type { ScrapeStatus } from "../scrape/domain/status.ts";

/**
 * One unit of scraping work.
 *
 * The pipeline is split in two on purpose — `fetching` then `parsing` — because
 * the two halves fail for unrelated reasons and cost unrelated amounts. Fetching
 * is slow, rate-limited and can be refused by the site; parsing is free, offline
 * and improves every time the extractor gets smarter. Keeping them apart means a
 * better parser reprocesses the whole corpus without re-downloading a byte, and
 * a site that blocks us never costs us the pages we already have.
 */
export const scrapeTask = production.table(
  "scrape_task",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    jobId: integer("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    status: text("status").notNull().default("pending"),
    /** Higher runs first. Derived from fit, so good jobs get pages first. */
    priority: doublePrecision("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Set while a worker holds the task; lets a crashed claim be reclaimed. */
    claimedAt: text("claimed_at"),
    claimedBy: text("claimed_by"),
    /** Backoff: not eligible for claim before this. */
    runAfter: text("run_after"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("scrape_task_job_idx").on(t.jobId),
    index("scrape_task_claim_idx").on(t.status, t.priority),
  ],
);

/**
 * The captured page, stored verbatim.
 *
 * Raw HTML is kept rather than only the extracted text because extraction is a
 * guess that gets better: keeping the source means a parser fix is a reprocess,
 * not a re-crawl. This is also what makes the job description available offline.
 */
/**
 * Fila de verificação de vaga viva.
 *
 * Tabela separada de `scrape_task` porque o ciclo de vida é outro. A captura de
 * página acontece uma vez por vaga — daí o índice único por `job_id` lá. Já a
 * verificação **se repete**: a mesma vaga é reconferida semanas depois, e
 * `closed_at` pode voltar a null se ela reabrir. Reaproveitar aquela tabela
 * significaria escolher entre perder o histórico de capturas ou aceitar duas
 * semânticas na mesma coluna de status.
 *
 * O índice único por `job_id` aqui existe por outro motivo: impedir que clicar
 * três vezes no botão enfileire a mesma vaga três vezes.
 */
/**
 * Fila de repontuação por candidato.
 *
 * Existe porque salvar um currículo muda o que o ranking deveria dizer, e
 * recalcular na hora não cabe no pedido: são milhares de gravações, e quem
 * acabou de colar o CV ficaria olhando um formulário travado. A tela responde na
 * hora e o trabalho acontece depois.
 *
 * Tabela, e não broker — ADR 0009, mesma decisão de `verify_task` e
 * `scrape_task`. Um processo, um banco, e o estado da fila visível por `select`.
 *
 * **Índice único por candidato.** Salvar o currículo três vezes em dois minutos
 * é comum — corrigir um erro de digitação, colar de novo, ajustar uma linha. Sem
 * o índice, seriam três repontuações completas do acervo para produzir o mesmo
 * resultado. Com ele, o segundo pedido atualiza o que já está pendente.
 */
export const scoreTask = production.table(
  "score_task",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidate.id, { onDelete: "cascade" }),
    /** pending | scoring | done | failed */
    status: text("status").notNull().default("pending"),
    /**
     * `cv` | `perfil` | `periodic` — o que pediu.
     *
     * Currículo salvo é pedido de gente esperando resultado; a varredura diária
     * não é. A ordem da fila usa isto.
     */
    origin: text("origin").notNull().default("cv"),
    /** Maior roda antes. Pedido de usuário entra acima da varredura. */
    priority: doublePrecision("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Quantas vagas a última execução pontuou. Para a tela poder dizer. */
    scored: integer("scored"),
    claimedAt: text("claimed_at"),
    claimedBy: text("claimed_by"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("score_task_candidate_idx").on(t.candidateId),
    index("score_task_claim_idx").on(t.status, t.priority),
  ],
);

export type ScoreTask = typeof scoreTask.$inferSelect;
export type ScoreTaskStatus = "pending" | "scoring" | "done" | "failed";

export const verifyTask = production.table(
  "verify_task",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    jobId: integer("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** pending | checking | done | failed */
    status: text("status").notNull().default("pending"),
    /** Maior roda antes. O pedido do usuário entra acima da varredura. */
    priority: doublePrecision("priority").notNull().default(0),
    /** `user` | `periodic` — de onde veio o pedido, para a interface avisar. */
    origin: text("origin").notNull().default("periodic"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    claimedAt: text("claimed_at"),
    claimedBy: text("claimed_by"),
    runAfter: text("run_after"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("verify_task_job_idx").on(t.jobId),
    index("verify_task_claim_idx").on(t.status, t.priority),
  ],
);

export type VerifyTask = typeof verifyTask.$inferSelect;
export type VerifyStatus = "pending" | "checking" | "done" | "failed";

/**
 * Cada veredito de verificação de uma vaga (#223, tarefa 04).
 *
 * `job.check_status` guarda só o último; o evento guarda todos, e é o que deixa
 * uma reabertura sem apagar o fechamento anterior. Evento e estado da vaga
 * mudam na mesma transação (`applyVerdict`). `reason` só é diferente de
 * `unknown` com evidência: hoje, apenas `closed` por 404/410 (G26).
 */
export const jobCheckEvent = production.table(
  "job_check_event",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    // A retenção só apaga vaga sem candidatura, e o evento sem a vaga não diz nada.
    jobId: integer("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    runId: integer("run_id").references(() => sourceRun.id, { onDelete: "set null" }),
    checkedAt: text("checked_at").notNull(),
    /** `alive` | `gone` | `inconclusive` (`ProbeVerdict`). */
    verdict: text("verdict").notNull(),
    httpCode: integer("http_code"),
    /** `closed` | `unknown` hoje; `filled`/`cancelled`/`paused` só com evidência de adapter. */
    reason: text("reason").notNull(),
    /** Até 280 caracteres, redigido (`redactDetail`). */
    evidence: text("evidence"),
  },
  (t) => [index("job_check_event_job_idx").on(t.jobId, t.checkedAt)],
);

/**
 * Reserva de uma unidade da varredura fatiada (ADR 0025).
 *
 * `key` nomeia a unidade — `sync:<fonte>`, `pontuar:<candidato>`, `alarme:<nome>`.
 * A reserva é um upsert condicional: só vence quem encontra a linha livre ou
 * com a reserva vencida, então duas chamadas simultâneas da Vercel nunca
 * sincronizam a mesma fonte.
 *
 * `last_claimed_at` não é limpo ao liberar, de propósito: uma fonte cuja função
 * foi morta no meio nunca chega a `last_finished_at`, e é a tentativa que a
 * manda para o fim da fila — sem isso ela seria a primeira de toda chamada e
 * mataria todas.
 */
export const sweepLease = production.table("sweep_lease", {
  key: text("key").primaryKey(),
  claimedAt: text("claimed_at"),
  claimedBy: text("claimed_by"),
  lastClaimedAt: text("last_claimed_at"),
  lastFinishedAt: text("last_finished_at"),
});

/**
 * Uma execução da varredura fatiada: a métrica que prova a cadência.
 *
 * Uma linha por chamada (`unit` nulo) e uma por unidade processada dentro dela
 * (`unit` = fonte ou candidato). Só números e identificadores de fonte ou de
 * candidato — título, URL e texto de vaga nunca entram aqui.
 */
export const sweepRun = production.table(
  "sweep_run",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    slice: text("slice").notNull(),
    unit: text("unit"),
    startedAt: text("started_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    items: integer("items").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    error: text("error"),
  },
  (t) => [index("sweep_run_slice_started_idx").on(t.slice, t.startedAt)],
);

/**
 * Uma execução de captura ou de verificação (#223): escopo, quem pediu, o
 * retrato da configuração, contagens e erro limitado.
 *
 * Linha terminal é imutável — toda escrita de progresso filtra `status in
 * ('queued','running')`, e nova tentativa é outra linha (`retry_of`).
 * Contagem nula é "desconhecido", nunca zero. A captura por termo continua em
 * `term_capture` (A2/A3).
 */
export const sourceRun = production.table(
  "source_run",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    /** `source` | `all` | `verify`. */
    scopeKind: text("scope_kind").notNull(),
    // Fonte não é apagada, é aposentada: `restrict` torna isso explícito.
    sourceId: text("source_id").references(() => source.id, { onDelete: "restrict" }),
    parentId: integer("parent_id").references((): AnyPgColumn => sourceRun.id, { onDelete: "restrict" }),
    retryOf: integer("retry_of").references((): AnyPgColumn => sourceRun.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    /** Nulo = agendador. */
    actorUserId: integer("actor_user_id").references(() => authUser.id, { onDelete: "set null" }),
    /** kind, handle, revisão e capacidades no momento do pedido. Nunca segredo. */
    configSnapshot: jsonb("config_snapshot").notNull(),
    status: text("status").notNull(),
    heartbeatAt: text("heartbeat_at"),
    queuedAt: text("queued_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    fetched: integer("fetched"),
    inserted: integer("inserted"),
    updated: integer("updated"),
    unchanged: integer("unchanged"),
    closed: integer("closed"),
    /** Verificação: links vivos. Nulo em execução de captura. */
    alive: integer("alive"),
    inconclusive: integer("inconclusive"),
    /** O que o adapter declarou (`SourceSnapshot.completeness`). */
    completeness: text("completeness"),
    /** Código estável; em `queued`, o motivo da espera (ex.: `no_token`). */
    errorCode: text("error_code"),
    /** No máximo 500 caracteres, redigido (`redactDetail`). */
    errorDetail: text("error_detail"),
  },
  (t) => [
    uniqueIndex("source_run_active_key_idx")
      .on(t.idempotencyKey)
      .where(sql`${t.status} in ('queued', 'running')`),
    index("source_run_queued_idx").on(t.queuedAt),
    index("source_run_parent_idx").on(t.parentId),
    index("source_run_source_idx").on(t.sourceId),
  ],
);

/**
 * Orçamento diário de requisições a terceiros, por rotina (#291).
 *
 * Uma linha por (rotina, dia UTC). A CLI no GitHub Actions, a fatia da Vercel
 * e o botão da tela gastam do MESMO contador — é isso que o torna
 * compartilhado. A reserva é um upsert condicional; ler antes e gravar depois
 * deixaria dois processos verem "sobra 1" ao mesmo tempo. `used` é também a
 * telemetria: quantas requisições cada rotina fez por dia. Só números.
 */
export const requestBudget = production.table(
  "request_budget",
  {
    routine: text("routine").notNull(),
    /** UTC `YYYY-MM-DD`. */
    day: text("day").notNull(),
    used: integer("used").notNull().default(0),
    /** Pedidos recusados por orçamento esgotado, para a telemetria. */
    refused: integer("refused").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.routine, t.day], name: "request_budget_pk" })],
);

export const jobPage = production.table(
  "job_page",
  {
    jobId: integer("job_id")
      .primaryKey()
      .references(() => job.id, { onDelete: "cascade" }),
    /** Final URL after redirects — not always the one we asked for. */
    finalUrl: text("final_url").notNull(),
    httpStatus: integer("http_status").notNull(),
    html: text("html"),
    /** Extracted, readable description. Null until the parser has run. */
    text: text("text"),
    /** Structured fields the parser recovered, as JSON. */
    extracted: json("extracted"),
    contentHash: text("content_hash").notNull(),
    bytes: integer("bytes").notNull().default(0),
    fetchedAt: text("fetched_at").notNull().default(now),
    parsedAt: text("parsed_at"),
  },
  (t) => [
    index("job_page_parsed_idx").on(t.parsedAt),
    // A descrição capturada substitui a da fonte na busca por termo; mesmo
    // pré-filtro de `job_description_trgm_idx`.
    index("job_page_text_trgm_idx").using("gin", sql`${withoutSeparators(t.text)} gin_trgm_ops`),
  ],
);

export type ScrapeTask = typeof scrapeTask.$inferSelect;
export type JobPage = typeof jobPage.$inferSelect;

/* -------------------------------------------------------------------------- */
/* LLM providers and models (BYOK, administered)                              */
/* -------------------------------------------------------------------------- */

export const LLM_KINDS = ["anthropic", "openai", "compatible"] as const;
export type LlmKind = (typeof LLM_KINDS)[number];

/** Reasoning effort, where the model supports it. */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * A configured provider.
 *
 * The one thing this table deliberately does NOT hold is the API key. It holds
 * the NAME of the environment variable to read it from. That keeps BYOK a real
 * promise rather than a slogan: the key lives in the user's `.env`, never in a
 * database file that gets copied, backed up, or opened by another process.
 *
 * `kind` selects the wire protocol, not the vendor — "compatible" covers every
 * service that speaks the OpenAI shape (Groq, Together, OpenRouter, Ollama),
 * which is most of them.
 */
export const llmProvider = production.table(
  "llm_provider",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    kind: text("kind").notNull(),
    /** Override for a self-hosted or proxy endpoint. Null means the default. */
    baseUrl: text("base_url"),
    /** Name of the env var holding the key — never the key itself. */
    apiKeyEnv: text("api_key_env").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("llm_provider_slug_idx").on(t.slug)],
);

/**
 * A model offered by a provider.
 *
 * Cost per million tokens is stored because with BYOK the user pays directly,
 * and a number they can see before a call is the difference between an informed
 * choice and a surprise invoice.
 */
export const llmModel = production.table(
  "llm_model",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => llmProvider.id, { onDelete: "cascade" }),
    /** The identifier the API expects, e.g. "claude-sonnet-5". */
    modelId: text("model_id").notNull(),
    label: text("label").notNull(),
    /** Whether the model exposes a reasoning/effort control at all. */
    supportsReasoning: boolean("supports_reasoning").notNull().default(false),
    /** low | medium | high | xhigh | max. Null when unsupported. */
    defaultEffort: text("default_effort"),
    maxOutputTokens: integer("max_output_tokens").notNull().default(4096),
    inputCostPerMTok: doublePrecision("input_cost_per_mtok"),
    outputCostPerMTok: doublePrecision("output_cost_per_mtok"),
    enabled: boolean("enabled").notNull().default(true),
    /** Exactly one model should carry this; the resolver enforces it. */
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("llm_model_unique_idx").on(t.providerId, t.modelId),
    index("llm_model_default_idx").on(t.isDefault),
  ],
);

export type LlmProvider = typeof llmProvider.$inferSelect;
export type LlmModel = typeof llmModel.$inferSelect;

/**
 * Análise estruturada da VAGA (#223, tarefa 06): uma linha por tentativa,
 * imutável depois de terminal. Nova tentativa é linha nova ligada por
 * `retry_of`; a original não muda. Fila em tabela (ADR 0009), processada pela
 * CLI — nunca pela requisição da Vercel.
 *
 * Nunca guarda a chave nem o corpo da resposta do provedor (G41): `result` é a
 * estrutura já conferida contra a evidência, e o erro é só um código.
 */
export const jobAnalysis = production.table(
  "job_analysis",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    // A retenção só apaga vaga sem candidatura, e a análise não vale sem a vaga.
    jobId: integer("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    // Quem pediu sai, a análise da vaga fica.
    requestedBy: integer("requested_by").references(() => authUser.id, { onDelete: "set null" }),
    /**
     * Tentativa anterior do mesmo texto. `no action`, não `restrict`: os dois
     * impedem apagar a original sozinha, mas `restrict` confere na hora e faria
     * a retenção falhar ao apagar em cascata uma vaga com duas tentativas; `no
     * action` confere no fim do comando, quando as duas já saíram juntas.
     */
    retryOf: integer("retry_of"),
    /** queued | running | succeeded | partial | failed | paused_quota | interrupted */
    status: text("status").notNull().default("queued"),
    /** SHA-256 do texto normalizado enviado; diferente do atual = "a vaga mudou". */
    inputHash: text("input_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    providerSlug: text("provider_slug"),
    modelId: text("model_id"),
    result: json("result"),
    errorCode: text("error_code"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costEstimate: doublePrecision("cost_estimate"),
    claimedAt: text("claimed_at"),
    heartbeatAt: text("heartbeat_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    foreignKey({ columns: [t.retryOf], foreignColumns: [t.id], name: "job_analysis_retry_of_fk" }).onDelete("no action"),
    // Idempotência: um pedido ativo por texto e versão. Clique duplo e corrida
    // de processos batem aqui, não numa leitura antes de gravar.
    uniqueIndex("job_analysis_active_idx")
      .on(t.jobId, t.inputHash, t.schemaVersion)
      .where(sql`${t.status} in ('queued', 'running')`),
    index("job_analysis_job_idx").on(t.jobId, t.id),
    index("job_analysis_claim_idx").on(t.status, t.id),
  ],
);

export type JobAnalysisRow = typeof jobAnalysis.$inferSelect;

/* -------------------------------------------------------------------------- */
/* Authentication (AUTH-01)                                                   */
/* -------------------------------------------------------------------------- */

export const authUser = production.table(
  "auth_user",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    email: text("email").notNull(),
    /**
     * Nome de quem usa a conta, como a pessoa escreve o próprio nome.
     *
     * Nulo é um estado real, não um defeito: toda conta criada antes desta
     * coluna existir tem nulo aqui, e o primeiro acesso de uma conta nova
     * também. Quem exibe cai para o e-mail nesse caso — ver `session-badge`.
     * Por isso a coluna é anulável em vez de `not null default ''`: string
     * vazia mentiria dizendo que alguém preencheu.
     */
    fullName: text("full_name"),
    /** JSON array of roles: admin | candidate | recruiter. */
    roles: json("roles").notNull(),
    /**
     * scrypt hash, as `scrypt$N$r$p$salt$hash`. Null when the account uses
     * only magic links — both methods are supported and neither is required.
     */
    passwordHash: text("password_hash"),
    /** The candidate this account acts for. Null for an admin-only account. */
    candidateId: integer("candidate_id").references(() => candidate.id, { onDelete: "set null" }),
    disabledAt: text("disabled_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("auth_user_email_idx").on(t.email),
    // Um candidato, no máximo uma conta. Duas contas no mesmo candidato leem e
    // escrevem o currículo, a visibilidade e o funil uma da outra — foi o
    // vazamento da v1.20.5, em que uma conta semeada pelo e2e apontava para o
    // candidato do dono. Parcial só para deixar fora do índice as contas sem
    // candidato (admin, recrutador). A migração 0009 falha se já houver
    // duplicata: limpe antes (docs/security.md, achado 5).
    uniqueIndex("auth_user_candidate_idx")
      .on(t.candidateId)
      .where(sql`${t.candidateId} is not null`),
  ],
);

/**
 * A live session.
 *
 * `tokenHash` — never the token. The cookie holds a secret; this table holds
 * proof that a secret was issued. Storing the token itself would mean a copy of
 * the database is a copy of every user's credentials, which is the same
 * reasoning that keeps API keys out (regra 13).
 */
export const authSession = production.table(
  "auth_session",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    tokenHash: text("token_hash").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    /**
     * O admin que assumiu esta identidade, quando é o caso.
     *
     * Presente = sessão emprestada. `policy.ts` nega toda ação de administração
     * quando isto não é nulo, sem consultar papel — porque o alvo pode ser
     * outro admin.
     */
    impersonatedBy: integer("impersonated_by").references(() => authUser.id, {
      onDelete: "cascade",
    }),
    /** Set on logout. Kept rather than deleted, so the audit trail survives. */
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("auth_session_token_idx").on(t.tokenHash),
    index("auth_session_user_idx").on(t.userId),
  ],
);

/** Single-use magic link. Hashed for the same reason as a session token. */
/**
 * Quem um recrutador acompanha.
 *
 * O recrutador lê CV e funil apenas de candidatos vinculados a ele. O vínculo
 * mora aqui e é resolvido na carga da sessão, para `policy.ts` continuar
 * derivando posse da sessão e nunca de um id que o chamador mandou.
 */
export const recruiterCandidate = production.table(
  "recruiter_candidate",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    recruiterUserId: integer("recruiter_user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidate.id, { onDelete: "cascade" }),
    /** Quem criou o vínculo. Admin ou o próprio candidato. */
    createdBy: integer("created_by").references(() => authUser.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("recruiter_candidate_idx").on(t.recruiterUserId, t.candidateId),
    index("recruiter_candidate_candidate_idx").on(t.candidateId),
  ],
);

export type RecruiterCandidate = typeof recruiterCandidate.$inferSelect;

export const authLoginToken = production.table(
  "auth_login_token",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    tokenHash: text("token_hash").notNull(),
    email: text("email").notNull(),
    /**
     * `login` (padrão) ou `reset`.
     *
     * A mesma tabela serve aos dois porque a mecânica é idêntica: um segredo de
     * uso único com validade. O que MUDA é o que o resgate faz — um abre sessão,
     * o outro autoriza definir senha —, e por isso o propósito precisa estar
     * gravado: sem ele, um token de recuperação aceito no caminho de login viraria
     * uma entrada sem senha, e um token de login aceito no caminho de recuperação
     * deixaria trocar a senha de quem só pediu para entrar.
     */
    purpose: text("purpose").notNull().default("login"),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("auth_login_token_idx").on(t.tokenHash)],
);

export const AUTH_EVENTS = [
  "login",
  "login_failed",
  "logout",
  "session_expired",
  "denied",
  "role_changed",
] as const;

/** Audit trail. Never records a token, a cookie or a key. */
export const authEvent = production.table(
  "auth_event",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id").references(() => authUser.id, { onDelete: "set null" }),
    email: text("email"),
    kind: text("kind").notNull(),
    detail: text("detail"),
    at: text("at").notNull().default(now),
  },
  (t) => [index("auth_event_at_idx").on(t.at)],
);

export type AuthUser = typeof authUser.$inferSelect;
export type AuthSession = typeof authSession.$inferSelect;

/* -------------------------------------------------------------------------- */
/* Term captures (sourcing)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One term search on one platform on one UTC day — queue row and run record.
 *
 * The unique key is what makes one call serve everyone who saved the term:
 * the same normalized term is fetched at most once per platform per day
 * (ADR-004, ADR-007). The row never names a candidate.
 */
export const termCapture = production.table(
  "term_capture",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    /** Source kind of the platform searched. */
    platform: text("platform").notNull(),
    termKey: text("term_key").notNull(),
    /** Display form of the first request; what is sent to the platform. */
    query: text("query").notNull(),
    /** UTC `YYYY-MM-DD`. */
    windowDay: text("window_day").notNull(),
    /** web | sweep | cli */
    origin: text("origin").notNull(),
    /** queued | running | succeeded | waiting_quota | failed | skipped */
    status: text("status").notNull().default("queued"),
    reasonCode: text("reason_code"),
    priority: doublePrecision("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    /** Next window for `waiting_quota`. */
    runAfter: text("run_after"),
    /** Lease: a claim older than five minutes is reclaimable. */
    claimedAt: text("claimed_at"),
    claimedBy: text("claimed_by"),
    fetched: integer("fetched").notNull().default(0),
    created: integer("created").notNull().default(0),
    known: integer("known").notNull().default(0),
    attributed: integer("attributed").notNull().default(0),
    /** "100 of about N": what the platform said it had. */
    totalHint: integer("total_hint"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("term_capture_window_idx").on(t.platform, t.termKey, t.windowDay),
    index("term_capture_claim_idx").on(t.status, t.priority),
  ],
);

/**
 * A job that a term capture brought and that actually mentions the term.
 *
 * Decided at capture time, before observation discards the platform payload
 * (tags live only there). Keyed by term, never by candidate: who saved the
 * term stays in matching.
 */
export const termAttribution = production.table(
  "term_attribution",
  {
    termKey: text("term_key").notNull(),
    jobId: integer("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    attributedAt: text("attributed_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.termKey, t.jobId], name: "term_attribution_pk" }),
    index("term_attribution_job_idx").on(t.jobId),
  ],
);

/**
 * Durable per-platform call ledger (ADR-010).
 *
 * Every call to a budgeted platform reserves a unit here first — sync and term
 * captures alike — with one conditional upsert per window, so concurrent
 * workers on different runtimes can never spend past the platform's limit.
 */
export const platformQuota = production.table(
  "platform_quota",
  {
    platform: text("platform").notNull(),
    /** day | minute */
    windowKind: text("window_kind").notNull(),
    /** UTC `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`. */
    windowStart: text("window_start").notNull(),
    used: integer("used").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.platform, t.windowKind, t.windowStart],
      name: "platform_quota_pk",
    }),
  ],
);
