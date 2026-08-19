/**
 * Skills: a shared catalogue, and detection against a candidate's own words.
 *
 * The catalogue exists because the same capability is written a dozen ways —
 * "Node.js", "NodeJS", "node" — and without a canonical row nothing can be
 * counted, compared or audited. It is deliberately global rather than scoped to
 * a candidate, so a future multi-candidate setup compares like with like.
 *
 * > **Invariante:** detection produces `detected`, never `confirmed`. The system
 * > may claim it *found* a skill; only a human may claim the candidate *has*
 * > one. A detector that reads "migrating away from Kafka" and lets an agent
 * > cite Kafka experience is exactly the failure this separation prevents —
 * > rule 6 of CLAUDE.md, expressed in the schema.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "./db/client.ts";
import { candidateSkill, job, jobScore, skill, type SkillCategory } from "./db/schema.ts";

export type CatalogEntry = {
  slug: string;
  name: string;
  category: SkillCategory;
  aliases: string[];
};

/**
 * Aliases were chosen because they appear in this corpus or in the candidate's
 * CV, not because they are theoretically possible. Ambiguous short forms are
 * left out on purpose — "go" would fire on "going", so only "golang" is listed.
 */
export const SKILL_CATALOG: CatalogEntry[] = [
  { slug: "typescript", name: "TypeScript", category: "language", aliases: ["typescript"] },
  { slug: "javascript", name: "JavaScript", category: "language", aliases: ["javascript", "ecmascript"] },
  { slug: "python", name: "Python", category: "language", aliases: ["python"] },
  { slug: "go", name: "Go", category: "language", aliases: ["golang"] },
  { slug: "rust", name: "Rust", category: "language", aliases: ["rust"] },
  { slug: "php", name: "PHP", category: "language", aliases: ["php"] },
  { slug: "kotlin", name: "Kotlin", category: "language", aliases: ["kotlin"] },
  { slug: "swift", name: "Swift", category: "language", aliases: ["swift"] },
  { slug: "java", name: "Java", category: "language", aliases: ["java"] },
  { slug: "csharp", name: "C#", category: "language", aliases: ["c#", "csharp"] },
  { slug: "ruby", name: "Ruby", category: "language", aliases: ["ruby", "ruby on rails"] },
  { slug: "elixir", name: "Elixir", category: "language", aliases: ["elixir"] },

  { slug: "react", name: "React", category: "framework", aliases: ["react", "react.js", "reactjs"] },
  { slug: "nextjs", name: "Next.js", category: "framework", aliases: ["next.js", "nextjs"] },
  { slug: "nodejs", name: "Node.js", category: "framework", aliases: ["node.js", "nodejs"] },
  { slug: "vue", name: "Vue.js", category: "framework", aliases: ["vue", "vue.js", "vuejs"] },
  { slug: "angular", name: "Angular", category: "framework", aliases: ["angular", "angularjs"] },
  { slug: "fastapi", name: "FastAPI", category: "framework", aliases: ["fastapi"] },
  { slug: "django", name: "Django", category: "framework", aliases: ["django"] },
  { slug: "flask", name: "Flask", category: "framework", aliases: ["flask"] },
  { slug: "laravel", name: "Laravel", category: "framework", aliases: ["laravel", "jetstream", "nova"] },
  { slug: "nestjs", name: "NestJS", category: "framework", aliases: ["nest.js", "nestjs"] },
  { slug: "express", name: "Express", category: "framework", aliases: ["express.js", "expressjs"] },
  { slug: "codeigniter", name: "CodeIgniter", category: "framework", aliases: ["codeigniter"] },
  { slug: "react-native", name: "React Native", category: "framework", aliases: ["react native"] },
  { slug: "ionic", name: "Ionic", category: "framework", aliases: ["ionic"] },
  { slug: "electron", name: "Electron", category: "framework", aliases: ["electron"] },
  { slug: "tailwind", name: "Tailwind CSS", category: "framework", aliases: ["tailwind", "tailwindcss"] },
  { slug: "socketio", name: "Socket.IO", category: "framework", aliases: ["socket.io", "socketio", "websockets"] },

  { slug: "llm", name: "LLM", category: "ai", aliases: ["llm", "llms", "large language model"] },
  { slug: "rag", name: "RAG", category: "ai", aliases: ["rag", "retrieval augmented generation", "retrieval-augmented"] },
  { slug: "agentic", name: "Agentic AI", category: "ai", aliases: ["agentic", "ai agents", "agent orchestration"] },
  { slug: "multi-agent", name: "Multi-agent systems", category: "ai", aliases: ["multi-agent", "multi agent"] },
  { slug: "langchain", name: "LangChain", category: "ai", aliases: ["langchain"] },
  { slug: "langgraph", name: "LangGraph", category: "ai", aliases: ["langgraph"] },
  { slug: "langsmith", name: "LangSmith", category: "ai", aliases: ["langsmith"] },
  { slug: "evals", name: "Evals", category: "ai", aliases: ["evals", "golden dataset", "golden set", "evaluation framework"] },
  { slug: "guardrails", name: "Guardrails", category: "ai", aliases: ["guardrails", "guardrail"] },
  { slug: "llmops", name: "LLMOps", category: "ai", aliases: ["llmops"] },
  { slug: "prompt-engineering", name: "Prompt engineering", category: "ai", aliases: ["prompt engineering", "context engineering"] },
  { slug: "embeddings", name: "Embeddings", category: "ai", aliases: ["embeddings", "embedding model"] },
  { slug: "vector-db", name: "Vector databases", category: "ai", aliases: ["vector database", "vector db", "pinecone", "pgvector", "weaviate", "qdrant"] },
  { slug: "reranking", name: "Reranking", category: "ai", aliases: ["reranking", "re-ranking", "reranker"] },
  { slug: "fine-tuning", name: "Fine-tuning", category: "ai", aliases: ["fine-tuning", "fine tuning", "finetuning"] },
  { slug: "tool-calling", name: "Tool calling", category: "ai", aliases: ["tool calling", "function calling", "tool use"] },
  { slug: "pytorch", name: "PyTorch", category: "ai", aliases: ["pytorch"] },
  { slug: "tensorflow", name: "TensorFlow", category: "ai", aliases: ["tensorflow", "keras"] },
  { slug: "openai", name: "OpenAI", category: "ai", aliases: ["openai"] },
  { slug: "anthropic", name: "Anthropic", category: "ai", aliases: ["anthropic"] },
  { slug: "huggingface", name: "Hugging Face", category: "ai", aliases: ["hugging face", "huggingface"] },
  { slug: "mlflow", name: "MLflow", category: "ai", aliases: ["mlflow"] },
  { slug: "nlp", name: "NLP", category: "ai", aliases: ["nlp", "natural language processing", "spacy", "nltk", "bert", "transformers"] },

  { slug: "aws", name: "AWS", category: "cloud", aliases: ["aws", "amazon web services", "aws lambda"] },
  { slug: "gcp", name: "GCP", category: "cloud", aliases: ["gcp", "google cloud"] },
  { slug: "azure", name: "Azure", category: "cloud", aliases: ["azure"] },
  { slug: "kubernetes", name: "Kubernetes", category: "cloud", aliases: ["kubernetes", "k8s"] },
  { slug: "docker", name: "Docker", category: "cloud", aliases: ["docker"] },
  { slug: "terraform", name: "Terraform", category: "cloud", aliases: ["terraform"] },
  { slug: "ansible", name: "Ansible", category: "cloud", aliases: ["ansible"] },
  { slug: "serverless", name: "Serverless", category: "cloud", aliases: ["serverless"] },

  { slug: "postgres", name: "PostgreSQL", category: "data", aliases: ["postgres", "postgresql"] },
  { slug: "mysql", name: "MySQL", category: "data", aliases: ["mysql", "mariadb"] },
  { slug: "mongodb", name: "MongoDB", category: "data", aliases: ["mongodb"] },
  { slug: "redis", name: "Redis", category: "data", aliases: ["redis"] },
  { slug: "sqlserver", name: "SQL Server", category: "data", aliases: ["sql server"] },
  { slug: "couchbase", name: "Couchbase", category: "data", aliases: ["couchbase"] },
  { slug: "dynamodb", name: "DynamoDB", category: "data", aliases: ["dynamodb"] },
  { slug: "sqlite", name: "SQLite", category: "data", aliases: ["sqlite", "libsql"] },
  { slug: "kafka", name: "Kafka", category: "data", aliases: ["kafka"] },
  { slug: "etl", name: "ETL", category: "data", aliases: ["etl", "data pipeline", "data pipelines"] },
  { slug: "bi", name: "Business Intelligence", category: "data", aliases: ["business intelligence"] },
  { slug: "data-governance", name: "Data governance", category: "data", aliases: ["data governance", "data quality"] },

  { slug: "architecture", name: "Software architecture", category: "practice", aliases: ["software architecture", "solution architecture"] },
  { slug: "distributed-systems", name: "Distributed systems", category: "practice", aliases: ["distributed systems", "distributed system"] },
  { slug: "system-design", name: "System design", category: "practice", aliases: ["system design"] },
  { slug: "microservices", name: "Microservices", category: "practice", aliases: ["microservices", "microservice"] },
  { slug: "event-driven", name: "Event-driven architecture", category: "practice", aliases: ["event-driven", "event driven", "event sourcing"] },
  { slug: "multi-tenant", name: "Multi-tenancy", category: "practice", aliases: ["multi-tenant", "multitenant", "multi-tenancy"] },
  { slug: "observability", name: "Observability", category: "practice", aliases: ["observability", "datadog", "opentelemetry", "rollbar"] },
  { slug: "cicd", name: "CI/CD", category: "practice", aliases: ["ci/cd", "cicd", "continuous integration", "github actions", "jenkins"] },
  { slug: "tdd", name: "TDD", category: "practice", aliases: ["tdd", "test-driven", "test driven"] },
  { slug: "ddd", name: "DDD", category: "practice", aliases: ["domain-driven", "domain driven"] },
  { slug: "sdd", name: "Spec-Driven Development", category: "practice", aliases: ["spec-driven development"] },
  { slug: "legacy-modernization", name: "Legacy modernization", category: "practice", aliases: ["legacy modernization", "modernization", "modernizing"] },
  { slug: "security", name: "Security", category: "practice", aliases: ["owasp", "devsecops", "threat modeling", "sonarqube", "snyk"] },
  { slug: "performance", name: "Performance engineering", category: "practice", aliases: ["performance optimization", "cost optimization"] },
  { slug: "api-design", name: "API design", category: "practice", aliases: ["api design", "rest api", "graphql", "grpc"] },
  { slug: "testing", name: "Test automation", category: "practice", aliases: ["playwright", "cypress", "phpunit", "vitest", "test automation", "qa automation"] },
  { slug: "agile", name: "Agile", category: "practice", aliases: ["agile", "scrum", "kanban"] },

  { slug: "fintech", name: "Fintech", category: "domain", aliases: ["fintech", "financial services"] },
  { slug: "healthcare", name: "Healthcare", category: "domain", aliases: ["healthcare", "healthtech", "clinics"] },
  { slug: "ecommerce", name: "E-commerce", category: "domain", aliases: ["e-commerce", "ecommerce", "magento"] },
  { slug: "erp", name: "ERP", category: "domain", aliases: ["erp"] },
  { slug: "gaming", name: "Gaming", category: "domain", aliases: ["casino games", "game engineer"] },
  { slug: "saas", name: "SaaS", category: "domain", aliases: ["saas"] },
  { slug: "pos", name: "POS", category: "domain", aliases: ["point of sale"] },

  { slug: "tech-leadership", name: "Technical leadership", category: "soft", aliases: ["technical leadership", "tech lead", "engineering lead"] },
  { slug: "mentoring", name: "Mentoring", category: "soft", aliases: ["mentoring", "mentor", "coaching"] },
  { slug: "stakeholder", name: "Stakeholder management", category: "soft", aliases: ["stakeholder", "stakeholders", "cross-functional"] },
  { slug: "english", name: "English (fluent)", category: "soft", aliases: ["english"] },
];

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                   */
/* -------------------------------------------------------------------------- */

