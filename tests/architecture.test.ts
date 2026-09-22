import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { describe, expect, it } from "vitest";
import {
  discoverEntries,
  exportedBindings,
  UNGUARDED_BY_DESIGN,
  guardComesFirst,
  inlineServerDirectives,
  isServerModule,
  productionSources,
  routeMethods,
  stripComments,
} from "./support/entry-inventory.ts";

/**
 * Executable architecture rules.
 *
 * Every assertion here is already true today — that is deliberate. A fitness
 * test that starts red is a wish; one that starts green is a wall. These exist
 * so the ADR 0007 migration cannot silently regress while two conventions live
 * side by side, which the panel named as its own biggest risk.
 */

function walk(
  dir: string,
  accepts: (file: string) => boolean = (file) =>
    file.endsWith(".ts") || file.endsWith(".tsx"),
  out: string[] = [],
): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, accepts, out);
    else if (accepts(full)) out.push(full);
  }
  return out;
}

const markdownParser = unified().use(remarkParse);

function markdownTargets(markdown: string): string[] {
  const tree = markdownParser.parse(markdown);
  const targets: string[] = [];
  visit(tree, (node) => {
    if (!["link", "image", "definition"].includes(node.type)) return;
    const url = (node as { url?: unknown }).url;
    if (typeof url === "string") targets.push(url);
  });
  return targets;
}

const SRC = walk("src");
const APP = walk("app");
const read = (f: string) => readFileSync(f, "utf8");

