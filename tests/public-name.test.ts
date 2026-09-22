import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addUser } from "../src/contexts/auth/app/accounts.ts";
import { seedOwner } from "../src/contexts/auth/app/seed.ts";
import {
  ensureCandidate,
  getCandidateById,
  setPublicSlug,
  setVisibility,
} from "../src/core/candidate.ts";
import { initialCandidateName, parseOwnProfile, parsePublicName } from "../src/core/candidate-identity.ts";
import { publicProfile } from "../src/core/candidate-public.ts";
import { containsContact } from "../src/core/public-cv.ts";
import type { DB } from "../src/core/db/client.ts";
import { authUser, candidate } from "../src/core/db/schema.ts";
import { en } from "../src/core/i18n/en.ts";
import { ptBR } from "../src/core/i18n/pt-BR.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * BUG-20260922-public-profile-shows-email-as-name.
 *
 * `jho auth add-user` criava o candidato próprio com o e-mail como nome, e
 * `/p/<endereço>` publicava esse nome como título, para qualquer visitante. A
 * correção tem três camadas, e cada uma é provada aqui sem depender das outras:
 * a origem não grava e-mail como nome; a saída de `/p/` descarta o campo que
 * parece e-mail ou telefone, venha de onde vier; e a pessoa corrige o nome em
 * `/candidate`. A migration 0014 limpa o que a 1.22.0 já gravou.
 */
const state = vi.hoisted(() => ({ candidateId: null as number | null, guarded: 0 }));

