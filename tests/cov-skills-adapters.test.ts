import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import {
  candidate,
  candidateSkill,
  job,
  jobScore,
  skill,
  source,
} from "../src/core/db/schema.ts";
import {
  drizzleCandidateSkills,
  drizzleCatalog,
  drizzleTargetCorpus,
} from "../src/contexts/skills/infra/drizzle-adapters.ts";
import type { Detection, SkillDefinition } from "../src/contexts/skills/domain/types.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Os adapters de skills contra o schema real.
 *
 * Duas coisas só se provam com banco de verdade, e as duas são de segurança:
 *
 *  - **Escopo por candidato.** `candidate_skill` guarda o que o sistema afirma
 *    sobre a carreira de alguém. Toda consulta aqui recebe um `candidateId`
 *    vindo da sessão, e um `where` faltando não muda nada num teste com um
 *    candidato só — mas vaza o currículo inteiro do outro em produção.
 *  - **A auditoria escopada.** `audit` recebe o id da LINHA, que é sequencial
 *    e adivinhável. Se ele não cruzasse com o candidato, bastaria chutar
 *    números para confirmar ou rejeitar skills na conta de outra pessoa.
 */

let db: DB;
let candidatoA: number;
let candidatoB: number;

const CATALOGO: SkillDefinition[] = [
  { slug: "go", name: "Go", category: "language", aliases: ["golang"] },
  { slug: "kafka", name: "Kafka", category: "data", aliases: [] },
];

function detection(slug: string, over: Partial<Detection> = {}): Detection {
  const def = CATALOGO.find((c) => c.slug === slug)!;
  return {
    skill: def,
    mentions: [],
    occurrences: 3,
    confidence: 0.75,
    evidence: `Frase que menciona ${def.name}`,
    rationale: "usada em 1 bullet(s) de experiência",
    ...over,
  };
}

async function skillIdOf(slug: string): Promise<number> {
  const [row] = await db.select({ id: skill.id }).from(skill).where(eq(skill.slug, slug));
  return row!.id;
}

beforeEach(async () => {
  db = await useTestDb();
  const [a] = await db
    .insert(candidate)
    .values({ slug: "cand-a", name: "Candidato A" })
    .returning({ id: candidate.id });
  const [b] = await db
    .insert(candidate)
    .values({ slug: "cand-b", name: "Candidato B" })
    .returning({ id: candidate.id });
  candidatoA = a!.id;
  candidatoB = b!.id;
});

afterEach(() => releaseTestDb());

