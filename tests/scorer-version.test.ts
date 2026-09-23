/**
 * V10-01: mudou a saída do scorer, mudou `SCORER_VERSION`.
 *
 * A regra 6 dizia "mexeu no scorer ou em `profile.yaml`? bump", e o único
 * teste conferia que a versão é uma string SemVer — qualquer diff passava.
 * Conferir o DIFF também estaria errado: `docs/scoring.md` define a versão como
 * identificador de compatibilidade, que muda quando o **output** muda para o
 * mesmo input. Refatorar sem mudar resultado não pede bump; mudar um peso no
 * `profile.yaml`, pede.
 *
 * Então o teste mede a saída. Um acervo fixo de vagas, escolhido para passar
 * por todos os componentes, é pontuado contra o `profile.yaml` real com instante
 * e câmbio fixos. O hash do resultado é a impressão do scorer, e ela fica
 * registrada ao lado da versão. Se a impressão muda e a versão não, reprova.
 *
 * O que ele não prova: uma mudança que não altera nenhuma vaga deste acervo
 * passa sem bump — o acervo é amostra, e o teste de sensibilidade abaixo mostra
 * quais eixos ela observa. E trocar a impressão registrada sem trocar a versão
 * é uma edição deliberada, visível no diff; o teste não tem como distinguir
 * isso de um refactor, e quem revisa tem.
 *
 * Rescore só em fixture: a invalidação por versão e por conteúdo é provada em
 * `track-scoring.test.ts` (linha com `scorerVersion: "1.3.0"`) e em
 * `job-observation.test.ts`. Nenhum teste aqui toca banco de produção.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FxTable } from "../src/core/money.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import type { Profile } from "../src/core/profile/schema.ts";
import { SCORER_VERSION, scoreJob, type ScoreInput } from "../src/core/scoring/score.ts";

/**
 * A impressão que acompanha a versão atual.
 *
 * Deu bump de propósito? Rode este arquivo: a falha imprime a impressão nova,
 * que entra aqui junto com a versão, no mesmo commit.
 */
const RECORDED = {
  version: "1.4.1",
  fingerprint: "ca4e5b386449d6533e48f654ae6f662a6cb9bbb70d0068e0362306fb35a137de",
} as const;

const AS_OF = Date.parse("2026-09-01T00:00:00Z");
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(AS_OF - days * DAY).toISOString();

const FX: FxTable = {
  base: "USD",
  rates: { BRL: 5.4, EUR: 0.92, GBP: 0.79, JPY: 147 },
  date: "2026-08-28",
};

const LONG_BODY =
  "We are a distributed team building a multi-tenant SaaS platform. You will design multi-agent systems, " +
  "own RAG pipelines, build evals and guardrails, and lead architecture using TypeScript, Python, AWS and " +
  "PostgreSQL. We value written communication, ownership and pragmatic engineering across time zones.";

function vaga(overrides: Partial<ScoreInput>): ScoreInput {
  return { title: "Software Engineer", companyName: "Acme", descriptionText: LONG_BODY, locationRaw: "Remote", ...overrides };
}

/**
 * Cada linha exercita um eixo: título por cluster e evitado, vocabulário,
 * senioridade, geografia e elegibilidade, remuneração em moedas, períodos e
 * projeto, frescor em faixas, benefícios e bloqueadores.
 */
const CORPUS: ScoreInput[] = [
  vaga({ title: "AI Solutions Architect" }),
  vaga({ title: "Staff Software Engineer" }),
  vaga({ title: "Applied AI Engineer" }),
  vaga({ title: "Engineering Manager" }),
  vaga({ title: "Senior Backend Engineer" }),
  vaga({ title: "Junior Software Engineer" }),
  vaga({ title: "Account Executive", descriptionText: "Sell our product." }),
  vaga({ title: "Principal Architect", descriptionText: "You will update our website." }),
  vaga({ title: "Tech Lead", descriptionText: `${LONG_BODY} Requires 10+ years of experience.` }),
  vaga({ title: "Tech Lead", descriptionText: `${LONG_BODY} Looking for 2 years of experience.` }),
  vaga({ title: "Cloud Architect", descriptionText: `${LONG_BODY} Experience with WordPress and PHP themes.` }),
  vaga({ locationRaw: "Remote - Brazil / LATAM" }),
  vaga({ locationRaw: "United States only" }),
  vaga({ locationRaw: "Austin, TX", remote: false }),
  vaga({ locationRaw: "Worldwide" }),
  vaga({ locationRaw: "Spain, Portugal only" }),
  vaga({ locationRaw: null, remote: null }),
  vaga({ eligibility: { regions: ["latam"] } }),
  vaga({ descriptionText: `${LONG_BODY} You must be located in the United States.` }),
  vaga({ descriptionText: `${LONG_BODY} US citizen with security clearance.` }),
  vaga({ descriptionText: `${LONG_BODY} This is a hybrid (3 days) on-site role. No sponsorship.` }),
  vaga({ descriptionText: `${LONG_BODY} W2 only.` }),
  vaga({ compMin: 160_000, compMax: 200_000, compCurrency: "USD", compPeriod: "year" }),
  vaga({ compMax: 80_000, compCurrency: "USD", compPeriod: "year" }),
  vaga({ compMax: 12_000, compCurrency: "USD", compPeriod: "month" }),
  vaga({ compMax: 95, compCurrency: "USD", compPeriod: "hour" }),
  vaga({ compMax: 65_000, compCurrency: "BRL", compPeriod: "month" }),
  vaga({ compMax: 140_000, compCurrency: "EUR", compPeriod: "year" }),
  vaga({ compMax: 120_000, compCurrency: "GBP", compPeriod: "year" }),
  vaga({ compMax: 20_000_000, compCurrency: "JPY", compPeriod: "year" }),
  vaga({ compMax: 200_000, compPeriod: "year" }),
  vaga({ compMax: 60_000, compCurrency: "USD", compPeriod: "project", compDurationMonths: 4 }),
  vaga({ compMax: 60_000, compCurrency: "USD", compPeriod: "project" }),
  vaga({ compMax: 5_000, compCurrency: "USD", compPeriod: "fortnight" }),
  vaga({ postedAt: daysAgo(0) }),
  vaga({ postedAt: daysAgo(10) }),
  vaga({ postedAt: daysAgo(30) }),
  vaga({ postedAt: daysAgo(90) }),
  vaga({ postedAt: new Date(AS_OF + 5 * DAY).toISOString() }),
  vaga({ postedAt: "não é uma data" }),
  vaga({
    descriptionText: `${LONG_BODY} Benefits: paid time off, equity, learning budget, health stipend, coworking and an async-first culture.`,
  }),
  vaga({ descriptionText: `${LONG_BODY} Perks: free lunch, gym membership and relocation support.` }),
  vaga({ descriptionText: "Short." }),
  vaga({ descriptionText: null }),
];