vi.mock("../app/auth", () => ({
  guard: async () => {
    throw new Error("não usado aqui");
  },
  guardOwnCandidate: async () => {
    state.guarded += 1;
    if (state.candidateId === null) throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
    return { session: {}, candidateId: state.candidateId };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { setPublicNameAction } = await import("../app/candidate/actions.ts");

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
  state.candidateId = null;
  state.guarded = 0;
});

afterEach(async () => {
  await releaseTestDb();
});

function nameForm(name: string): FormData {
  const data = new FormData();
  data.set("name", name);
  return data;
}

describe("containsContact", () => {
  it("reconhece e-mail, o e-mail conhecido e telefone", () => {
    expect(containsContact("pia@local.test")).toBe(true);
    expect(containsContact("Pia <pia@local.test>")).toBe(true);
    expect(containsContact("PIA@LOCAL.TEST", { emails: ["pia@local.test"] })).toBe(true);
    expect(containsContact("+55 11 91234-5678")).toBe(true);
    expect(containsContact("(11) 91234-5678")).toBe(true);
    expect(containsContact("11912345678")).toBe(true);
  });

  it("deixa nome, headline e localização comuns", () => {
    for (const ok of ["Pia Lopes", "Maria da Silva", "São Paulo, Brasil", "Staff Engineer · 2004-2024", "20+ anos"]) {
      expect(containsContact(ok), ok).toBe(false);
    }
  });
});

describe("nome publicável", () => {
  it("recusa e-mail e telefone como nome, com a razão", () => {
    expect(parsePublicName("pia@local.test")).toEqual({ ok: false, code: "nameContact" });
    expect(parsePublicName("+55 11 91234-5678")).toEqual({ ok: false, code: "nameContact" });
    expect(parsePublicName("   ")).toEqual({ ok: false, code: "nameRequired" });
    expect(parsePublicName("  Pia Lopes ")).toEqual({ ok: true, name: "Pia Lopes" });
    expect(parseOwnProfile({ name: "pia@local.test" })).toEqual({ ok: false, code: "nameContact" });
  });

  it("o nome inicial é o de exibição da conta, e nunca um e-mail", () => {
    expect(initialCandidateName("Pia Lopes")).toBe("Pia Lopes");
    expect(initialCandidateName(null)).toBe("");
    expect(initialCandidateName("pia@local.test")).toBe("");
  });
});

describe("conta criada por `jho auth add-user`", () => {
  it("add-user → público → /p/<endereço> não contém o e-mail", async () => {
    await seedOwner({ email: "dono@local.test" });
    const { candidateId } = await addUser({ email: "Pia@Local.Test", roles: ["candidate"] });

    const row = await getCandidateById(candidateId!);
    expect(row!.name).toBe("");
    expect(row!.name).not.toContain("@");

    expect(await setPublicSlug(candidateId!, "pia-qa")).toMatchObject({ ok: true });
    await setVisibility(candidateId!, "public");
    const profile = await publicProfile("pia-qa");

    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("");
    expect(JSON.stringify(profile).toLowerCase()).not.toContain("pia@local.test");
  });

  it("conta que já tem nome de exibição dá esse nome ao candidato", async () => {
    await seedOwner({ email: "dono@local.test" });
    await db.insert(authUser).values({ email: "nina@local.test", fullName: "Nina Prado", roles: ["recruiter"] });

    const { candidateId } = await addUser({ email: "nina@local.test", roles: ["candidate"] });

    expect((await getCandidateById(candidateId!))!.name).toBe("Nina Prado");
  });
});

describe("/p/ descarta campo com contato, venha de onde vier", () => {
  it("nome, headline e localização com e-mail ou telefone saem vazios", async () => {
    const id = await ensureCandidate({
      slug: "gravado-por-fora",
      name: "contato@exemplo.test",
      headline: "Ligue +55 11 91234-5678",
      location: "São Paulo",
    });
    await setVisibility(id, "public");

    const profile = await publicProfile("gravado-por-fora");

    expect(profile).toMatchObject({ name: "", headline: null, location: "São Paulo" });
    const out = JSON.stringify(profile);
    expect(out).not.toContain("contato@exemplo.test");
    expect(out).not.toContain("91234");
  });

  it("o e-mail da conta dona também sai do texto do currículo publicado", async () => {
    await seedOwner({ email: "dono@local.test" });
    const { candidateId } = await addUser({ email: "estranho+tag@local.test", roles: ["candidate"] });
    await db.update(candidate).set({ name: "Estranho", publicCv: true }).where(eq(candidate.id, candidateId!));
    await setPublicSlug(candidateId!, "estranho");
    await setVisibility(candidateId!, "public");
    const { saveDocument } = await import("../src/core/candidate.ts");
    await saveDocument({
      candidateId: candidateId!,
      label: "CV",
      content: `Estranho\n\nContato: estranho+tag@local.test\n\n${"Experiência em plataforma. ".repeat(6)}`,
    });

    const profile = await publicProfile("estranho");

    expect(profile!.name).toBe("Estranho");
    expect(profile!.cv).not.toContain("estranho+tag@local.test");
  });
});

describe("nome editável em /candidate", () => {
  it("a guarda vem antes de qualquer efeito", async () => {
    await expect(setPublicNameAction(nameForm("Pia Lopes"))).rejects.toThrow(/403/);
    expect(state.guarded).toBe(1);
  });

  it("recusa e-mail sem gravar, e grava o nome escolhido", async () => {
    const id = await ensureCandidate({ slug: "pia", name: "" });
    await setVisibility(id, "public");
    state.candidateId = id;

    expect(await setPublicNameAction(nameForm("pia@local.test"))).toEqual({ ok: false, code: "nameContact" });
    expect((await getCandidateById(id))!.name).toBe("");

    expect(await setPublicNameAction(nameForm("  Pia Lopes "))).toEqual({ ok: true });
    expect((await getCandidateById(id))!.name).toBe("Pia Lopes");
    expect((await publicProfile("pia"))!.name).toBe("Pia Lopes");
  });
});

describe("migração 0014: nome que é e-mail volta a ficar vazio", () => {
  it("limpa o igual ao e-mail da conta e o com forma de e-mail, só esses, e é idempotente", async () => {
    const [cli, dono, legado, proprio, igual] = await db
      .insert(candidate)
      .values([
        { slug: "user-pia-local-test", name: "pia@local.test" },
        { slug: "default", name: "Andreus Timm", isDefault: true },
        { slug: "legado", name: "Contato: ana@exemplo.test" },
        { slug: "com-email-proprio", name: "Estranho", email: "estranho@exemplo.test" },
        { slug: "nome-igual-ao-email", name: "Handle", email: "handle" },
      ])
      .returning({ id: candidate.id });
    await db.insert(authUser).values([
      { email: "pia@local.test", roles: ["candidate"], candidateId: cli!.id },
      { email: "dono@local.test", roles: ["admin", "candidate"], candidateId: dono!.id },
    ]);
    // Sem forma de e-mail, mas igual ao e-mail da conta dona.
    const [odd] = await db
      .insert(candidate)
      .values({ slug: "user-odd", name: "Odd.Handle" })
      .returning({ id: candidate.id });
    await db.insert(authUser).values({ email: "odd.handle", roles: ["candidate"], candidateId: odd!.id });

    const migration = readFileSync("drizzle/postgres/0014_clear_contact_candidate_names.sql", "utf8");
    await db.execute(sql.raw(migration));
    await db.execute(sql.raw(migration));

    const names = Object.fromEntries(
      (await db.select({ id: candidate.id, name: candidate.name }).from(candidate)).map((r) => [r.id, r.name]),
    );
    expect(names[cli!.id]).toBe("");
    expect(names[dono!.id]).toBe("Andreus Timm");
    expect(names[legado!.id]).toBe("");
    expect(names[odd!.id]).toBe("");
    expect(names[proprio!.id]).toBe("Estranho");
    expect(names[igual!.id]).toBe("");
  });
});

describe("recusas pela tela chegam ao domínio", () => {
  it("o campo de endereço não corta nem barra pelo tamanho", () => {
    // `maxlength` cortava 41 caracteres para 40 e salvava; `minlength` barrava
    // `ab` no navegador e deixava à vista o aviso anterior. Quem recusa é
    // `validatePublicSlug`, com a mensagem de tamanho.
    for (const file of ["app/candidate/public-address.tsx", "app/candidate/create-profile.tsx"]) {
      const source = readFileSync(file, "utf8");
      const input = source.slice(source.indexOf('name="publicSlug"') - 200, source.indexOf('name="publicSlug"') + 600);
      expect(input, file).not.toMatch(/maxLength=|minLength=/);
    }
    const nameCard = readFileSync("app/candidate/public-name.tsx", "utf8");
    expect(nameCard).not.toMatch(/maxLength=|minLength=/);
  });
});

describe("orientação de senha em /admin/users", () => {
  it("cita o comando que existe", () => {
    for (const dict of [ptBR, en]) {
      expect(dict.admin.noPasswordHint).toContain("jho auth set-password");
      expect(dict.admin.noPasswordHint).not.toMatch(/jho auth password\b/);
    }
  });
});
