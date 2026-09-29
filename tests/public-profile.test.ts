import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { candidate, candidateDocument, candidateSkill, skill } from "../src/core/db/schema.ts";
import {
  ensureCandidate,
  saveDocument,
  setPublicCv,
  setVisibility,
} from "../src/core/candidate.ts";
import { publicProfile } from "../src/core/candidate-public.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * O perfil público é a única coisa deste sistema que responde sem sessão.
 *
 * Estes testes existem em dois grupos, e o segundo é o que importa: o que a
 * página MOSTRA pode ser corrigido depois; o que ela VAZA não tem desfazer.
 * Estão no mesmo espírito dos testes que afirmam que a chave de API não sai no
 * log e que o servidor não escuta em 0.0.0.0.
 */

let db: DB;
let candidateId: number;

const CV = "# Andreus Timm\n\nSenior AI Software Architect.\n\nPiso: 180000 USD/ano.";

beforeEach(async () => {
  db = await useTestDb();
  candidateId = await ensureCandidate({
    slug: "andreus",
    name: "Andreus Timm",
    headline: "Senior AI Software Architect",
    location: "São Paulo, Brazil",
    email: "andreus@zorbit.com.br",
    linkedinUrl: "https://linkedin.com/in/andreus",
    githubUrl: "https://github.com/andreus",
  });
  await saveDocument({ candidateId, kind: "cv", label: "CV", content: CV });
});

afterEach(async () => {
  await releaseTestDb();
});

async function confirmarSkill(
  name: string,
  status = "confirmed",
  opts: { category?: string; level?: string; occurrences?: number } = {},
) {
  const category = opts.category ?? "ai";
  const [row] = await db
    .insert(skill)
    .values({ slug: `${name.toLowerCase()}-${category}`, canonicalName: name, category, aliases: [] })
    .returning({ id: skill.id });
  await db
    .insert(candidateSkill)
    .values({ candidateId, skillId: row!.id, status, level: opts.level, occurrences: opts.occurrences ?? 1 });
}

describe("quem alcança o perfil", () => {
  it("privado não existe para o mundo", async () => {
    // 404 e não 403: 403 confirmaria que o slug existe, e existência é
    // informação — quem varre uma lista de nomes aprende quais estão
    // cadastrados. `null` aqui é o que a página traduz em 404.
    expect(await publicProfile("andreus")).toBeNull();
  });

  it("`recruiters` também não abre para anônimo", async () => {
    // Aberto a recrutador AUTENTICADO é outra coisa. Confundir os dois seria
    // publicar por engano o perfil de quem escolheu o meio-termo.
    await setVisibility(candidateId, "recruiters");
    expect(await publicProfile("andreus")).toBeNull();
  });

  it("público responde", async () => {
    await setVisibility(candidateId, "public");
    expect((await publicProfile("andreus"))?.name).toBe("Andreus Timm");
  });

  it("slug inexistente devolve o mesmo null de perfil privado", async () => {
    await setVisibility(candidateId, "public");
    expect(await publicProfile("nao-existe")).toBeNull();
  });
});

