import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { describe, expect, it } from "vitest";

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
    const count = [...schema.matchAll(/export const \w+ = sqliteTable\b/g)].length;
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
    expect(prune).toContain("not in (select job_id from application)");
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
  const APP = walk("app").filter((f) => f.endsWith("actions.ts"));
  const ROUTES = walk("app").filter((f) => f.endsWith("route.ts"));

  /**
   * The one action that may not be guarded, and why.
   *
   * Sign-in is where a session begins, so requiring one would be circular. It
   * is the only unauthenticated write in the system, which is why the rate
   * limit lives underneath it. Listed here explicitly so the exception is a
   * decision on the record rather than an omission nobody noticed.
   */
  const UNGUARDED_BY_DESIGN = new Set([
    "passwordLoginAction",
    // Encerrar uma sessão não pode exigir uma sessão válida. `guard` lançaria
    // para quem está com sessão emprestada expirada ou quebrada, e a pessoa
    // ficaria presa na identidade de outra — sem caminho de volta pela
    // interface. Mesma razão de `logoutAction`, que só não aparece aqui porque
    // o arquivo dele não termina em `actions.ts`.
    "stopImpersonatingAction",
    // Recuperação de senha não pode exigir sessão: quem esqueceu a senha não
    // tem uma. Exigir guard aqui seria pedir que a pessoa entrasse para poder
    // recuperar o acesso de que não se lembra.
    //
    // O que substitui o guard nas duas: `requestResetAction` responde igual
    // para conta existente e inexistente, e limita por endereço;
    // `submitResetAction` trata o TOKEN como a autorização — uso único, uma
    // hora de validade, e queimado antes de a senha ser gravada.
    "requestResetAction",
    "submitResetAction",
  ]);

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

      for (const match of code.matchAll(/export async function (\w+)\s*\([^)]*\)\s*\{/g)) {
        const name = match[1]!;
        if (UNGUARDED_BY_DESIGN.has(name)) continue;
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
    const publicByDesign = new Set([
      "app/login/callback/route.ts",
      // O cron não tem sessão para validar: a Vercel o chama sem cookie. Ele
      // se autentica com `CRON_SECRET` em `authorization`, comparado em tempo
      // constante — um `===` sobre segredo vaza o prefixo pelo tempo de
      // resposta, e esta rota atende quem quiser chamá-la. Sem o segredo
      // configurado responde 503: fechada por omissão, e não aberta.
      "app/api/cron/recheck/route.ts",
    ]);
    const offenders = ROUTES.filter(
      (file) =>
        !publicByDesign.has(file) &&
        !/await (require(?:OwnCandidatePage|Page|Session)|guard(?:OwnCandidate)?)\(/.test(read(file)),
    );
    expect(offenders).toEqual([]);
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
      "app/jobs/[id]/page.tsx",
      "app/pipeline/page.tsx",
      "app/referrals/page.tsx",
      "app/candidate/page.tsx",
      "app/candidate/skills/page.tsx",
      "app/candidate/vocabulary/page.tsx",
    ];
    for (const file of privatePages) {
      expect(read(file), file).toContain("await requireOwnCandidatePage(");
    }
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

  it("rate-limits the one action that cannot be guarded", () => {
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
    const session = read("src/contexts/auth/app/session.ts");
    expect(session).toContain('env.JHO_AUTH_MODE === "open"');
    const proxy = readFileSync("proxy.ts", "utf8");
    expect(proxy).toContain('process.env.JHO_AUTH_MODE === "open"');
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
  });
});