describe("drizzleCatalog", () => {
  it("insere o que falta, atualiza o que mudou e conta cada caso", async () => {
    const primeiro = await drizzleCatalog.sync(CATALOGO);
    expect(primeiro).toEqual({ inserted: 2, updated: 0 });

    const segundo = await drizzleCatalog.sync([
      { slug: "go", name: "Go (Golang)", category: "language", aliases: ["golang", "go-lang"] },
      { slug: "kafka", name: "Kafka", category: "data", aliases: [] },
      { slug: "rust", name: "Rust", category: "language", aliases: [] },
    ]);
    expect(segundo).toEqual({ inserted: 1, updated: 2 });

    const todas = await drizzleCatalog.all();
    expect(todas.find((s) => s.slug === "go")).toEqual({
      slug: "go",
      name: "Go (Golang)",
      category: "language",
      aliases: ["golang", "go-lang"],
    });
  });

  it("preserva a verificação humana atravessando um re-seed", async () => {
    // `verifiedAt` é estado de auditoria: alguém olhou aquela entrada do
    // catálogo e disse que está certa. Se o seed o apagasse, cada atualização
    // do catálogo jogaria fora o trabalho de curadoria em silêncio.
    await drizzleCatalog.sync(CATALOGO);
    await db.update(skill).set({ verifiedAt: "2026-01-01T00:00:00.000Z" }).where(eq(skill.slug, "go"));

    await drizzleCatalog.sync([{ slug: "go", name: "Go", category: "language", aliases: ["golang"] }]);

    const [row] = await db.select().from(skill).where(eq(skill.slug, "go"));
    expect(row!.verifiedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("recusa aliases corrompidos em vez de detectar com lixo", async () => {
    // A coluna é JSON livre. Se algo gravou um objeto ali, seguir em frente
    // faria o matcher receber `undefined` como termo — e termo inválido é o
    // caminho para detectar tudo em qualquer texto. Falhar alto é a resposta.
    await db.insert(skill).values({
      slug: "quebrada",
      canonicalName: "Quebrada",
      category: "tool",
      aliases: { nao: "e-lista" },
    });

    await expect(drizzleCatalog.all()).rejects.toThrow("Invalid skill aliases");
  });

  it("recusa categoria que não existe no domínio", async () => {
    // O parser é a fronteira entre a string do banco e a união do domínio.
    // Deixar passar "linguagem" espalharia o valor inválido por toda a
    // aplicação, e ele só apareceria como categoria em branco numa tela.
    await db.insert(skill).values({
      slug: "estranha",
      canonicalName: "Estranha",
      category: "linguagem",
      aliases: [],
    });

    await expect(drizzleCatalog.all()).rejects.toThrow("Unknown skill category");
  });

  it("catálogo vazio devolve lista vazia", async () => {
    await expect(drizzleCatalog.all()).resolves.toEqual([]);
  });
});

describe("drizzleCandidateSkills: escrita", () => {
  it("grava a detecção como 'detected', com evidência e justificativa juntas", async () => {
    // `detected` é carregado: o sistema afirma que ENCONTROU, nunca que a
    // pessoa TEM. Gravar já confirmado deixaria a máquina atribuindo
    // experiência sem ninguém ter olhado — exatamente o que a regra 7 proíbe.
    await drizzleCatalog.sync(CATALOGO);
    await drizzleCandidateSkills.add(candidatoA, detection("go"), "cv");

    const [row] = await db.select().from(candidateSkill);
    expect(row!.status).toBe("detected");
    expect(row!.auditedAt).toBeNull();
    expect(row!.auditedBy).toBeNull();
    expect(row!.occurrences).toBe(3);
    // A frase e o porquê viajam juntos: ninguém audita um número que não pode
    // interrogar.
    expect(row!.evidence).toContain("Frase que menciona Go");
    expect(row!.evidence).toContain("usada em 1 bullet(s)");
  });

  it("recusa gravar skill que não está no catálogo", async () => {
    // Sem entrada no catálogo não há nome canônico nem categoria — a linha
    // ficaria pendurada num id inexistente e a tela mostraria uma skill sem
    // nome. Falhar aqui é melhor que gravar órfã.
    await expect(drizzleCandidateSkills.add(candidatoA, detection("go"), "cv")).rejects.toThrow(
      'Skill catalogue entry "go" was not persisted',
    );
    await expect(drizzleCandidateSkills.refresh(candidatoA, detection("kafka"))).rejects.toThrow(
      'Skill catalogue entry "kafka" was not persisted',
    );
  });

  it("refresh atualiza evidência e contagem SEM tocar no status auditado", async () => {
    // O caso de uso já decide quem pode ser atualizado; o adapter não pode
    // desfazer isso por conta própria escrevendo `status` de volta.
    await drizzleCatalog.sync(CATALOGO);
    await drizzleCandidateSkills.add(candidatoA, detection("go"), "cv");
    await db.update(candidateSkill).set({ status: "confirmed", level: "avançado" });

    await drizzleCandidateSkills.refresh(
      candidatoA,
      detection("go", { occurrences: 9, evidence: "Nova frase" }),
    );

    const [row] = await db.select().from(candidateSkill);
    expect(row!.occurrences).toBe(9);
    expect(row!.evidence).toContain("Nova frase");
    expect(row!.status).toBe("confirmed");
    expect(row!.level).toBe("avançado");
  });

  it("refresh de um candidato não alcança a linha do outro", async () => {
    // Mesma skill, dois donos. Um `where` sem o candidato reescreveria a
    // evidência do currículo alheio com o texto deste aqui.
    await drizzleCatalog.sync(CATALOGO);
    await drizzleCandidateSkills.add(candidatoA, detection("go"), "cv");
    await drizzleCandidateSkills.add(candidatoB, detection("go", { evidence: "Frase do B" }), "cv");

    await drizzleCandidateSkills.refresh(candidatoA, detection("go", { evidence: "Frase do A" }));

    const doB = await drizzleCandidateSkills.list(candidatoB);
    expect(doB[0]!.evidence).toContain("Frase do B");
  });
});

describe("drizzleCandidateSkills: leitura", () => {
  it("existing e list só enxergam o candidato pedido", async () => {
    await drizzleCatalog.sync(CATALOGO);
    await drizzleCandidateSkills.add(candidatoA, detection("go"), "cv");
    await drizzleCandidateSkills.add(candidatoB, detection("kafka"), "manual");

    expect(await drizzleCandidateSkills.existing(candidatoA)).toEqual([
      { skillSlug: "go", status: "detected" },
    ]);
    expect((await drizzleCandidateSkills.list(candidatoB)).map((r) => r.slug)).toEqual(["kafka"]);
  });

  it("lista com o vocabulário do domínio, e o mais mencionado primeiro", async () => {
    // A ordem é por ocorrências porque a tela de auditoria quer o que tem mais
    // evidência no topo — é onde o humano gasta melhor os primeiros minutos.
    await drizzleCatalog.sync(CATALOGO);
    await drizzleCandidateSkills.add(candidatoA, detection("go", { occurrences: 2 }), "cv");
    await drizzleCandidateSkills.add(candidatoA, detection("kafka", { occurrences: 8 }), "profile");

    const linhas = await drizzleCandidateSkills.list(candidatoA);
    expect(linhas.map((l) => l.slug)).toEqual(["kafka", "go"]);
    expect(linhas[0]).toMatchObject({
      name: "Kafka",
      category: "data",
      status: "detected",
      source: "profile",
      level: null,
      auditedAt: null,
    });
  });

  it("candidato sem nenhuma skill recebe listas vazias", async () => {
    expect(await drizzleCandidateSkills.existing(candidatoA)).toEqual([]);
    expect(await drizzleCandidateSkills.list(candidatoA)).toEqual([]);
  });
});

describe("drizzleCandidateSkills: auditoria", () => {
  it("confirma a linha e carimba quem e quando", async () => {
    await drizzleCatalog.sync(CATALOGO);
    await drizzleCandidateSkills.add(candidatoA, detection("go"), "cv");
    const [linha] = await drizzleCandidateSkills.list(candidatoA);

    expect(
      await drizzleCandidateSkills.audit(candidatoA, linha!.id, "confirmed", {
        level: "avançado",
        by: "dono",
      }),
    ).toBe(true);

    const [depois] = await drizzleCandidateSkills.list(candidatoA);
    expect(depois).toMatchObject({ status: "confirmed", level: "avançado" });
    expect(depois!.auditedAt).toBeTruthy();
  });

  it("limpa o nível quando a auditoria não informa um", async () => {
    // Rejeitar tem de apagar o nível que uma confirmação anterior deixou. Um
    // nível órfão numa linha rejeitada seria citado por engano num tailoring.
    await drizzleCatalog.sync(CATALOGO);
    await drizzleCandidateSkills.add(candidatoA, detection("go"), "cv");
    const [linha] = await drizzleCandidateSkills.list(candidatoA);

    await drizzleCandidateSkills.audit(candidatoA, linha!.id, "confirmed", { level: "sênior", by: "dono" });
    await drizzleCandidateSkills.audit(candidatoA, linha!.id, "rejected", { by: "dono" });

    const [depois] = await drizzleCandidateSkills.list(candidatoA);
    expect(depois).toMatchObject({ status: "rejected", level: null });
  });

  it("RECUSA auditar a linha de outro candidato mesmo com o id certo", async () => {
    // O id da linha é sequencial e vem da URL. Sem o cruzamento com o
    // candidato da sessão, chutar números confirmaria ou rejeitaria skills na
    // conta de outra pessoa — escrita em dado alheio por adivinhação.
    await drizzleCatalog.sync(CATALOGO);
    await drizzleCandidateSkills.add(candidatoB, detection("go"), "cv");
    const [doB] = await drizzleCandidateSkills.list(candidatoB);

    expect(
      await drizzleCandidateSkills.audit(candidatoA, doB!.id, "confirmed", { by: "invasor" }),
    ).toBe(false);

    const [intacta] = await drizzleCandidateSkills.list(candidatoB);
    expect(intacta).toMatchObject({ status: "detected", auditedAt: null });
    const [linhaCrua] = await db.select().from(candidateSkill);
    expect(linhaCrua!.auditedBy).toBeNull();
  });

  it("devolve false para id que não existe, em vez de fingir sucesso", async () => {
    // O caso de uso transforma esse false em erro para o operador. Se o adapter
    // dissesse `true`, a tela mostraria "confirmado" sobre nada.
    expect(await drizzleCandidateSkills.audit(candidatoA, 4242, "confirmed", { by: "dono" })).toBe(false);
  });
});

describe("drizzleTargetCorpus", () => {
  const LONGA = "Descrição longa o suficiente para valer leitura. ".repeat(12);

  async function vaga(opts: {
    externalId: string;
    titulo: string;
    texto: string | null;
    fit: number;
    candidateId: number;
    fechada?: boolean;
  }): Promise<void> {
    await db
      .insert(source)
      .values({ id: "manual:corpus", kind: "manual", handle: "corpus", label: "Corpus" })
      .onConflictDoNothing({ target: source.id });
    const [posting] = await db
      .insert(job)
      .values({
        sourceId: "manual:corpus",
        companyName: "Empresa",
        externalId: opts.externalId,
        title: opts.titulo,
        descriptionText: opts.texto,
        url: `https://exemplo.test/${opts.externalId}`,
        fingerprint: `corpus-${opts.externalId}`,
        contentHash: `corpus-hash-${opts.externalId}`,
        closedAt: opts.fechada ? "2026-08-01T00:00:00.000Z" : null,
        raw: "{}",
      })
      .returning({ id: job.id });
    await db.insert(jobScore).values({
      candidateId: opts.candidateId,
      jobId: posting!.id,
      fit: opts.fit,
      titleScore: 0,
      keywordScore: 0,
      seniorityScore: 0,
      geoScore: 0,
      compScore: 0,
      cluster: "architect",
      matchedKeywords: [],
      missingKeywords: [],
      reasons: [],
      blockers: [],
      scorerVersion: "test",
    });
  }

  it("devolve só vaga aberta, acima do fit, com descrição legível — e do candidato certo", async () => {
    // Cada exclusão tem um motivo distinto:
    //  · fechada — o vocabulário de uma vaga morta não é o mercado de hoje;
    //  · fit baixo — mediria a linguagem de vagas que o candidato não quer;
    //  · descrição curta — diluiria toda frequência sem trazer vocabulário;
    //  · outro candidato — seria comparar o currículo com o mercado alheio.
    await vaga({ externalId: "boa", titulo: "Staff Engineer", texto: LONGA, fit: 90, candidateId: candidatoA });
    await vaga({ externalId: "fechada", titulo: "Morta", texto: LONGA, fit: 95, candidateId: candidatoA, fechada: true });
    await vaga({ externalId: "fraca", titulo: "Fora do alvo", texto: LONGA, fit: 10, candidateId: candidatoA });
    await vaga({ externalId: "curta", titulo: "Curta", texto: "Poucas palavras.", fit: 99, candidateId: candidatoA });
    await vaga({ externalId: "outro", titulo: "Do B", texto: LONGA, fit: 99, candidateId: candidatoB });

    const textos = await drizzleTargetCorpus.targetTexts({
      candidateId: candidatoA,
      minFit: 60,
      limit: 50,
    });

    expect(textos).toHaveLength(1);
    // O título entra no texto porque é a parte mais densa em vocabulário da
    // vaga inteira — descartá-lo jogaria fora o sinal mais forte.
    expect(textos[0]!.startsWith("Staff Engineer\n")).toBe(true);
  });

  it("ordena por fit e honra o limite", async () => {
    await vaga({ externalId: "m", titulo: "Media", texto: LONGA, fit: 70, candidateId: candidatoA });
    await vaga({ externalId: "t", titulo: "Topo", texto: LONGA, fit: 98, candidateId: candidatoA });
    await vaga({ externalId: "b", titulo: "Base", texto: LONGA, fit: 61, candidateId: candidatoA });

    const textos = await drizzleTargetCorpus.targetTexts({
      candidateId: candidatoA,
      minFit: 60,
      limit: 2,
    });

    expect(textos.map((t) => t.split("\n")[0])).toEqual(["Topo", "Media"]);
  });

  it("descrição nula não vira 'null' dentro do corpus", async () => {
    // A coluna aceita null. Concatenar sem tratar produziria a palavra "null"
    // no texto analisado — e ela passaria a ser contada como vocabulário do
    // mercado. Aqui a vaga é descartada antes disso pelo piso de tamanho.
    await vaga({ externalId: "nula", titulo: "Sem texto", texto: null, fit: 99, candidateId: candidatoA });

    const textos = await drizzleTargetCorpus.targetTexts({
      candidateId: candidatoA,
      minFit: 60,
      limit: 10,
    });
    expect(textos.join("")).not.toContain("null");
  });

  it("corpus vazio devolve lista vazia", async () => {
    expect(
      await drizzleTargetCorpus.targetTexts({ candidateId: candidatoA, minFit: 60, limit: 10 }),
    ).toEqual([]);
  });

  it("catalogIdOf resolve o id certo depois do seed", async () => {
    // Garantia indireta de que `add` liga a linha à entrada certa do catálogo:
    // uma resolução errada atribuiria ao candidato uma skill que ele não tem.
    await drizzleCatalog.sync(CATALOGO);
    await drizzleCandidateSkills.add(candidatoA, detection("kafka"), "cv");

    const [row] = await db.select().from(candidateSkill);
    expect(row!.skillId).toBe(await skillIdOf("kafka"));
  });
});