describe("o que NUNCA sai", () => {
  beforeEach(async () => {
    await setVisibility(candidateId, "public");
    await setPublicCv(candidateId, true);
  });

  it("nem e-mail, nem id, nem qualquer campo fora da lista", async () => {
    const profile = await publicProfile("andreus");
    const chaves = Object.keys(profile!).sort();

    // Lista de permissão afirmada como IGUALDADE, não como "não contém".
    // "Não contém e-mail" passaria com um campo novo que ninguém previu; o
    // conjunto exato falha na hora em que alguém acrescenta coluna ao schema —
    // que é exatamente quando se quer ser avisado.
    expect(chaves).toEqual([
      "cv",
      "facts",
      "githubUrl",
      "headline",
      "images",
      "linkedinUrl",
      "location",
      "name",
      "skills",
      "slug",
    ]);
    // #327: foto e capa saem só como versão opaca, nunca chave nem URL.
    expect(Object.keys(profile!.images).sort()).toEqual(["cover", "photo"]);
    // #327: `facts` também é lista de permissão, com as sete chaves exatas.
    expect(Object.keys(profile!.facts).sort()).toEqual([
      "area",
      "availability",
      "experienceLevel",
      "languages",
      "openToRelocation",
      "startTimeframe",
      "workModel",
    ]);
  });

  it("o e-mail não aparece nem serializado", async () => {
    // O registro do candidato TEM e-mail; a função é que não o carrega.
    const serializado = JSON.stringify(await publicProfile("andreus"));
    expect(serializado).not.toContain("andreus@zorbit.com.br");
    expect(serializado).not.toContain("@zorbit");
  });

  it("skill detectada e rejeitada não vira skill publicada", async () => {
    // "Detectada" é o que o sistema achou no texto. Publicar isso como fato
    // afirmaria experiência que ninguém conferiu — regra 6.
    await confirmarSkill("LangGraph", "confirmed");
    await confirmarSkill("Kubernetes", "detected");
    await confirmarSkill("Scala", "rejected");

    const skills = (await publicProfile("andreus"))?.skills;
    expect(skills?.map((s) => s.name)).toEqual(["LangGraph"]);
  });

  it("#326 category, level e occurrences entram na lista de permissão da skill", async () => {
    await confirmarSkill("Go", "confirmed", { category: "language", level: "expert", occurrences: 4 });
    const [skillOut] = (await publicProfile("andreus"))?.skills ?? [];
    // Igualdade exata: um campo novo na linha (ex.: `auditedBy`) tem que
    // aparecer aqui para ser notado, não vazar por composição de objeto.
    expect(skillOut).toEqual({ name: "Go", category: "language", level: "expert", occurrences: 4 });
  });

  it("#326 skill confirmada sem `level` sai com `null`, não `undefined`", async () => {
    await confirmarSkill("Rust", "confirmed", { category: "language" });
    const [skillOut] = (await publicProfile("andreus"))?.skills ?? [];
    expect(skillOut?.level).toBeNull();
  });

  it("#326 e-mail escrito no `level` de uma skill esvazia a skill inteira, não só o campo", async () => {
    await confirmarSkill("Go", "confirmed", { category: "language", level: "contate andreus@zorbit.com.br" });
    await confirmarSkill("Rust", "confirmed", { category: "language", level: "expert" });
    const skills = (await publicProfile("andreus"))?.skills ?? [];
    expect(skills.map((s) => s.name)).toEqual(["Rust"]);
    expect(JSON.stringify(skills)).not.toContain("@zorbit");
  });

  it("#326 e-mail no PRÓPRIO NOME da skill esvazia a skill inteira", async () => {
    // Improvável no catálogo real, mas a lista de permissão confere o VALOR,
    // não só a coluna (mesma razão do nome do candidato na 1.22.0) — se um dia
    // um nome de skill chegar com contato colado, o filtro não pode confiar em
    // "isso é sempre um nome de tecnologia".
    await confirmarSkill("contate andreus@zorbit.com.br", "confirmed", { category: "language" });
    await confirmarSkill("Rust", "confirmed", { category: "language" });
    const skills = (await publicProfile("andreus"))?.skills ?? [];
    expect(skills.map((s) => s.name)).toEqual(["Rust"]);
    expect(JSON.stringify(skills)).not.toContain("@zorbit");
  });

  it("#326 e-mail na CATEGORIA da skill esvazia a skill inteira", async () => {
    await confirmarSkill("Go", "confirmed", { category: "contate andreus@zorbit.com.br" });
    await confirmarSkill("Rust", "confirmed", { category: "language" });
    const skills = (await publicProfile("andreus"))?.skills ?? [];
    expect(skills.map((s) => s.name)).toEqual(["Rust"]);
    expect(JSON.stringify(skills)).not.toContain("@zorbit");
  });
});