describe("erasable TypeScript (ADR 0006)", () => {
  it("uses no enum, namespace, decorator or parameter property", () => {
    const offenders: string[] = [];
    for (const file of SRC) {
      const code = read(file);
      if (/^\s*(export\s+)?enum\s+\w/m.test(code)) offenders.push(`${file}: enum`);
      if (/^\s*(export\s+)?namespace\s+\w/m.test(code)) offenders.push(`${file}: namespace`);
      if (/^\s*@[A-Z]\w*\s*\(/m.test(code)) offenders.push(`${file}: decorator`);
      if (/constructor\s*\([^)]*\b(private|public|readonly|protected)\s+\w/.test(code)) {
        offenders.push(`${file}: parameter property`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("carries explicit .ts extensions on relative imports", () => {
    const offenders: string[] = [];
    for (const file of SRC) {
      for (const m of read(file).matchAll(/from\s+"(\.[^"]+)"/g)) {
        const spec = m[1]!;
        if (!spec.endsWith(".ts") && !spec.endsWith(".tsx") && !spec.endsWith(".json")) {
          offenders.push(`${file}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("layering", () => {
  it("keeps the skills domain free of infrastructure", () => {
    // The property that makes the extractor testable without a database.
    const domain = SRC.filter((f) => f.includes("contexts/skills/domain"));
    expect(domain.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of domain) {
      const code = read(file);
      for (const forbidden of ["drizzle-orm", "db/client", "db/schema", "node:fs"]) {
        if (code.includes(forbidden)) offenders.push(`${file}: ${forbidden}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps src/ free of any dependency on the UI", () => {
    // Careful: `./app/` inside a bounded context is its APPLICATION layer
    // (ADR 0007), not Next's `app/`. Only a path that climbs out of src/ or
    // uses the `@/app` alias is actually reaching into the UI.
    const offenders = SRC.filter(
      (f) => /from\s+"(?:\.\.\/)+app\//.test(read(f)) || /from\s+"(?:@\/app\/|next\/)/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("exposes skills to production callers only through the context API", () => {
    expect(SRC).not.toContain("src/core/skills.ts");

    const callers = [...SRC, ...walk("app")].filter(
      (file) => !file.includes("src/contexts/skills/"),
    );
    const offenders: string[] = [];
    for (const file of callers) {
      for (const match of read(file).matchAll(/["']([^"']*contexts\/skills\/[^"']+)["']/g)) {
        if (!match[1]!.endsWith("contexts/skills/index.ts")) {
          offenders.push(`${file}: ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("exposes Matching to production callers only through the context API", () => {
    const callers = [...SRC, ...walk("app")].filter(
      (file) => !file.includes("src/contexts/matching/"),
    );
    const offenders = callers.filter((file) =>
      /contexts\/matching\/(?:app|domain|infra)\//.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps presentation adapters on bounded-context public APIs", () => {
    const callers = ["src/cli.ts", ...walk("app")];
    const offenders: string[] = [];
    for (const file of callers) {
      const code = read(file);
      for (const forbidden of ["core/db/repo.ts", "core/mail/run.ts"]) {
        if (code.includes(forbidden)) offenders.push(`${file}: ${forbidden}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps report rendering pure and filesystem effects in the CLI", () => {
    const report = read("src/core/report/markdown.ts");
    expect(report).toContain("renderBoardMarkdown");
    expect(report).not.toMatch(/from\s+"node:(?:fs|path)/);
    const cli = read("src/cli.ts");
    expect(cli).toContain("writeFile");
    expect(cli).toContain("exportDossiers");
  });

  it("keeps comparison UI on the composed application service", () => {
    const action = read("app/compare/actions.ts");
    expect(action).toContain("createManualComparison");
    for (const forbidden of ["addManualDescriptionJob", "extractJobDocument", "scoreOne", "getDb"] ) {
      expect(action, forbidden).not.toContain(forbidden);
    }
    const page = read("app/compare/page.tsx");
    expect(page).toContain("getComparisonDetail");
    expect(page).not.toContain("manualMetadata");
    expect(page).not.toContain("job.raw");
  });

  it("persists score explanations as codes and parameters", () => {
    const scorer = read("src/core/scoring/score.ts");
    expect(scorer).toContain('message("title.');
    expect(scorer).toContain('message("blocker.');
    expect(scorer).not.toMatch(/const reasons\s*=\s*\[\s*[`"']/);
    const compare = read("app/compare/page.tsx");
    expect(compare).toContain("renderScoreMessage");
  });

  it("uses one skill matcher and no ignored strategy weights", () => {
    const strategies = read("src/contexts/skills/domain/strategies.ts");
    const gap = read("src/contexts/skills/domain/gap.ts");
    const text = read("src/contexts/skills/domain/text.ts");
    const types = read("src/contexts/skills/domain/types.ts");

    expect(strategies).toContain('from "./matcher.ts"');
    expect(gap).toContain('from "./matcher.ts"');
    expect(text).not.toContain("findOccurrences");
    expect(types).not.toMatch(/\bweight\??\s*:/);
    expect(strategies).not.toMatch(/\bweight\s*:/);
  });
});

describe("architecture inventory", () => {
  it("routes first-party anchors through the stable transition boundary", () => {
    const allowedRawAnchors = new Map<string, Set<string>>([
      ["app/candidate/markdown-preview.tsx", new Set(["href"])],
      ["app/compare/page.tsx", new Set(["externalUrl"])],
      ["app/grid.tsx", new Set(["exportHref"])],
      ["app/job-modal.tsx", new Set(["row.url", "externalApplyUrl"])],
      ["app/joblist.tsx", new Set(["r.url", "externalApplyUrl"])],
      ["app/jobs/[id]/page.tsx", new Set(["job.url", "externalApplyUrl"])],
      ["app/p/[slug]/page.tsx", new Set(["profile.linkedinUrl", "profile.githubUrl"])],
      ["app/pipeline/page.tsx", new Set(["r.url"])],
      ["app/referrals/page.tsx", new Set(["externalUrl"])],
    ]);
    const offenders: string[] = [];

    for (const file of APP) {
      for (const match of read(file).matchAll(/<a\b[\s\S]*?>/g)) {
        const compact = match[0].replace(/\s+/g, " ").trim();
        const href = /\bhref=\{([^}]+)\}/.exec(compact)?.[1]?.trim();
        const nativeNavigation = /\bdownload(?:\s|=)/.test(compact) || /\btarget="_blank"/.test(compact);
        if (!href || !allowedRawAnchors.get(file)?.has(href) || !nativeNavigation) {
          offenders.push(`${file}:${compact}`);
        }
      }
    }

    const directNextLinkImports = APP.filter((file) =>
      file !== "app/transition-link.tsx" && /from ["']next\/link["']/.test(read(file))
    );

    expect(offenders).toEqual([]);
    expect(directNextLinkImports).toEqual([]);
  });

  it("keeps every bounded context public and documented", () => {
    const contexts = readdirSync("src/contexts")
      .filter((name) => statSync(join("src/contexts", name)).isDirectory())
      .sort();
    const contextMap = read("docs/engineering/context-map.md");

    for (const context of contexts) {
      expect(readFileSync(join("src/contexts", context, "index.ts"), "utf8").length).toBeGreaterThan(0);
      expect(contextMap).toContain(`| ${context} |`);
    }
  });

  it("keeps the documented schema count derived from declarations", () => {
    const schema = read("src/core/db/schema.ts");
    const count = [...schema.matchAll(/export const \w+ = production\.table\b/g)].length;
    const contextMap = read("docs/engineering/context-map.md");
    expect(contextMap).toContain(`<!-- schema-table-count: ${count} -->`);
  });
});

describe("write-path invariants (ADR 0005)", () => {
  it("routes every RawJob ingestion channel through the canonical observer", () => {
    const channels = [
      "src/core/ingest/run.ts",
      "src/core/ingest/manual.ts",
      "src/core/ingest/import.ts",
      "src/core/mail/run.ts",
    ];

    for (const file of channels) {
      const code = read(file);
      expect(code, file).toContain("observeRawJob");
      expect(code, file).not.toMatch(/\.insert\(\s*job\s*\)/);
    }
  });

  it("routes every application status change through setApplicationStatus", () => {
    // Ingestion must never write the funnel. If a second write path appears,
    // this fails before anyone notices decisions being overwritten.
    const offenders: string[] = [];
    const ingestion = SRC.filter(
      (f) =>
        f.includes("src/core/ingest") ||
        f.includes("src/core/sources") ||
        f.includes("src/core/mail"),
    );
    for (const file of ingestion) {
      const code = read(file);
      if (/\.(insert|update)\(\s*application\s*\)/.test(code)) {
        offenders.push(`${file}: writes application directly`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("closes jobs instead of deleting them", () => {
    const run = read("src/core/ingest/run.ts");
    expect(run).toContain("closedAt");
    // The only delete in the sync path is pruneClosed, and it is guarded.
    const prune = run.slice(run.indexOf("pruneClosed"));
    expect(prune).toContain("not in (select job_id from production.application)");
  });
});

describe("fit per target track (ADR-008)", () => {
  it("IT-037 routes every job_score reader through a track filter", () => {
    // `job_score` has one row per (candidate, track, job). A reader that picks
    // no track mixes tracks in one list, and the job shows up twice or with a
    // fit from a track nobody chose. Raw SQL counts as much as the builder.
    const exempt = new Set(["src/core/db/schema.ts", "src/core/scoring/apply.ts"]);
    const readers = [...SRC, ...APP].filter(
      (file) => !exempt.has(file) && /\bjobScore\b|production\.job_score\b/.test(read(file)),
    );
    const offenders = readers.filter(
      (file) => !/\b(scoreTrackFilter|primaryScoreFilter)\b/.test(read(file)),
    );
    expect(readers.length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });
});

describe("searches and tracks are the candidate's own (ADR-006)", () => {
  it("IT-121 every Searches action awaits the candidate guard before anything else", () => {
    const files = walk("app/searches", (file) => file.endsWith("actions.ts"));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const code = read(file);
      const exported = [...code.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
      // The first statement of the body, whatever the return type spells.
      const guarded = [
        ...code.matchAll(/export async function (\w+)\([^)]*\)[^\n]*\{\n\s*const [^=]+= await guardOwnCandidate\("candidate:write"\)/g),
      ].map((m) => m[1]);
      for (const name of exported) if (!guarded.includes(name)) offenders.push(`${file}: ${name} does not start with the guard`);
    }
    expect(offenders).toEqual([]);
  });

  it("IT-122 a track id from the URL is looked up among the session's tracks only", () => {
    const page = read("app/searches/tracks/[id]/page.tsx");
    expect(page).toContain("await listCandidateTracks(candidateId)");
    expect(page).toContain("notFound()");
    expect(page).not.toMatch(/searchParams|candidateId\s*=\s*Number/);
  });

  it("um id de vaga não numérico é 404, não erro de servidor", () => {
    // `Number("abc")` é `NaN`, e `NaN` chegando à consulta estoura no
    // PostgreSQL: em produção `/jobs/abc` respondia 500 e alimentava o Sentry
    // com endereço errado de alguém. A tela de trilha já fazia essa guarda.
    const page = read("app/jobs/[id]/page.tsx");
    expect(page).toContain("Number.isSafeInteger(jobId)");
    expect(page).toMatch(/if \(!Number\.isSafeInteger\(jobId\) \|\| jobId <= 0\) notFound\(\);/);
    expect(page).not.toContain("getJobDetail(candidateId, Number(id))");
  });

  it("a tela de operações guarda por admin e pede sem executar", () => {
    // O trabalho leva minutos e a função web morre em 30s: a tela pede e quem
    // executa é o GitHub Actions. Se ela passar a rodar rotina aqui dentro, o
    // 504 volta — foi assim que /candidate/skills caiu.
    const page = read("app/admin/operacoes/page.tsx");
    expect(page).toContain('await requirePage("admin:access")');
    expect(page).not.toMatch(/syncAll|runVerifyQueue|scoreAll/);

    const actions = read("app/admin/operacoes/actions.ts");
    const guardAt = actions.indexOf('await guard("admin:access")');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(actions.indexOf("requestRoutine("));
    // Nenhum id de candidato entra: manutenção é do acervo.
    expect(actions).not.toContain("candidateId");
  });

  it("IT-123 capture health is an admin page that reads aggregates only", () => {
    const page = read("app/admin/captures/page.tsx");
    expect(page).toContain('await requirePage("admin:access")');
    expect(page).toContain("captureHealth(");
    expect(page).not.toMatch(/termOverview|listSavedTerms|saved_term|savedTerm/);
  });

  it("IT-130 no admin route reads a candidate's tracks or terms", () => {
    const offenders = walk("app/admin").filter((file) =>
      /trackOverview|termOverview|listSavedTerms|listCandidateTracks|savedTermForBoard/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });
});

describe("term captures (ADR-004, ADR-006)", () => {
  it("keeps sourcing blind to who saved a term", () => {
    // Capture is per term; who saved it is matching's private data. A sourcing
    // file reading a matching table or the matching API could leak it into a
    // log or into the aggregate health an admin sees.
    const offenders = SRC.filter((file) => file.includes("src/contexts/sourcing/")).filter((file) =>
      /contexts\/matching\/|\b(savedTerm|targetTrack|jobScore|candidate)\b/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });
});

describe("scoring purity (ADR 0004)", () => {
  it("never reaches the network", () => {
    for (const file of SRC.filter((f) => f.includes("src/core/scoring"))) {
      const code = read(file);
      expect(code, file).not.toContain("fetch(");
      expect(code, file).not.toContain("getJson");
    }
  });

  it("keeps SCORER_VERSION declared where the weights live", () => {
    const score = read("src/core/scoring/score.ts");
    expect(score).toMatch(/SCORER_VERSION\s*=\s*"\d+\.\d+\.\d+"/);
  });
});

describe("outbound network boundary", () => {
  it("routes untrusted job URLs through redirect-aware SSRF validation", () => {
    for (const file of [
      "src/core/ingest/probe.ts",
      "src/core/scrape/fetcher.ts",
      "src/core/sources/http.ts",
    ]) {
      expect(read(file), file).toContain("safeRemoteFetch");
    }

    const remote = read("src/core/remote-url.ts");
    expect(remote).toContain("assertSafeRemoteUrl");
    expect(remote).toContain('redirect: "manual"');
    expect(remote).toContain("isGloballyRoutableAddress");
  });
});

describe("floating layers", () => {
  // Base UI confines a popup to its anchor's clipping ancestors by default.
  // Every `Card` sets `overflow-hidden`, and filters, selects and buttons all
  // live inside cards — so the default clipped tooltips in half. These files
  // are generated by the shadcn CLI, and regenerating one would silently drop
  // the fix; this fails loudly instead.
  const POPUPS = ["components/ui/tooltip.tsx", "components/ui/select.tsx"];

  it("gives every Positioner a collision boundary that is not its clipping ancestor", () => {
    const offenders: string[] = [];
    for (const file of POPUPS) {
      const code = read(file);
      if (!code.includes("Positioner")) continue;
      if (!code.includes("collisionBoundary")) offenders.push(`${file}: no collisionBoundary`);
      if (!code.includes("useBodyBoundary")) offenders.push(`${file}: not using useBodyBoundary`);
    }
    expect(offenders).toEqual([]);
  });

  it("resolves the boundary without waiting for an effect", () => {
    // An effect-resolved boundary positions the first frame against the wrong
    // box and visibly jumps.
    const hook = read("lib/popup-boundary.ts");
    expect(hook).toContain("useState");
    expect(hook).not.toContain("useEffect");
    // Must stay safe to import from a file that also renders on the server.
    expect(hook).toContain('typeof document === "undefined"');
  });
});

describe("pluggability (rule 4)", () => {
  // The system exists to receive modules: sources, queues, LLM providers. Each
  // is a port with adapters, and the value only survives if the boundary does.
  it("keeps every port free of a concrete implementation", () => {
    // Detect the exported contract, not a filename convention. QueuePort used
    // to live beside its Drizzle adapter in `queue.ts`, so the old
    // `endsWith("ports.ts")` check silently ignored exactly the broken port.
    const contracts = SRC.flatMap((file) =>
      [...read(file).matchAll(/export\s+(?:type|interface)\s+(\w+(?:Port|Adapter))\b/g)]
        .map((match) => ({ file, name: match[1]! })),
    );
    expect(contracts.map((contract) => contract.name)).toContain("QueuePort");

    const offenders: string[] = [];
    for (const contract of contracts) {
      const code = read(contract.file);
      for (const forbidden of ["drizzle-orm", "getDb", "db/schema", "node:fs", "/infra/"]) {
        if (code.includes(forbidden)) {
          offenders.push(`${contract.file} (${contract.name}): ${forbidden}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps queue status independent of its Drizzle representation", () => {
    const status = read("src/core/scrape/domain/status.ts");
    for (const forbidden of ["drizzle-orm", "getDb", "db/schema", "node:fs"]) {
      expect(status, forbidden).not.toContain(forbidden);
    }

    const schema = read("src/core/db/schema.ts");
    expect(schema).toContain('from "../scrape/domain/status.ts"');
    expect(schema).not.toMatch(/export const SCRAPE_STATUSES\s*=\s*\[/);
  });

  it("never hard-codes an LLM provider outside its adapter file", () => {
    // A direct call to api.anthropic.com anywhere else would defeat BYOK: the
    // user could no longer choose, and the key would spread.
    const offenders = SRC.filter(
      (f) => !f.endsWith("llm/providers.ts") && /api\.(anthropic|openai)\.com/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("handles the API key only where authentication happens", () => {
    // A chave existe apenas onde a requisição é ASSINADA. Em qualquer outro
    // lugar ela não tem uso, e chave que se espalha é chave que vaza.
    //
    // A lista é curta porque cada entrada é um lugar a mais onde uma chave pode
    // acabar num log, num erro ou num commit. Acrescentar uma é decisão
    // deliberada, não conveniência: precisa ser um adapter que fala com um
    // provedor externo e assina a chamada.
    const allowed = new Set([
      "src/core/llm/providers.ts",
      "src/contexts/auth/infra/resend-mailer.ts",
    ]);
    const offenders = SRC.filter(
      (f) => !allowed.has(f) && /\bapiKey\b/.test(read(f)) && !/apiKeyEnv/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("never writes a key to the database", () => {
    // The registry stores the NAME of the environment variable. A database file
    // gets copied, backed up and opened by other processes; a key inside it
    // travels with all of that.
    const schema = read("src/core/db/schema.ts");
    expect(schema).toContain("apiKeyEnv");
    expect(schema).not.toMatch(/apiKey:\s*text\("api_key"/);
  });

  it("never prints a key", () => {
    const offenders = SRC.filter((f) => /console\.(log|error)\([^)]*\bapiKey\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("authorisation (AUTH-01)", () => {
  // Descobertos pela semântica do Next, não pelo nome do arquivo. O teste antigo
  // lia só `*actions.ts` e `logoutAction` ficava de fora pelo nome do arquivo
  // (E13). Ver `tests/support/entry-inventory.ts`.
  const INVENTORY = discoverEntries();
  const APP = INVENTORY.serverModules;
  const ROUTES = INVENTORY.routes;

  /**
   * A política de cada página, por arquivo. Página nova sem linha aqui reprova.
   *
   * `guard` é a chamada literal que precisa estar na página; `exception` é a
   * razão registrada de uma página responder sem sessão, e o que a protege.
   */
  const PAGE_POLICY: Record<string, { guard: string } | { exception: string }> = {
    "app/page.tsx": { guard: 'requireOwnCandidatePage("candidate:read")' },
    "app/admin/captures/page.tsx": { guard: 'requirePage("admin:access")' },
    "app/admin/operacoes/page.tsx": { guard: 'requirePage("admin:access")' },
    "app/admin/users/page.tsx": { guard: 'requirePage("user:manage")' },
    "app/candidate/page.tsx": { guard: 'requireOwnCandidatePage("candidate:read")' },
    "app/candidate/skills/page.tsx": { guard: 'requireOwnCandidatePage("candidate:read")' },
    "app/candidate/vocabulary/page.tsx": { guard: 'requireOwnCandidatePage("candidate:read")' },
    "app/compare/page.tsx": { guard: 'requireOwnCandidatePage("candidate:read")' },
    "app/jobs/page.tsx": { guard: 'requirePage("job:read")' },
    "app/jobs/[id]/page.tsx": { guard: 'requirePage("job:read")' },
    "app/jobs/[id]/paises/page.tsx": { guard: 'requirePage("job:read")' },
    "app/jobs/new/page.tsx": { guard: 'requirePage("job:write")' },
    "app/pipeline/page.tsx": { guard: 'requireOwnCandidatePage("candidate:read")' },
    "app/recruiter/page.tsx": { guard: 'requirePage("job:read")' },
    "app/recruiter/[candidateId]/page.tsx": {
      guard: 'requirePage("candidate:read", { kind: "candidate", candidateId })',
    },
    "app/referrals/page.tsx": { guard: 'requireOwnCandidatePage("candidate:read")' },
    "app/searches/page.tsx": { guard: 'requireOwnCandidatePage("candidate:read")' },
    "app/searches/tracks/[id]/page.tsx": { guard: 'requireOwnCandidatePage("candidate:read")' },
    "app/searches/tracks/new/page.tsx": { guard: 'requireOwnCandidatePage("candidate:read")' },
    "app/transition-test/page.tsx": { guard: 'requirePage("job:read")' },
    "app/login/page.tsx": {
      exception:
        "pré-sessão: formulário de entrada; lê só se EXISTE alguma conta, para mostrar os comandos de primeiro acesso",
    },
    "app/login/forgot/page.tsx": { exception: "pré-sessão: formulário de recuperação; não lê dado nenhum" },
    "app/login/reset/page.tsx": {
      exception: "pré-sessão: o token de uso único é a autorização; a página só pergunta se ele está vivo",
    },
    "app/p/[slug]/page.tsx": {
      exception:
        "portfólio público: `publicProfile()` monta por lista de permissão, 404 para não público, limite por IP no proxy",
    },
  };

  /**
   * Route Handlers sem sessão por necessidade, e o que substitui a sessão.
   *
   * Por MÉTODO, como a rota guardada: um `POST` acrescentado ao cron não
   * herda a exceção do `GET`.
   */
  const PUBLIC_ROUTES: Record<string, { methods: string[]; why: string }> = {
    "app/login/callback/route.ts": {
      methods: ["GET"],
      why: "pré-sessão: o link mágico de uso único é a autorização e cria a sessão",
    },
    // O cron não tem sessão para validar: a Vercel o chama sem cookie. Ele
    // se autentica com `CRON_SECRET` em `authorization`, comparado em tempo
    // constante — um `===` sobre segredo vaza o prefixo pelo tempo de
    // resposta, e esta rota atende quem quiser chamá-la. Sem o segredo
    // configurado responde 503: fechada por omissão, e não aberta.
    "app/api/cron/recheck/route.ts": {
      methods: ["GET"],
      why: "serviço: `CRON_SECRET` em tempo constante; 503 sem o segredo",
    },
  };
  const ROUTE_GUARD = /await (require(?:OwnCandidatePage|Page|Session)|guard(?:OwnCandidate)?)\(/;

  /**
   * Arquivos de segmento que renderizam sem ser página. Não recebem parâmetro
   * de rota nem leem dado privado; o layout só consulta a sessão para o crachá.
   */
  const SEGMENT_POLICY: Record<string, string> = {
    "app/layout.tsx": "casca: lê a própria sessão (`renderSession`) só para crachá e navegação",
    "app/error.tsx": "fallback de erro sem dado",
    "app/forbidden.tsx": "fallback 403 sem dado",
    "app/not-found.tsx": "fallback 404 sem dado",
    "app/transition-test/error.tsx": "fallback de erro da rota de teste, sem dado",
  };

  it("exposes Auth to production callers only through its public API", () => {
    const callers = [...SRC.filter((file) => !file.includes("src/contexts/auth/")), ...walk("app")];
    const offenders = callers.filter((file) =>
      /contexts\/auth\/(?:app|domain|infra)\//.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("guards every Server Action", () => {
    // A Server Action is a public HTTP endpoint. One that forgets the guard is
    // reachable by anyone who can reach the server, and the omission is
    // invisible in review because the file looks like ordinary code.
    expect(APP.length).toBeGreaterThan(0);
    const offenders: string[] = [];

    for (const file of APP) {
      const code = read(file);
      if (!code.includes('"use server"')) continue;

      // O tipo de retorno é opcional na sintaxe e invisível para esta rede se
      // não for previsto: `): Promise<TrackResult> {` deixou de casar quando
      // `trackAction` ganhou um, e a action saiu do teste sem ninguém notar.
      for (const match of code.matchAll(/export async function (\w+)\s*\([^)]*\)\s*(?::[^{]+)?\{/g)) {
        const name = match[1]!;
        if (UNGUARDED_BY_DESIGN.get(name)?.file === file) continue;
        const body = code.slice(match.index, code.indexOf("\n}", match.index));
        if (!/await guard(OwnCandidate)?\(/.test(body)) {
          offenders.push(`${file}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("validates sessions inside every protected Route Handler", () => {
    // Middleware checks cookie presence only. A forged cookie reaches the
    // handler, so the handler itself must resolve and authorise the session.
    // Por MÉTODO: um `POST` novo num arquivo que já tem `GET` guardado não
    // herda o guarda do vizinho.
    expect(ROUTES.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of ROUTES) {
      const source = read(file);
      const { methods, unknown } = routeMethods(source);
      if (methods.length === 0) offenders.push(`${file}: nenhum método HTTP reconhecido`);
      for (const name of unknown) offenders.push(`${file}: export desconhecido ${name}`);
      const exempt = PUBLIC_ROUTES[file]?.methods ?? [];
      const code = stripComments(source);
      for (const method of methods) {
        if (exempt.includes(method)) continue;
        // `export const GET = …` não tem `function GET(`: sem corpo achado,
        // reprova em vez de ler o arquivo a partir do último caractere.
        const start = code.search(new RegExp(`function\\s+${method}\\s*\\(`));
        if (start === -1) {
          offenders.push(`${file}: ${method} sem corpo legível`);
          continue;
        }
        const body = code.slice(start);
        const end = body.search(/\n\}/);
        if (!ROUTE_GUARD.test(end === -1 ? body : body.slice(0, end))) offenders.push(`${file}: ${method}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("V03-01 classifica toda página, Route Handler, segmento e Server Action descobertos", () => {
    // O inventário é a lista do que o FRAMEWORK expõe; a política é a lista do
    // que alguém decidiu. Entrada na primeira sem linha na segunda reprova, e
    // linha na segunda sem entrada na primeira também — exceção órfã é furo
    // esperando alguém recriar o arquivo.
    const offenders: string[] = [];

    for (const page of INVENTORY.pages) {
      const policy = PAGE_POLICY[page];
      if (!policy) {
        offenders.push(`${page}: página sem política`);
        continue;
      }
      if ("guard" in policy) {
        const code = stripComments(read(page));
        const at = code.indexOf(policy.guard);
        // Presença não basta: `void requirePage(...)` ou uma chamada solta
        // não guarda nada. A instrução que contém o guarda precisa aguardá-lo
        // (direto, via `Promise.all` ou pelo cronômetro de estágio).
        const statementStart = Math.max(code.lastIndexOf(";", at), code.lastIndexOf("{\n", at));
        if (at === -1) offenders.push(`${page}: falta ${policy.guard}`);
        else if (!/\bawait\b/.test(code.slice(statementStart, at))) offenders.push(`${page}: ${policy.guard} sem await`);
      } else if (policy.exception.trim().length < 20) {
        offenders.push(`${page}: exceção sem justificativa`);
      }
    }
    for (const page of Object.keys(PAGE_POLICY)) {
      if (!INVENTORY.pages.includes(page)) offenders.push(`${page}: política órfã`);
    }

    for (const [route, { methods }] of Object.entries(PUBLIC_ROUTES)) {
      if (!ROUTES.includes(route)) {
        offenders.push(`${route}: exceção órfã`);
        continue;
      }
      const exposed = routeMethods(read(route)).methods;
      for (const method of methods) {
        if (!exposed.includes(method)) offenders.push(`${route}: exceção órfã para ${method}`);
      }
    }

    for (const segment of INVENTORY.segments) {
      if (!(segment in SEGMENT_POLICY)) offenders.push(`${segment}: segmento sem classificação`);
    }
    for (const segment of Object.keys(SEGMENT_POLICY)) {
      if (!INVENTORY.segments.includes(segment)) offenders.push(`${segment}: classificação órfã`);
    }

    // Server Action: TODO export do módulo, em qualquer forma, guarda primeiro.
    const exempted = new Set<string>();
    for (const file of APP) {
      const source = read(file);
      for (const binding of exportedBindings(source)) {
        const exception = UNGUARDED_BY_DESIGN.get(binding.exported);
        if (exception?.file === file) {
          exempted.add(binding.exported);
          continue;
        }
        const verdict = guardComesFirst(source, binding.local);
        if (!verdict.ok) offenders.push(`${file}: ${binding.exported} — ${verdict.reason}`);
      }
    }
    for (const [name, { why }] of UNGUARDED_BY_DESIGN) {
      if (!exempted.has(name)) offenders.push(`${name}: exceção órfã`);
      if (why.trim().length < 20) offenders.push(`${name}: exceção sem justificativa`);
    }

    // Diretiva dentro de função vira endpoint sem que o arquivo diga isso.
    for (const file of INVENTORY.inlineServer) offenders.push(`${file}: "use server" inline`);

    expect(offenders).toEqual([]);
    // Guarda contra o teste passar por não ter achado nada.
    expect(INVENTORY.pages.length).toBeGreaterThan(20);
    expect(APP.length).toBeGreaterThan(10);
  });

  it("V03-01 roteia só por app/: outro diretório de rotas seria superfície fora do inventário", () => {
    for (const dir of ["pages", "src/app", "src/pages"]) {
      expect(existsSync(dir), dir).toBe(false);
    }
  });

  it("V03-01 a descoberta não depende de nome de arquivo nem de forma de export", () => {
    // Fixture negativa: cada forma abaixo é uma action que a versão anterior
    // do teste não via. A descoberta precisa enxergá-las E a conferência do
    // guarda precisa recusá-las.
    const sneaky = [
      '"use server";',
      "// comentário com { chave } e export async function fantasma() {}",
      "export const arrow = async (formData: FormData) => { await apagarTudo(formData); };",
      "async function local() { await apagarTudo(); }",
      "export { local as renamed };",
      'export { outra } from "./outra";',
      "export default async function padrao(formData: FormData) { revalidatePath(\"/\"); await guard(\"job:read\"); }",
      "export async function comTipo(): Promise<{ ok: true }> { const x = await lerCurriculo(); await guard(\"job:read\"); return { ok: true }; }",
      "export async function certa(): Promise<{ ok: true }> { const s = await guard(\"job:read\"); return { ok: true }; }",
    ].join("\n");

    expect(isServerModule(sneaky)).toBe(true);
    const bindings = exportedBindings(sneaky);
    expect(bindings.map((b) => b.exported).sort()).toEqual(
      ["arrow", "certa", "comTipo", "default", "outra", "renamed"].sort(),
    );
    const verdicts = Object.fromEntries(
      bindings.map((b) => [b.exported, guardComesFirst(sneaky, b.local).ok]),
    );
    expect(verdicts).toEqual({
      arrow: false,
      renamed: false,
      outra: false,
      default: false,
      comTipo: false,
      certa: true,
    });
    // Recusadas pelo motivo certo, e não por acaso do padrão.
    expect(guardComesFirst(sneaky, "padrao")).toMatchObject({ reason: "efeito antes do guarda: revalidatePath(" });
    expect(guardComesFirst(sneaky, "comTipo")).toMatchObject({ ok: false, reason: expect.stringContaining("lerCurriculo") });

    // Default anônimo em arrow: descoberto, e recusado por não ter corpo nomeado.
    const anonymous = '"use server";\nexport default async (formData: FormData) => { await apagarTudo(formData); };';
    expect(exportedBindings(anonymous)).toEqual([{ exported: "default", local: null }]);

    // "use server" citado em comentário não é diretiva; dentro de função é.
    expect(isServerModule('// "use server"\nexport async function x() {}')).toBe(false);
    expect(inlineServerDirectives('export function Form() { async function salvar() { "use server"; } }')).toBe(1);
    expect(inlineServerDirectives('"use server";\nexport async function a() { await guard("x"); }')).toBe(0);
  });


  it("uses candidate-scoped page guards wherever funnel or CV data is read", () => {
    // `/jobs` NÃO está nesta lista, e a ausência é decisão.
    //
    // O acervo é global e a política concede `job:read` aos três papéis. A
    // página guardava com escopo de candidato, e o efeito era um recrutador
    // entrar com a senha certa e receber 403 — a composição contradizendo a
    // política, com cada metade correta sozinha. Nota de aderência e estado de
    // candidatura continuam sendo por candidato; são COLUNAS, e voltam nulas
    // para quem não tem escopo.
    const privatePages = [
      "app/page.tsx",
      "app/pipeline/page.tsx",
      "app/referrals/page.tsx",
      "app/candidate/page.tsx",
      "app/candidate/skills/page.tsx",
      "app/candidate/vocabulary/page.tsx",
      // Termos e trilhas são privados (ADR-006): só o próprio candidato.
      "app/searches/page.tsx",
      "app/searches/tracks/new/page.tsx",
      "app/searches/tracks/[id]/page.tsx",
    ];
    for (const file of privatePages) {
      expect(read(file), file).toContain("await requireOwnCandidatePage(");
    }

    const jobDetail = read("app/jobs/[id]/page.tsx");
    expect(jobDetail).toContain('await requirePage("job:read")');
    expect(jobDetail).toContain("candidateId !== null");
    expect(jobDetail).toContain("action={trackAction}");
  });

  it("keeps session and active-candidate resolution read-only", () => {
    // A resolver runs on every request/CLI read. Hiding profile sync here turns
    // reads into writes, creates lock contention and couples Auth to Candidate.
    const auth = read("app/auth.ts");
    const cli = read("src/cli.ts");
    expect(auth).not.toContain("syncCandidateFromProfile");
    expect(auth).toContain("await getCandidate()");
    const resolver = cli.slice(
      cli.indexOf("async function activeCandidateId"),
      cli.indexOf("function applicationStatus"),
    );
    expect(resolver).toContain("await getCandidate()");
    expect(resolver).not.toContain("syncCandidateFromProfile");
  });

  it("scopes application writes to the candidate from the session", () => {
    const actions = read("app/actions.ts");
    const start = actions.indexOf("export async function trackAction");
    const end = actions.indexOf("export async function recheckAction");
    expect(actions.slice(start, end)).toContain('guardOwnCandidate("application:write")');
  });

  it("rate-limits sign-in, the pre-session action that cannot be guarded", () => {
    // Sign-in is unauthenticated by necessity, so the protection has to be a
    // limit rather than a permission.
    const login = read("src/contexts/auth/infra/password-login.ts");
    expect(login).toContain("MAX_ATTEMPTS");
    expect(login).toContain("recentFailures");
  });

  it("answers identically for a wrong password and a missing account", () => {
    // Anything else turns the login form into an account-enumeration oracle.
    const login = read("src/contexts/auth/infra/password-login.ts");
    expect(login).toContain("decoy");
    const action = read("app/login/actions.ts");
    expect(action).not.toMatch(/conta (não existe|inexistente)/i);
  });

  it("keeps password login SQL and adapters behind the Auth API", () => {
    const action = read("app/login/actions.ts");
    expect(action).toContain("passwordSignIn");
    for (const forbidden of ["drizzle-orm", "getDb", "db/schema", "drizzleSessions"]) {
      expect(action, forbidden).not.toContain(forbidden);
    }
    const api = read("src/contexts/auth/index.ts");
    expect(api).not.toMatch(/export\s*\{\s*drizzleSessions\s*\}/);
  });

  it("hashes passwords with a memory-hard KDF, never a plain digest", () => {
    const pw = read("src/contexts/auth/domain/password.ts");
    expect(pw).toContain("scrypt");
    expect(pw).toContain("timingSafeEqual");
    expect(pw).not.toMatch(/createHash\(["']sha256["']\)/);
  });

  it("never lets an action take a candidate id from its own input", () => {
    // The classic multi-tenant leak: the UI filters correctly, and a hand-made
    // POST with someone else's id walks straight through. Scope must come from
    // the session, which is why `guardOwnCandidate` takes no id at all.
    const offenders: string[] = [];
    for (const file of APP) {
      const code = read(file);
      if (/formData\.get\(\s*["']candidateId["']/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("redeems the magic link in a Route Handler, never in a page", () => {
    // Next only allows cookies to be MODIFIED in a Server Action or Route
    // Handler. Doing it while rendering /login threw at runtime — the framework
    // enforcing a boundary that is correct, since rendering should be
    // replayable and starting a session is not.
    const page = read("app/login/page.tsx");
    expect(page).not.toMatch(/cookies\(\)/);
    expect(page).not.toContain("finishLogin");

    const handler = read("app/login/callback/route.ts");
    expect(handler).toContain("finishLogin");
    expect(handler).toContain("cookies()");
  });

  it("sets the session cookie httpOnly and never exposes it to script", () => {
    const handler = read("app/login/callback/route.ts");
    expect(handler).toContain("httpOnly: true");
    expect(handler).toContain("sameSite:");
  });

  it("revokes server-side on logout, not just clears the cookie", () => {
    // Cookie que o cliente apaga continua válido para quem o copiou.
    // Server Action, não Route Handler: a CSP declara `form-action 'self'` e
    // bloqueava o POST de formulário para outra rota — o logout não acontecia,
    // com o erro apenas no console.
    const logout = read("app/logout-action.ts");
    expect(logout).toContain("endSession");
    expect(logout).toContain('"use server"');
  });

  it("protege por omissão", () => {
    // O padrão era `single-user`, que sintetizava sessão e deixava currículo,
    // funil e o export CSV inteiro acessíveis a qualquer requisição. Agora o
    // modo aberto tem de ser pedido.
    //
    // E pedir não basta: a decisão mora numa função pura que também exige o
    // ambiente local (V03-04). Sessão e proxy chamam a MESMA função; ler a
    // variável em qualquer outro lugar seria uma segunda regra, e a segunda
    // regra é a que um dia esquece o ambiente.
    const rule = read("src/contexts/auth/domain/open-mode.ts");
    expect(rule).toContain('env.JHO_AUTH_MODE === "open"');
    const session = read("src/contexts/auth/app/session.ts");
    expect(session).toContain("return openModeActive(env);");
    const proxy = readFileSync("proxy.ts", "utf8");
    expect(proxy).toContain("if (openModeActive(process.env))");

    // Qualquer menção FORA de string e comentário é leitura — `env.X`,
    // `env["X"]`, desestruturação. Texto de ajuda da CLI e do dicionário cita
    // o nome da variável para quem lê, e fica de fora por ser string.
    // `env["JHO_AUTH_MODE"]` é leitura com o nome DENTRO de string: confere-se
    // antes de apagar os literais.
    // Template literal NÃO é apagado: `${process.env.JHO_AUTH_MODE}` é leitura.
    const readers = productionSources().filter((file) => {
      if (file === "src/contexts/auth/domain/open-mode.ts") return false;
      const code = stripComments(read(file));
      if (/\[\s*(["'`])JHO_AUTH_MODE\1\s*\]/.test(code)) return true;
      return /\bJHO_AUTH_MODE\b/.test(code.replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, '""'));
    });
    expect(readers).toEqual([]);
  });

  it("keeps the permission decision in one pure function", () => {
    // Authorisation bugs come from a check that exists in four places and
    // disagrees with itself in one.
    const policy = read("src/contexts/auth/domain/policy.ts");
    for (const forbidden of ["drizzle-orm", "getDb", "cookies", "next/"]) {
      expect(policy, forbidden).not.toContain(forbidden);
    }
    // And it must never fall through to permitted.
    expect(policy).not.toMatch(/default:\s*\n?\s*return ALLOW/);
  });
});

describe("documentação que precisa acompanhar o código", () => {
  it("extrai destinos Markdown navegáveis sem interpretar exemplos cercados", () => {
    const markdown = `[Inline](../inline.md)

![Image](../image.png)

[Reference][archive]

[archive]: ../reference.md

\`\`\`md
[Ignored](../fenced.md)
\`\`\``;

    expect(markdownTargets(markdown)).toEqual([
      "../inline.md",
      "../image.png",
      "../reference.md",
    ]);
  });

  // O índice de ADRs em `docs/README.md` já apodreceu uma vez: listava seis de
  // dez, e as quatro faltantes incluíam justamente as citadas como invariantes
  // em CLAUDE.md. Índice mantido à mão só funciona quando alguém o verifica.
  it("lista toda ADR no índice do README", () => {
    const listed = new Set(
      [...read("docs/README.md").matchAll(/adr\/(\d{4})-/g)].map((m) => m[1]),
    );
    const onDisk = readdirSync("docs/adr")
      .filter((f) => /^\d{4}-.*\.md$/.test(f))
      .map((f) => f.slice(0, 4));

    expect(onDisk.length).toBeGreaterThan(5);
    expect(onDisk.filter((n) => !listed.has(n))).toEqual([]);
  });

  it("a fronteira entre CompozyOS e docs/ está escrita onde se procura por ela", () => {
    // ADR 0011 decide que `.compozy/tasks/` é da feature e `docs/` é do que
    // sobrevive a ela. Duas convenções sem a fronteira escrita apodrecem na
    // terceira feature: passa a haver dois lugares plausíveis para a mesma coisa.
    const adr = read("docs/adr/0011-fronteira-compozyos-e-docs.md");
    expect(adr).toContain(".compozy/tasks/");
    expect(adr).toContain("docs/adr/");
    expect(read("docs/README.md")).toContain("0011");
  });

  it("mantém navegáveis os links locais entre docs duráveis e workflows arquivados", () => {
    const files = [
      ...walk("docs", (file) => file.endsWith(".md")),
      ...walk(".compozy/tasks/_archived", (file) => file.endsWith(".md")),
    ];
    const broken: string[] = [];

    for (const file of files) {
      for (const rawTarget of markdownTargets(read(file))) {
        if (
          rawTarget.startsWith("#") ||
          rawTarget.startsWith("/") ||
          /^[a-z][a-z\d+.-]*:/iu.test(rawTarget)
        ) {
          continue;
        }
        const target = decodeURI(rawTarget.split("#", 1)[0]!);
        const crossesArchiveBoundary =
          target.includes(".compozy/tasks/_archived/") ||
          (file.startsWith(".compozy/tasks/_archived/") && target.includes("docs/"));
        if (crossesArchiveBoundary && !existsSync(resolve(dirname(file), target))) {
          broken.push(`${file}: ${rawTarget}`);
        }
      }
    }

    expect(broken).toEqual([]);
  }, 30_000);
});

describe("client islands stay out of the server graph", () => {
  /**
   * A `"use client"` module is compiled for the browser, so everything it
   * imports goes with it. Importing one constant from `app/filter-state.ts`
   * pulled the matching context, Drizzle, `node:crypto` and `node:dns` into the
   * client bundle, and `next build` refused the whole page — with an error that
   * named a scheme, not the import that caused it. `pnpm check` was green
   * throughout: a type checker has no opinion on which runtime a module ends up
   * in. So the rule is checked here, over the real import graph.
   */
  const RELATIVE = /(?:from|import)\s*\(?\s*["'](\.[^"']+|@\/[^"']+)["']/g;
  const SERVER_ONLY = /from\s+["'](?:node:|drizzle-orm|postgres)/;

  /**
   * The source without its type-only imports.
   *
   * `import type { UrlObject } from "node:url"` is erased before the bundler
   * ever sees it, so counting it would make the rule flag files that are
   * already correct — and a fitness test that starts red is a wish, not a wall.
   *
   * ## Why the first pattern is anchored instead of `[\s\S]*?`
   *
   * It used to be `/\b(?:import|export)\s+type\b[\s\S]*?from\s*["']…["']/`, and
   * `[\s\S]*?` crosses lines. A plain `export type Props = { … }` — which is on
   * hundreds of lines in this repo — matched `export type`, then ran to the
   * NEXT `from "…"` anywhere below it and deleted everything in between. Any
   * value import inside that span vanished from the graph, and the rule stopped
   * seeing exactly the reach it exists to forbid. It erased instead of
   * reporting, so the symptom was silence.
   *
   * The pattern now requires what an import clause actually looks like — braces,
   * one name, or a namespace — followed by `from`. `export type Props =` does
   * not match, because after the name comes `=` and not `from`.
   */
  function values(source: string): string {
    return (
      source
        .replace(
          /\b(?:import|export)\s+type\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s*["'][^"']+["']/g,
          "",
        )
        // Mixed clauses are decided by their specifiers, not by a regex that
        // tries to describe "all of them are types" in one pass:
        // `import { type A, b }` keeps `b` and therefore keeps the edge.
        .replace(/\bimport\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g, (todo, dentro: string) => {
          const especificadores = dentro
            .split(",")
            .map((parte) => parte.trim())
            .filter((parte) => parte.length > 0);
          const soTipos =
            especificadores.length > 0 && especificadores.every((parte) => /^type\s/.test(parte));
          return soTipos ? "" : todo;
        })
    );
  }

  it("UT-081 the type-only filter erases types and never a value import", () => {
    // Cada linha abaixo é uma forma que existe neste repositório. A primeira
    // metade tem de desaparecer; a segunda tem de sobreviver, porque é ela que
    // carrega a aresta que a regra UT-080 procura.
    const apagado = [
      'import type { UrlObject } from "node:url";',
      'import type Config from "./config.ts";',
      'import type * as schema from "./schema.ts";',
      'export type { Board } from "./board.ts";',
      'import { type A, type B } from "./tipos.ts";',
    ];
    for (const linha of apagado) {
      // Sobra o `;`, e é indiferente: o que conta é não restar aresta nenhuma
      // para `RELATIVE` ou `SERVER_ONLY` encontrarem.
      expect(values(linha), linha).not.toMatch(/\bfrom\b/);
    }

    const preservado = [
      'import { getDb } from "node:fs";',
      'import { type Props, render } from "./render.ts";',
      'import postgres from "postgres";',
      // A forma que a versão anterior engolia: uma declaração de tipo acima de
      // um import de valor. Ela não é import, e não pode apagar quem é.
      'export type Props = { a: string };\nimport { db } from "drizzle-orm";',
    ];
    for (const trecho of preservado) {
      expect(SERVER_ONLY.test(values(trecho)) || /\bfrom\s*["']\./.test(values(trecho)), trecho).toBe(
        true,
      );
    }

    // E a prova direta do defeito: o alcance ao servidor continua visível.
    const armadilha = 'export type Props = {\n  a: string;\n};\nimport { sql } from "drizzle-orm";';
    expect(SERVER_ONLY.test(values(armadilha))).toBe(true);
  });

  function resolveImport(from: string, spec: string): string | null {
    const base = spec.startsWith("@/") ? resolve(spec.slice(2)) : resolve(dirname(from), spec);
    const stripped = base.replace(/\.(ts|tsx)$/, "");
    for (const candidate of [base, `${stripped}.ts`, `${stripped}.tsx`, join(base, "index.ts")]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  /** The import chain from `entry` to the first server-only module, if any. */
  function serverReach(entry: string, seen: Set<string>): string[] | null {
    if (seen.has(entry)) return null;
    seen.add(entry);
    const source = values(readFileSync(entry, "utf8"));
    if (SERVER_ONLY.test(source)) return [entry];
    for (const match of source.matchAll(RELATIVE)) {
      const next = resolveImport(entry, match[1]!);
      if (next === null) continue;
      // A `"use server"` module is the legitimate door: the bundler replaces it
      // with a reference, so what it imports never crosses to the browser. An
      // island reaching the database THROUGH a Server Action is the design.
      if (/^\s*["']use server["']/.test(readFileSync(next, "utf8"))) continue;
      const deeper = serverReach(next, seen);
      if (deeper !== null) return [entry, ...deeper];
    }
    return null;
  }

  it("UT-080 a client module reaches the server graph only through a Server Action", () => {
    const islands = [...walk("app"), ...walk("components")].filter((file) =>
      /^\s*["']use client["']/.test(readFileSync(file, "utf8")),
    );
    // Guarda contra o teste passar por não ter achado ilha nenhuma.
    expect(islands.length).toBeGreaterThan(3);

    const offenders = islands
      .map((island) => serverReach(island, new Set<string>()))
      .filter((chain): chain is string[] => chain !== null)
      .map((chain) => chain.join(" -> "));

    expect(offenders).toEqual([]);
  });
});