export async function seedCatalog(): Promise<{ inserted: number; updated: number }> {
  const db = getDb();
  let inserted = 0;
  let updated = 0;

  for (const entry of SKILL_CATALOG) {
    const existing = await db
      .select({ id: skill.id })
      .from(skill)
      .where(eq(skill.slug, entry.slug))
      .limit(1);

    if (existing[0]) {
      // Refresh name, category and aliases; never touch verifiedAt — that is
      // the admin's mark and a reseed must not silently clear it.
      await db
        .update(skill)
        .set({ canonicalName: entry.name, category: entry.category, aliases: entry.aliases })
        .where(eq(skill.id, existing[0].id));
      updated++;
    } else {
      await db.insert(skill).values({
        slug: entry.slug,
        canonicalName: entry.name,
        category: entry.category,
        aliases: entry.aliases,
      });
      inserted++;
    }
  }
  return { inserted, updated };
}

export async function listCatalog(category?: string) {
  const db = getDb();
  const rows = await db.select().from(skill).orderBy(skill.category, skill.canonicalName);
  return category ? rows.filter((r) => r.category === category) : rows;
}

/* -------------------------------------------------------------------------- */
/* Detection                                                                   */
/* -------------------------------------------------------------------------- */

/** Word-boundary aware, so "go" never fires inside "going". */
function findAll(haystack: string, term: string): number[] {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#]|$)`, "gi");
  const positions: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) {
    positions.push(m.index);
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return positions;
}

