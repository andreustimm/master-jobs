import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "../src/contexts/auth/index.ts";
import { ensureCandidate, saveDocument, setPublicCv, setVisibility } from "../src/core/candidate.ts";
import {
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_RATE_WINDOW_MS,
  DIRECTORY_VISIBILITIES,
  parseDirectoryQuery,
  recordDirectorySearch,
  searchDirectory,
} from "../src/core/candidate-directory.ts";
import {
  allowlistedImageKey,
  allowlistedProfile,
  publicImageKeyForSlug,
  publicProfile,
} from "../src/core/candidate-public.ts";
import { publicCvMarkdown } from "../src/core/public-cv.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  application,
  authUser,
  candidate,
  candidateMatchingProfile,
  candidateSkill,
  company,
  job,
  recruiterDirectoryQuery,
  skill,
  source,
} from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Diretório de perfis (#465, ADR-013), contra o PostgreSQL de teste com as
 * migrações reais: o montador compartilhado com `/p/`, a busca, os filtros, a
 * paginação e o limite por recrutador.
 *
 * Três candidatos fixos, como no E2E: Paula (Público, CV consentido), Rita
 * (Recrutadores) e Pedro (Privado). Cada um com piso salarial, nota e e-mail
 * que nunca podem aparecer fora do escopo.
 */

let db: DB;
let paula: number;
let rita: number;
let pedro: number;

const PAULA_CV = [
  "# Paula Pública",
  "Contato: paula@x.test · +55 11 91234-5678",
  "",
  "Engenheira de front-end com React e acessibilidade.",
  "",
  "Pretensão salarial: R$ 30.000",
].join("\n");

async function confirmedSkill(candidateId: number, name: string, status = "confirmed"): Promise<void> {
  let [row] = await db.select({ id: skill.id }).from(skill).where(eq(skill.canonicalName, name));
  if (!row) {
    [row] = await db
      .insert(skill)
      .values({ slug: name.toLowerCase(), canonicalName: name, category: "framework", aliases: [] })
      .returning({ id: skill.id });
  }
  await db.insert(candidateSkill).values({ candidateId, skillId: row!.id, status, occurrences: 1 });
}

/** O que é privado de cada candidato: piso no perfil de matching e nota numa candidatura. */
async function privateData(candidateId: number, floor: number, note: string): Promise<void> {
  await db
    .insert(candidateMatchingProfile)
    .values({ candidateId, profileJson: JSON.stringify({ compensation: { floor } }) });
  const [posting] = await db.select({ id: job.id }).from(job).limit(1);
  await db.insert(application).values({ candidateId, jobId: posting!.id, status: "applied", notes: note });
}

beforeEach(async () => {
  db = await useTestDb();
  await db.insert(source).values({ id: "remotive:~dir", kind: "remotive", handle: "~dir", label: "R", enabled: false });
  const [employer] = await db.insert(company).values({ slug: "acme", name: "Acme" }).returning({ id: company.id });
  await db.insert(job).values({
    sourceId: "remotive:~dir", companyId: employer!.id, companyName: "Acme", externalId: "1",
    title: "Staff Engineer", url: "https://example.test/1", fingerprint: "fp1", contentHash: "h1", raw: {},
  });

  paula = await ensureCandidate({
    slug: "paula",
    name: "Paula Pública",
    headline: "Engenheira React",
    location: "Porto Alegre, RS",
    email: "paula@x.test",
    linkedinUrl: "https://linkedin.com/in/paula",
  });
  await setVisibility(paula, "public");
  await setPublicCv(paula, true);
  await saveDocument({ candidateId: paula, kind: "cv", label: "CV", content: PAULA_CV });
  await db.update(candidate).set({ workModel: ["remote"], publicWorkModel: true }).where(eq(candidate.id, paula));
  await confirmedSkill(paula, "React");

  rita = await ensureCandidate({
    slug: "rita",
    name: "Rita Recrutadores",
    headline: "Sênior Backend",
    location: "São Paulo",
    email: "rita@x.test",
  });
  await setVisibility(rita, "recruiters");
  await saveDocument({ candidateId: rita, kind: "cv", label: "CV", content: "# Rita\n\nquokkaword em Go e Kotlin." });
  // Modelo remoto guardado, mas SEM opt-in: não pode filtrar.
  await db.update(candidate).set({ workModel: ["remote"], publicWorkModel: false }).where(eq(candidate.id, rita));
  await confirmedSkill(rita, "React");
  await privateData(rita, 31_337, "zebracorn");

  pedro = await ensureCandidate({
    slug: "pedro",
    name: "Pedro Privado",
    headline: "Sênior React",
    email: "pedro@x.test",
  });
  await confirmedSkill(pedro, "React");
});

afterEach(async () => {
  await releaseTestDb();
});

const search = (params: Record<string, string>) => searchDirectory(parseDirectoryQuery(params));
const names = (result: Awaited<ReturnType<typeof searchDirectory>>) => result.cards.map((card) => card.name);

describe("montador compartilhado com /p/", () => {
  it("IT-144 /p/ de Público continua igual; /p/ de Recrutadores é null", async () => {
    const profile = await publicProfile("paula");
    expect(profile?.slug).toBe("paula");
    expect(profile?.name).toBe("Paula Pública");
    expect(profile?.cv).toBe(publicCvMarkdown(PAULA_CV, { emails: ["paula@x.test"] }));
    expect(await publicProfile("rita")).toBeNull();
  });

  it("IT-145 por id: Rita sim; Pedro, id inexistente e NaN não", async () => {
    expect((await allowlistedProfile({ id: rita }, DIRECTORY_VISIBILITIES))?.name).toBe("Rita Recrutadores");
    expect(await allowlistedProfile({ id: pedro }, DIRECTORY_VISIBILITIES)).toBeNull();
    expect(await allowlistedProfile({ id: 999_999 }, DIRECTORY_VISIBILITIES)).toBeNull();
    expect(await allowlistedProfile({ id: Number.NaN }, DIRECTORY_VISIBILITIES)).toBeNull();
    expect(await allowlistedProfile({ id: -1 }, DIRECTORY_VISIBILITIES)).toBeNull();
  });

  it("a chave da imagem segue a mesma decisão: visibilidade, opt-in e id válido", async () => {
    await db.update(candidate).set({ photoKey: "candidates/x/photo/a.webp", publicPhoto: true }).where(eq(candidate.id, rita));
    await db.update(candidate).set({ photoKey: "candidates/y/photo/b.webp", publicPhoto: true }).where(eq(candidate.id, pedro));
    expect(await allowlistedImageKey({ id: rita }, "photo", DIRECTORY_VISIBILITIES)).toBe("candidates/x/photo/a.webp");
    expect(await allowlistedImageKey({ id: rita }, "cover", DIRECTORY_VISIBILITIES)).toBeNull();
    expect(await allowlistedImageKey({ id: pedro }, "photo", DIRECTORY_VISIBILITIES)).toBeNull();
    expect(await allowlistedImageKey({ id: Number.NaN }, "photo", DIRECTORY_VISIBILITIES)).toBeNull();
    // Recrutadores não serve imagem pelo /p/.
    expect(await publicImageKeyForSlug("rita", "photo")).toBeNull();
  });

  it("IT-146 o perfil do diretório é igual ao /p/, e o cartão só tem campos dele", async () => {
    const fromDirectory = await allowlistedProfile({ id: paula }, DIRECTORY_VISIBILITIES);
    const fromPublic = await publicProfile("paula");
    expect(fromDirectory).toEqual(fromPublic);

    const result = await search({ q: "paula" });
    const [card] = result.cards;
    expect(card?.id).toBe(paula);
    const { id: _id, ...fields } = card!;
    for (const [key, value] of Object.entries(fields)) {
      expect(Object.keys(fromPublic!), key).toContain(key);
      expect(value, key).toEqual(fromPublic![key as keyof typeof fromPublic]);
    }
  });
});

describe("busca", () => {
  it("IT-147 busca vazia: 45 visíveis, páginas de 20 por nome e id, sem Privado nem visibilidade desconhecida", async () => {
    await setVisibility(paula, "private");
    await setVisibility(rita, "private");
    for (let i = 0; i < 45; i++) {
      const id = await ensureCandidate({ slug: `vis-${i}`, name: `Visível ${String(i % 40).padStart(2, "0")}` });
      await setVisibility(id, i % 2 === 0 ? "public" : "recruiters");
    }
    for (let i = 0; i < 10; i++) await ensureCandidate({ slug: `priv-${i}`, name: `Aaa Privado ${i}` });
    const unknown = await ensureCandidate({ slug: "foo", name: "Aaa Foo" });
    await db.update(candidate).set({ visibility: "foo" }).where(eq(candidate.id, unknown));

    const pages = await Promise.all([1, 2, 3].map((page) => search({ page: String(page) })));
    expect(pages.map((page) => page.total)).toEqual([45, 45, 45]);
    expect(pages.map((page) => page.cards.length)).toEqual([DIRECTORY_PAGE_SIZE, DIRECTORY_PAGE_SIZE, 5]);
    const all = pages.flatMap((page) => page.cards);
    expect(all.every((card) => card.name.startsWith("Visível"))).toBe(true);
    // Nome, depois id: os cinco nomes repetidos ("Visível 00" a "04") saem em ordem de id.
    const keys = all.map((card) => [card.name, card.id] as const);
    const sorted = [...keys].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    expect(keys).toEqual(sorted);
    expect(all.map((card) => card.id)).not.toContain(unknown);
  });

  it("IT-148 'senior react' casa Rita (headline Sênior, skill React); skill pendente não casa; sem headline casa pelo nome", async () => {
    expect(names(await search({ q: "senior react" }))).toEqual(["Rita Recrutadores"]);

    const pending = await ensureCandidate({ slug: "pend", name: "Sem Confirmar", headline: "Sênior" });
    await setVisibility(pending, "recruiters");
    await confirmedSkill(pending, "React", "detected");
    expect(names(await search({ q: "senior react" }))).not.toContain("Sem Confirmar");

    const bare = await ensureCandidate({ slug: "bare", name: "Zuleica Sem Headline" });
    await setVisibility(bare, "public");
    expect(names(await search({ q: "zuleica" }))).toEqual(["Zuleica Sem Headline"]);
    expect(names(await search({ q: "zuleica backend" }))).toEqual([]);
  });

  it.each(["31337", "zebracorn", "quokkaword", "rita@x.test"])(
    "IT-149 '%s' (piso, nota, CV ou e-mail) não casa ninguém",
    async (q) => {
      expect((await search({ q })).total).toBe(0);
    },
  );

  it("IT-149 campo que a lista de permissão esvazia (contato no texto) não casa: nem headline, nem nome, nem localização", async () => {
    await db
      .update(candidate)
      .set({ headline: "Fale comigo 11 91234-5678 ana@corp-secreta.example" })
      .where(eq(candidate.id, rita));
    expect((await allowlistedProfile({ id: rita }, DIRECTORY_VISIBILITIES))?.headline).toBeNull();
    for (const q of ["91234-5678", "corp-secreta.example", "fale comigo"]) {
      expect((await search({ q })).total, q).toBe(0);
    }
    // O que o cartão mostra continua casando.
    expect(names(await search({ q: "rita react" }))).toEqual(["Rita Recrutadores"]);

    const hidden = await ensureCandidate({
      slug: "tania",
      name: "Tânia (11) 3456-7890",
      location: "Curitiba · tania@corp-secreta.example",
    });
    await setVisibility(hidden, "recruiters");
    const profile = await allowlistedProfile({ id: hidden }, DIRECTORY_VISIBILITIES);
    expect(profile?.name).toBe("");
    expect(profile?.location).toBeNull();
    for (const q of ["3456-7890", "tania"]) expect((await search({ q })).total, q).toBe(0);
    for (const location of ["corp-secreta", "curitiba"]) expect((await search({ location })).total, location).toBe(0);
    // Sem texto nem localização, o perfil continua listado — só não casa pelo que esconde.
    expect((await search({})).cards.map((card) => card.id)).toContain(hidden);
  });

  it("IT-150 'Pedro Privado' não acha, nem para quem tem concessão dele", async () => {
    expect((await search({ q: "Pedro Privado" })).total).toBe(0);
    expect((await search({ q: "pedro" })).cards).toEqual([]);
    // A concessão não muda o diretório: a busca não recebe sessão nenhuma.
    expect(names(await search({}))).toEqual(["Paula Pública", "Rita Recrutadores"]);
  });

  it("IT-151 remoto só com opt-in; 'porto' casa Porto Alegre", async () => {
    expect(names(await search({ workModel: "remote" }))).toEqual(["Paula Pública"]);
    expect(names(await search({ location: "porto" }))).toEqual(["Paula Pública"]);
    expect(names(await search({ location: "sao paulo" }))).toEqual(["Rita Recrutadores"]);
    expect(names(await search({ location: "%" }))).toEqual([]);
  });

  it("IT-152 visibility=private e fields=salaryFloor dão o mesmo resultado que nada", async () => {
    const forged = await searchDirectory(parseDirectoryQuery({ visibility: "private", fields: "salaryFloor" }));
    expect(forged).toEqual(await search({}));
    expect(names(forged)).not.toContain("Pedro Privado");
  });

  it("IT-153 página 99 com 45 resultados vira a 3; sem resultado, nada e nenhuma contagem", async () => {
    for (let i = 0; i < 43; i++) {
      const id = await ensureCandidate({ slug: `mais-${i}`, name: `Mais ${i}` });
      await setVisibility(id, "recruiters");
    }
    const last = await search({ page: "99" });
    expect(last).toMatchObject({ total: 45, page: 3, pageCount: 3 });
    expect(last.cards).toHaveLength(5);
    expect(await search({ q: "inexistentexyz" })).toEqual({ cards: [], total: 0, page: 1, pageCount: 1 });
    expect(await search({ q: "<script>" })).toEqual({ cards: [], total: 0, page: 1, pageCount: 1 });
  });

  it("IT-158 Rita com consentimento: cv = publicCvMarkdown; sem ele, nenhum", async () => {
    const content = "# Rita\n\nBackend sênior.\nrita@x.test · (11) 3456-7890\nPretensão salarial: USD 9,000";
    await saveDocument({ candidateId: rita, kind: "cv", label: "CV 2", content });
    expect((await allowlistedProfile({ id: rita }, DIRECTORY_VISIBILITIES))?.cv).toBeNull();
    await setPublicCv(rita, true);
    const cv = (await allowlistedProfile({ id: rita }, DIRECTORY_VISIBILITIES))?.cv;
    expect(cv).toBe(publicCvMarkdown(content, { emails: ["rita@x.test"] }));
    for (const sentinel of ["rita@x.test", "3456-7890", "9,000"]) expect(cv, sentinel).not.toContain(sentinel);
  });

  it("IT-164 conta recrutador e candidata com perfil Privado não se acha; em Recrutadores, sim", async () => {
    const own = await ensureCandidate({ slug: "dupla", name: "Dupla Função" });
    await createUser({ email: "dupla@x.test", fullName: "Dupla", roles: ["recruiter", "candidate"], candidateId: own });
    expect(names(await search({ q: "dupla" }))).toEqual([]);
    await setVisibility(own, "recruiters");
    expect(names(await search({ q: "dupla" }))).toEqual(["Dupla Função"]);
  });

  it("IT-165 instalação só com Privados: vazio, sem contagem", async () => {
    await setVisibility(paula, "private");
    await setVisibility(rita, "private");
    expect(await search({})).toEqual({ cards: [], total: 0, page: 1, pageCount: 1 });
  });

  it("o e-mail da conta ligada também sai do texto, não só o do candidato", async () => {
    await createUser({ email: "rita.conta@x.test", fullName: "Rita", roles: ["candidate"], candidateId: rita });
    await db.update(candidate).set({ headline: "Fale com rita.conta@intranet" }).where(eq(candidate.id, rita));
    await db.update(authUser).set({ email: "rita.conta@intranet" }).where(eq(authUser.candidateId, rita));
    expect((await allowlistedProfile({ id: rita }, DIRECTORY_VISIBILITIES))?.headline).toBeNull();
  });
});

describe("visibilidade decide na requisição seguinte", () => {
  it("IT-155 Rita vai a Privado e volta; três trocas seguidas, cada uma refletida", async () => {
    await setVisibility(rita, "private");
    expect(names(await search({}))).not.toContain("Rita Recrutadores");
    expect(await allowlistedProfile({ id: rita }, DIRECTORY_VISIBILITIES)).toBeNull();

    await setVisibility(rita, "recruiters");
    expect(names(await search({}))).toContain("Rita Recrutadores");

    for (const [visibility, listed] of [["public", true], ["private", false], ["recruiters", true]] as const) {
      await setVisibility(rita, visibility);
      expect(names(await search({})).includes("Rita Recrutadores"), visibility).toBe(listed);
    }
  });
});

describe("limite por recrutador", () => {
  async function recruiter(): Promise<number> {
    const created = await createUser({ email: "rui@x.test", fullName: "Rui", roles: ["recruiter"], candidateId: null });
    const [row] = await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, "rui@x.test"));
    return created && row ? row.id : 0;
  }

  it("IT-154 60 passam, a 61ª não; depois da janela volta; 5 simultâneas em 58 → no máximo 2", async () => {
    const rui = await recruiter();
    const t0 = Date.parse("2026-10-06T12:00:00Z");
    const at = (ms: number) => new Date(t0 + ms).toISOString();
    for (let i = 0; i < 60; i++) expect((await recordDirectorySearch(rui, at(i * 1000))).ok, `busca ${i + 1}`).toBe(true);
    expect((await recordDirectorySearch(rui, at(61_000))).ok).toBe(false);
    expect((await recordDirectorySearch(rui, at(61_000 + DIRECTORY_RATE_WINDOW_MS + 1))).ok).toBe(true);

    await db.delete(recruiterDirectoryQuery);
    const t1 = t0 + 3_600_000;
    for (let i = 0; i < 58; i++) await recordDirectorySearch(rui, new Date(t1 + i).toISOString());
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => recordDirectorySearch(rui, new Date(t1 + 1000).toISOString())),
    );
    expect(concurrent.filter((decision) => decision.ok).length).toBeLessThanOrEqual(2);
  });

  it("a linha do limite não guarda texto da busca nem candidato", async () => {
    const rui = await recruiter();
    await recordDirectorySearch(rui, new Date().toISOString());
    const [row] = await db.select().from(recruiterDirectoryQuery);
    expect(Object.keys(row!).sort()).toEqual(["at", "id", "recruiterUserId"]);
  });
});