describe("#327 fatos opt-in", () => {
  // Os sete valores gravados. Os opt-ins ficam fora: cada teste decide.
  const VALUES = {
    workModel: ["remote", "b2b"],
    experienceLevel: "principal",
    availability: "open",
    startTimeframe: "one-month",
    openToRelocation: true,
    area: "Arquitetura de software e IA",
    languages: "Português (nativo), Inglês (fluente)",
  };
  const ALL_ON = {
    publicWorkModel: true,
    publicExperienceLevel: true,
    publicAvailability: true,
    publicStartTimeframe: true,
    publicRelocation: true,
    publicArea: true,
    publicLanguages: true,
  };

  it("T11 candidato novo nasce com os sete opt-ins desligados e os valores nulos", async () => {
    const [row] = await db.select().from(candidate).where(eq(candidate.id, candidateId));
    expect(row).toMatchObject({
      workModel: null,
      experienceLevel: null,
      availability: null,
      startTimeframe: null,
      openToRelocation: null,
      area: null,
      languages: null,
      publicWorkModel: false,
      publicExperienceLevel: false,
      publicAvailability: false,
      publicStartTimeframe: false,
      publicRelocation: false,
      publicArea: false,
      publicLanguages: false,
    });
  });

  it("T13 valores gravados com opt-in desligado não saem, nem serializados", async () => {
    await db.update(candidate).set(VALUES).where(eq(candidate.id, candidateId));
    await setVisibility(candidateId, "public");

    const profile = await publicProfile("andreus");
    expect(profile?.facts).toEqual({
      workModel: [],
      experienceLevel: null,
      availability: null,
      startTimeframe: null,
      openToRelocation: null,
      area: null,
      languages: null,
    });
    const serializado = JSON.stringify(profile);
    for (const sentinel of ['"b2b"', '"principal"', '"one-month"', "Arquitetura de software", "Português (nativo)"]) {
      expect(serializado, sentinel).not.toContain(sentinel);
    }
  });

  it("T14 com o opt-in ligado, os sete saem", async () => {
    await db.update(candidate).set({ ...VALUES, ...ALL_ON }).where(eq(candidate.id, candidateId));
    await setVisibility(candidateId, "public");

    expect((await publicProfile("andreus"))?.facts).toEqual(VALUES);
  });

  it("T15 pretensão salarial nunca: nenhuma chave a nomeia, e texto de piso gravado direto não sai", async () => {
    // Gravado por fora da action (que recusaria) e com o opt-in LIGADO: a
    // saída é quem garante, venha o dado de onde vier.
    await db
      .update(candidate)
      .set({
        ...VALUES,
        ...ALL_ON,
        area: "Pretensão salarial: USD 15,000/month",
        languages: "Inglês · salário: R$ 30.000",
      })
      .where(eq(candidate.id, candidateId));
    await setVisibility(candidateId, "public");
    await setPublicCv(candidateId, true);

    const profile = await publicProfile("andreus");
    expect(profile?.facts.area).toBeNull();
    expect(profile?.facts.languages).toBeNull();

    const keys: string[] = [];
    const walk = (value: unknown) => {
      if (value === null || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        keys.push(key);
        walk(child);
      }
    };
    walk(profile);
    expect(keys.filter((key) => /salar|floor|piso|pretens|compensation|remunera|pay|rate/i.test(key))).toEqual([]);

    const serializado = JSON.stringify(profile);
    for (const sentinel of ["15,000", "30.000", "180000", "Pretensão", "salário"]) {
      expect(serializado, sentinel).not.toContain(sentinel);
    }
  });

  it("T15 contato no texto livre, inclusive o e-mail cadastrado, esvazia só aquele fato", async () => {
    await db
      .update(candidate)
      .set({ ...VALUES, ...ALL_ON, area: "IA — andreus@zorbit.com.br" })
      .where(eq(candidate.id, candidateId));
    await setVisibility(candidateId, "public");

    const facts = (await publicProfile("andreus"))?.facts;
    expect(facts?.area).toBeNull();
    expect(facts?.languages).toBe(VALUES.languages);
    expect(JSON.stringify(facts)).not.toContain("@zorbit");
  });

  it("T16 perfil não público com todos os opt-ins ligados continua null (404)", async () => {
    await db.update(candidate).set({ ...VALUES, ...ALL_ON }).where(eq(candidate.id, candidateId));
    expect(await publicProfile("andreus")).toBeNull();
    await setVisibility(candidateId, "recruiters");
    expect(await publicProfile("andreus")).toBeNull();
  });
});