/** The sentence around a hit, so a human can judge the detection. */
function sentenceAround(text: string, at: number): string {
  const start = Math.max(0, text.lastIndexOf("\n", at) + 1);
  const nl = text.indexOf("\n", at);
  const end = nl === -1 ? Math.min(text.length, at + 200) : nl;
  return text.slice(start, end).trim().slice(0, 240);
}

export type Detection = {
  skillId: number;
  slug: string;
  name: string;
  category: string;
  occurrences: number;
  evidence: string;
  matchedAlias: string;
};

export async function detectSkills(text: string): Promise<Detection[]> {
  const db = getDb();
  const catalog = await db.select().from(skill);
  const found: Detection[] = [];

  for (const s of catalog) {
    const aliases = (s.aliases as string[]) ?? [];
    let total = 0;
    let firstAt = -1;
    let matched = "";

    for (const alias of [s.canonicalName.toLowerCase(), ...aliases]) {
      const hits = findAll(text, alias);
      if (hits.length > 0) {
        total += hits.length;
        if (firstAt === -1) {
          firstAt = hits[0]!;
          matched = alias;
        }
      }
    }

    if (total > 0) {
      found.push({
        skillId: s.id,
        slug: s.slug,
        name: s.canonicalName,
        category: s.category,
        occurrences: total,
        evidence: sentenceAround(text, firstAt),
        matchedAlias: matched,
      });
    }
  }

  return found.sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * Persist detections for a candidate.
 *
 * Rows already audited are left untouched: re-running detection must never undo
 * a human decision. Only the occurrence count and evidence are refreshed.
 */
export async function syncDetectedSkills(
  candidateId: number,
  text: string,
  source = "cv",
): Promise<{ added: number; refreshed: number; preserved: number }> {
  const db = getDb();
  const detections = await detectSkills(text);

  let added = 0;
  let refreshed = 0;
  let preserved = 0;

  for (const d of detections) {
    const existing = await db
      .select({ id: candidateSkill.id, status: candidateSkill.status })
      .from(candidateSkill)
      .where(
        and(eq(candidateSkill.candidateId, candidateId), eq(candidateSkill.skillId, d.skillId)),
      )
      .limit(1);

    const row = existing[0];
    if (!row) {
      await db.insert(candidateSkill).values({
        candidateId,
        skillId: d.skillId,
        source,
        status: "detected",
        evidence: d.evidence,
        occurrences: d.occurrences,
      });
      added++;
    } else if (row.status === "detected") {
      await db
        .update(candidateSkill)
        .set({ evidence: d.evidence, occurrences: d.occurrences })
        .where(eq(candidateSkill.id, row.id));
      refreshed++;
    } else {
      // confirmed or rejected — a human decided; leave it alone.
      preserved++;
    }
  }

  return { added, refreshed, preserved };
}

export async function candidateSkills(candidateId: number, status?: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: candidateSkill.id,
      slug: skill.slug,
      name: skill.canonicalName,
      category: skill.category,
      status: candidateSkill.status,
      source: candidateSkill.source,
      evidence: candidateSkill.evidence,
      occurrences: candidateSkill.occurrences,
      level: candidateSkill.level,
      auditedAt: candidateSkill.auditedAt,
    })
    .from(candidateSkill)
    .innerJoin(skill, eq(skill.id, candidateSkill.skillId))
    .where(eq(candidateSkill.candidateId, candidateId))
    .orderBy(desc(candidateSkill.occurrences));

  return status ? rows.filter((r) => r.status === status) : rows;
}