function fingerprint(profile: Profile, asOf = AS_OF): string {
  const results = CORPUS.map((input) => scoreJob(input, { profile, fx: FX, asOf }));
  return createHash("sha256").update(JSON.stringify(results)).digest("hex");
}

type Registro = { version: string; fingerprint: string };
type Veredito = { ok: true } | { ok: false; reason: string };

function semver(version: string): number[] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function greater(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

/** A decisão do portão, pura, para que os casos negativos sejam testáveis. */
function bumpVerdict(current: Registro, recorded: Registro): Veredito {
  const now = semver(current.version);
  const before = semver(recorded.version);
  if (now === null) return { ok: false, reason: `SCORER_VERSION "${current.version}" não é SemVer` };
  if (current.version === recorded.version) {
    if (current.fingerprint === recorded.fingerprint) return { ok: true };
    return {
      ok: false,
      reason:
        `a saída do scorer mudou sem bump de SCORER_VERSION (${current.version}). ` +
        `Suba a versão, grave { version, fingerprint: "${current.fingerprint}" } em RECORDED e repontue (fixture, nunca produção automática).`,
    };
  }
  if (before === null || !greater(now, before)) {
    return { ok: false, reason: `SCORER_VERSION voltou ou ficou igual: ${recorded.version} -> ${current.version}` };
  }
  return {
    ok: false,
    reason: `bump para ${current.version} sem registrar a impressão: grave { version: "${current.version}", fingerprint: "${current.fingerprint}" } em RECORDED`,
  };
}

let profile: Profile;

beforeAll(async () => {
  profile = await loadProfile(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("V10-01 bump de SCORER_VERSION acompanha a saída", () => {
  it("a impressão atual é a registrada para a versão atual", () => {
    const verdict = bumpVerdict({ version: SCORER_VERSION, fingerprint: fingerprint(profile) }, RECORDED);
    expect(verdict).toEqual({ ok: true });
  });

  it("o portão reprova cada forma de esquecer o bump", () => {
    const base = { version: "1.4.1", fingerprint: "aaa" };
    expect(bumpVerdict(base, base)).toEqual({ ok: true });
    expect(bumpVerdict({ ...base, fingerprint: "bbb" }, base)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("sem bump"),
    });
    expect(bumpVerdict({ version: "1.5.0", fingerprint: "bbb" }, base)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("sem registrar"),
    });
    expect(bumpVerdict({ version: "1.4.0", fingerprint: "bbb" }, base)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("voltou"),
    });
    expect(bumpVerdict({ version: "1.4", fingerprint: "aaa" }, base)).toMatchObject({ ok: false });
  });

  it("o acervo enxerga cada eixo do perfil: mexer nele muda a impressão", () => {
    // Sem isto, um acervo que só exercita título deixaria passar mudança de
    // remuneração sem bump. Cada mutação é uma edição plausível de profile.yaml.
    const original = fingerprint(profile);
    const mutacoes: Array<[string, (p: Profile) => void]> = [
      ["keywords.critical", (p) => p.keywords.critical.shift()],
      ["keywords.negative", (p) => (p.keywords.negative = [])],
      ["targets.clusters", (p) => (p.targets.clusters.architect!.weight = 0.5)],
      ["targets.avoid_titles", (p) => (p.targets.avoid_titles = [])],
      ["constraints.acceptable_regions", (p) => (p.constraints.acceptable_regions = ["worldwide"])],
      ["blockers", (p) => p.blockers.pop()],
      ["seniority.min_years_expected", (p) => (p.seniority.min_years_expected = 12)],
      ["compensation.ranges", (p) => (p.compensation.ranges[0]!.target = 180_000)],
      ["compensation.project", (p) => (p.compensation.project.max_duration_months = 2)],
      ["compensation.benefits", (p) => (p.compensation.benefits.preferred = [])],
    ];
    for (const [eixo, muda] of mutacoes) {
      const copia = structuredClone(profile);
      muda(copia);
      expect(fingerprint(copia), eixo).not.toBe(original);
    }
    // Frescor não vem do perfil: vem do instante.
    expect(fingerprint(profile, AS_OF + 60 * DAY)).not.toBe(original);
  });
});

describe("V10-02 o scorer não lê o relógio", () => {
  it("o mesmo asOf dá o mesmo score sob relógios ambientes diferentes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    const antes = fingerprint(profile);
    vi.setSystemTime(new Date("2031-06-15T12:00:00Z"));
    const depois = fingerprint(profile);
    expect(depois).toBe(antes);
  });
});