describe("o currículo exige o segundo consentimento", () => {
  it("perfil público sem o segundo consentimento não traz o CV", async () => {
    await setVisibility(candidateId, "public");

    // Marcar "público" diz alcançável sem sessão. Publicar o currículo inteiro
    // é outra decisão, e derivá-la da primeira é como se publica um CV sem
    // querer — inclusive o piso salarial que ele costuma conter, que é a
    // posição de negociação do candidato.
    const profile = await publicProfile("andreus");
    expect(profile?.cv).toBeNull();
    expect(JSON.stringify(profile)).not.toContain("180000");
  });

  it("com os dois consentimentos, traz", async () => {
    await setVisibility(candidateId, "public");
    await setPublicCv(candidateId, true);
    expect((await publicProfile("andreus"))?.cv).toContain("Senior AI Software Architect");
  });

  it("V03-04 com os dois consentimentos, o piso escrito no CV continua fora", async () => {
    // A fixture TEM "Piso: 180000 USD/ano". O teste anterior só exigia a
    // frase profissional e deixava o piso passar: o consentimento do CV
    // publicava a posição de negociação que o perfil público promete não
    // publicar nunca.
    await setVisibility(candidateId, "public");
    await setPublicCv(candidateId, true);
    const profile = await publicProfile("andreus");
    expect(profile?.cv).toContain("Senior AI Software Architect");
    expect(JSON.stringify(profile)).not.toContain("180000");
    expect(profile?.cv).not.toMatch(/piso/i);
  });

  it("V03-04 e-mail e telefone escritos no CV não saem, nem o e-mail cadastrado", async () => {
    await saveDocument({
      candidateId,
      kind: "cv",
      label: "CV com contatos",
      content: [
        "# Andreus Timm",
        "Contato: andreus@zorbit.com.br · +55 11 91234-5678 · (11) 3456-7890",
        "Alternativo: outro.endereco@example.test",
        "",
        "Senior AI Software Architect, 2015-2020 e 2020-2026.",
        "",
        "Salary expectation: USD 15,000/month",
      ].join("\n"),
    });
    await setVisibility(candidateId, "public");
    await setPublicCv(candidateId, true);

    const cv = (await publicProfile("andreus"))?.cv ?? "";
    for (const sentinel of [
      "andreus@zorbit.com.br",
      "@zorbit",
      "outro.endereco@example.test",
      "91234-5678",
      "3456-7890",
      "15,000",
    ]) {
      expect(cv, sentinel).not.toContain(sentinel);
    }
    // O que é currículo continua: anos não são telefone.
    expect(cv).toContain("Senior AI Software Architect, 2015-2020 e 2020-2026.");
  });

  it("V03-04 o e-mail cadastrado sai do CV mesmo fora do padrão geral de endereço", async () => {
    // Endereço sem domínio de primeiro nível não casa com o padrão genérico;
    // só a composição que passa o e-mail cadastrado o encontra.
    await db.update(candidate).set({ email: "andreus@intranet" }).where(eq(candidate.id, candidateId));
    await saveDocument({ candidateId, kind: "cv", label: "CV", content: "# Andreus\n\nContato interno: andreus@intranet" });
    await setVisibility(candidateId, "public");
    await setPublicCv(candidateId, true);
    expect((await publicProfile("andreus"))?.cv).not.toContain("andreus@intranet");
  });

  it("#325 CV importado de PDF sai estruturado, e a estrutura não reabre o filtro", async () => {
    await saveDocument({
      candidateId,
      kind: "cv",
      label: "CV do PDF",
      format: "text",
      content: [
        "ANDREUS TIMM",
        "andreus@zorbit.com.br · +55 11 91234-5678",
        "SUMMARY",
        "Senior AI Software Architect.",
        "CORE EXPERTISE",
        "● Software architecture ● Event-driven systems",
        "",
        "PRETENSÃO SALARIAL",
        "USD 15,000/month",
        "",
        "EDUCATION",
        "B.Sc. Computer Science",
      ].join("\n"),
    });
    await setVisibility(candidateId, "public");
    await setPublicCv(candidateId, true);

    const cv = (await publicProfile("andreus"))?.cv ?? "";
    expect(cv).toContain("## SUMMARY");
    expect(cv).toContain("- Software architecture\n- Event-driven systems");
    expect(cv).toContain("## EDUCATION");
    for (const sentinel of ["andreus@zorbit.com.br", "91234-5678", "15,000", "PRETENSÃO"]) {
      expect(cv, sentinel).not.toContain(sentinel);
    }
    // Nada é regravado: a normalização acontece na leitura.
    const [doc] = await db
      .select({ content: candidateDocument.content })
      .from(candidateDocument)
      .where(and(eq(candidateDocument.candidateId, candidateId), eq(candidateDocument.isCurrent, true)));
    expect(doc!.content).toContain("● Software architecture");
  });

  it("o consentimento do CV não vale nada sem o perfil ser público", async () => {
    // Ordem invertida: quem marcou o CV e depois voltou para privado não pode
    // ficar com o consentimento pendurado, pronto para reabrir sozinho.
    await setPublicCv(candidateId, true);
    await setVisibility(candidateId, "private");
    expect(await publicProfile("andreus")).toBeNull();
  });
});