export async function auditSkill(
  id: number,
  status: "confirmed" | "rejected",
  opts: { level?: string; by?: string } = {},
): Promise<void> {
  const db = getDb();
  await db
    .update(candidateSkill)
    .set({
      status,
      level: opts.level ?? null,
      auditedAt: new Date().toISOString(),
      auditedBy: opts.by ?? "self",
    })
    .where(eq(candidateSkill.id, id));
}

/* -------------------------------------------------------------------------- */
/* Market demand                                                               */
/* -------------------------------------------------------------------------- */

export type SkillDemand = {
  slug: string;
  name: string;
  category: string;
  /** Share of high-fit postings mentioning it, 0..1. */
  demand: number;
  postings: number;
  candidateStatus: string | null;
};

/**
 * How often each catalogue skill appears in the jobs that actually match.
 *
 * Scoped to high-fit postings on purpose: measuring against the whole corpus
 * would describe the market for roles the candidate does not want.
 */
export async function skillDemand(opts: { minFit?: number; candidateId?: number } = {}): Promise<SkillDemand[]> {
  const db = getDb();
  const minFit = opts.minFit ?? 60;

  const rows = await db
    .select({ text: sql<string>`lower(coalesce(${job.descriptionText}, '') || ' ' || ${job.title})` })
    .from(job)
    .innerJoin(jobScore, eq(jobScore.jobId, job.id))
    .where(and(sql`${job.closedAt} is null`, sql`${jobScore.fit} >= ${minFit}`))
    .limit(400);

  const corpus = rows.map((r) => r.text);
  const catalog = await db.select().from(skill);

  const mine = opts.candidateId ? await candidateSkills(opts.candidateId) : [];
  const bySlug = new Map(mine.map((m) => [m.slug, m.status]));

  return catalog
    .map((s) => {
      const aliases = [s.canonicalName.toLowerCase(), ...((s.aliases as string[]) ?? [])];
      const postings = corpus.filter((t) => aliases.some((a) => findAll(t, a).length > 0)).length;
      return {
        slug: s.slug,
        name: s.canonicalName,
        category: s.category,
        demand: corpus.length > 0 ? postings / corpus.length : 0,
        postings,
        candidateStatus: bySlug.get(s.slug) ?? null,
      };
    })
    .filter((s) => s.postings > 0)
    .sort((a, b) => b.demand - a.demand);
}
