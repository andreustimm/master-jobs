import { eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureCandidate } from "../src/core/candidate.ts";
import {
  addContact,
  companiesWithContacts,
  listContacts,
  referralOpportunities,
  seedWorkHistory,
} from "../src/core/contacts.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  application,
  candidate,
  company,
  job,
  jobScore,
  source,
  targetAccount,
} from "../src/core/db/schema.ts";
import { SCORER_VERSION } from "../src/core/scoring/score.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { primaryTrackId } from "./support/tracks.ts";

/**
 * A rede profissional existe por causa de um número: indicação é ~7% dos
 * candidatos e ~40% das contratações. Nada mais no sistema move o resultado
 * nessa margem. O trabalho aqui é estreito — saber quem você conhece, em qual
 * empresa — e o risco também: um casamento de empresa errado transforma
 * "você conhece alguém aqui" em ruído, e a partir daí o relatório é ignorado.
 */
let db: DB;
let candidatoId: number;
/** Sufixo para o slug de `company`, que é único no schema. */
let sequencia = 0;

beforeEach(async () => {
  sequencia = 0;
  db = await useTestDb();
  candidatoId = await ensureCandidate({ name: "Candidato de Rede" });
  await db.insert(source).values({
    id: "manual:rede",
    kind: "manual",
    handle: "rede",
    label: "Rede",
  });
});

afterEach(async () => {
  await releaseTestDb();
});

async function criarVaga(input: {
  empresa: string;
  titulo?: string;
  fit?: number | null;
  fechada?: boolean;
  cluster?: string;
  para?: number;
}): Promise<number> {
  sequencia += 1;
  const [empresa] = await db
    .insert(company)
    .values({ slug: `empresa-${sequencia}`, name: input.empresa })
    .returning({ id: company.id });
  const chave = `${input.empresa}-${input.titulo ?? "arquiteto"}-${sequencia}`;
  const [vaga] = await db
    .insert(job)
    .values({
      sourceId: "manual:rede",
      companyId: empresa!.id,
      companyName: input.empresa,
      externalId: chave,
      title: input.titulo ?? "Senior AI Software Architect",
      url: `https://exemplo.test/${encodeURIComponent(chave)}`,
      fingerprint: `fp-${chave}`,
      contentHash: `ch-${chave}`,
      raw: "{}",
      closedAt: input.fechada ? "2026-08-01T00:00:00.000Z" : null,
    })
    .returning({ id: job.id });

  if (input.fit != null) {
    await db.insert(jobScore).values({
      candidateId: input.para ?? candidatoId,
      trackId: await primaryTrackId(db, input.para ?? candidatoId),
      jobId: vaga!.id,
      fit: input.fit,
      titleScore: 0,
      keywordScore: 0,
      seniorityScore: 0,
      geoScore: 0,
      compScore: 0,
      freshnessScore: 0,
      benefitScore: 0,
      penalty: 0,
      cluster: input.cluster ?? "architect",
      matchedKeywords: [],
      missingKeywords: [],
      detectedBenefits: [],
      ageDays: null,
      reasons: [],
      blockers: [],
      scorerVersion: SCORER_VERSION,
      profileHash: "teste",
    });
  }
  return vaga!.id;
}

describe("addContact: a URL do LinkedIn é a chave natural", () => {
  it("insere quando o contato é novo", async () => {
    const r = await addContact(candidatoId, {
      name: "Marina Alves",
      company: "Nubank",
      role: "Head of AI",
      linkedinUrl: "https://www.linkedin.com/in/marina",
      category: "ai-leader",
      country: "BR",
      notes: "Palestrou sobre RAG em produção",
    });
    expect(r.created).toBe(true);

    const [linha] = await db.select().from(targetAccount).where(eq(targetAccount.id, r.id));
    expect(linha).toMatchObject({
      name: "Marina Alves",
      company: "Nubank",
      category: "ai-leader",
      // O status inicial vem do schema, não de quem cadastra: "identificado"
      // é o único estado honesto antes de qualquer interação.
      status: "identified",
    });
  });

  it("atualiza em vez de duplicar quando a URL já existe", async () => {
    // Duplicar contato é pior do que não ter contato: o relatório de
    // indicações passaria a listar a mesma pessoa duas vezes e a contagem
    // deixaria de significar alguma coisa.
    const primeiro = await addContact(candidatoId, {
      name: "Marina Alves",
      company: "Nubank",
      category: "peer",
      linkedinUrl: "https://www.linkedin.com/in/marina",
    });
    const segundo = await addContact(candidatoId, {
      name: "Marina Alves Ferreira",
      company: "Nubank Ltd",
      role: "VP Engineering",
      category: "ai-leader",
      linkedinUrl: "https://www.linkedin.com/in/marina",
      country: "BR",
      notes: "mudou de cargo",
    });

    expect(segundo).toEqual({ id: primeiro.id, created: false });
    expect(await db.select().from(targetAccount)).toHaveLength(1);
    const [linha] = await db.select().from(targetAccount);
    expect(linha).toMatchObject({
      name: "Marina Alves Ferreira",
      role: "VP Engineering",
      category: "ai-leader",
      notes: "mudou de cargo",
    });
  });

  it("zera os campos opcionais omitidos na atualização", async () => {
    // O update grava `?? null` em cada campo opcional: a atualização é
    // substituição, não mesclagem. Quem reenvia o formulário sem o cargo está
    // dizendo "não sei o cargo", e manter o valor antigo seria inventar dado
    // que o usuário acabou de apagar.
    const primeiro = await addContact(candidatoId, {
      name: "Marina",
      company: "Nubank",
      role: "Head of AI",
      country: "BR",
      notes: "nota antiga",
      category: "ai-leader",
      linkedinUrl: "https://www.linkedin.com/in/marina",
    });
    await addContact(candidatoId, {
      name: "Marina",
      category: "ai-leader",
      linkedinUrl: "https://www.linkedin.com/in/marina",
    });

    const [linha] = await db.select().from(targetAccount).where(eq(targetAccount.id, primeiro.id));
    expect(linha).toMatchObject({ role: null, country: null, notes: null, company: null });
  });

  it("permite homônimos quando não há URL para desempatar", async () => {
    // Sem URL não existe chave natural, e adivinhar por nome uniria duas
    // pessoas diferentes num contato só — erro silencioso e irreversível.
    const a = await addContact(candidatoId, { name: "João Silva", category: "recruiter" });
    const b = await addContact(candidatoId, { name: "João Silva", category: "recruiter" });
    expect(a.id).not.toBe(b.id);
    expect(await db.select().from(targetAccount)).toHaveLength(2);
  });
});

describe("listContacts", () => {
  it("devolve tudo, ou só a categoria pedida", async () => {
    await addContact(candidatoId, { name: "Recrutadora", category: "recruiter" });
    await addContact(candidatoId, { name: "Ex-colega", category: "former" });
    await addContact(candidatoId, { name: "Par", category: "peer" });

    expect(await listContacts(candidatoId)).toHaveLength(3);
    expect((await listContacts(candidatoId, "former")).map((c) => c.name)).toEqual(["Ex-colega"]);
    // Categoria inexistente devolve lista vazia, não a lista inteira: um
    // filtro que falha aberto engana quem está lendo.
    expect(await listContacts(candidatoId, "nao-existe")).toEqual([]);
  });
});

describe("companiesWithContacts: casamento por slug, não por texto", () => {
  it("junta grafias diferentes da mesma empresa sob um slug só", async () => {
    // A mesma normalização que o deduplicador usa, pelo mesmo motivo: a vaga
    // vem de um board escrevendo "Nubank Ltd" e o contato foi cadastrado à
    // mão como "Nubank".
    await addContact(candidatoId, { name: "Marina", company: "Nubank", category: "ai-leader" });
    await addContact(candidatoId, { name: "Rafael", company: "Nubank Ltd", category: "peer" });

    const mapa = await companiesWithContacts(candidatoId);
    expect(mapa.get("nubank")).toEqual(["Marina", "Rafael"]);
  });

  it("marca ex-colega no rótulo, porque é o vínculo mais forte que existe", async () => {
    // O rótulo é o que o usuário lê antes de decidir pedir indicação. Um
    // ex-colega e um contato frio pedem abordagens completamente diferentes.
    await addContact(candidatoId, { name: "Bruno", company: "Regal Rexnord", category: "former" });
    await addContact(candidatoId, { name: "Carla", company: "Regal Rexnord", category: "recruiter" });

    expect((await companiesWithContacts(candidatoId)).get("regal-rexnord")).toEqual([
      "Bruno (ex-colega)",
      "Carla",
    ]);
  });

  it("trata empresa em branco como ausência de empresa", async () => {
    // Regra 17 do CLAUDE.md: `??` não protege contra string vazia. O
    // formulário manda "" quando o campo fica em branco, e "" passa direto
    // pelo `is not null` do SQL. Sem a checagem de verdade, esse contato
    // entraria no mapa sob slug vazio e casaria com toda vaga cuja empresa
    // também normalizasse para vazio.
    await addContact(candidatoId, { name: "Sem empresa de verdade", company: "", category: "peer" });
    await addContact(candidatoId, { name: "Com empresa", company: "Zorbit", category: "company" });

    expect([...(await companiesWithContacts(candidatoId)).keys()]).toEqual(["zorbit"]);
  });

  it("ignora contato sem empresa e empresa que não vira slug", async () => {
    // Contato pessoal sem empresa não indica ninguém, e um nome que normaliza
    // para string vazia casaria com toda vaga cuja empresa também normalizasse
    // para vazio — casamento acidental é o pior defeito possível aqui.
    await addContact(candidatoId, { name: "Sem empresa", category: "peer" });
    await addContact(candidatoId, { name: "Empresa simbólica", company: "###", category: "company" });
    await addContact(candidatoId, { name: "Válido", company: "Zorbit", category: "company" });

    const mapa = await companiesWithContacts(candidatoId);
    expect([...mapa.keys()]).toEqual(["zorbit"]);
  });
});

describe("referralOpportunities: o relatório que deveria guiar a semana", () => {
  it("devolve vazio sem contato nenhum, sem tocar na tabela de vagas", async () => {
    // Atalho deliberado: sem rede não há indicação possível, e varrer o
    // acervo de 6.000 vagas para descobrir isso seria trabalho jogado fora.
    await criarVaga({ empresa: "Nubank", fit: 90 });
    expect(await referralOpportunities(candidatoId)).toEqual([]);
  });

  it("lista só vagas abertas, acima do corte, onde existe contato", async () => {
    await addContact(candidatoId, { name: "Marina", company: "Nubank", category: "ai-leader" });
    await addContact(candidatoId, { name: "Bruno", company: "Regal Rexnord", category: "former" });

    const boa = await criarVaga({ empresa: "Nubank Ltd", fit: 72 });
    await criarVaga({ empresa: "Nubank", titulo: "Estágio", fit: 20 }); // abaixo do corte
    await criarVaga({ empresa: "Regal Rexnord", fit: 88, fechada: true }); // fechada
    await criarVaga({ empresa: "Empresa Sem Contato", fit: 95 }); // sem rede
    await criarVaga({ empresa: "Nubank", titulo: "Sem score", fit: null }); // nunca pontuada

    const oportunidades = await referralOpportunities(candidatoId, 45);
    expect(oportunidades.map((o) => o.jobId)).toEqual([boa]);
    expect(oportunidades[0]).toMatchObject({
      companyName: "Nubank Ltd",
      fit: 72,
      cluster: "architect",
      contacts: ["Marina"],
      status: null,
    });
  });

  it("ordena por fit decrescente, porque a lista é uma fila de trabalho", async () => {
    await addContact(candidatoId, { name: "Marina", company: "Nubank", category: "ai-leader" });
    const media = await criarVaga({ empresa: "Nubank", titulo: "Staff", fit: 61 });
    const alta = await criarVaga({ empresa: "Nubank", titulo: "Principal", fit: 84 });
    const baixa = await criarVaga({ empresa: "Nubank", titulo: "Pleno", fit: 47 });

    expect((await referralOpportunities(candidatoId, 45)).map((o) => o.jobId)).toEqual([
      alta,
      media,
      baixa,
    ]);
  });

  it("mostra o estado da candidatura para não repetir contato já feito", async () => {
    // Pedir indicação de novo para uma vaga onde já se candidatou queima a
    // relação — e essa é a única coisa que a rede não recupera.
    await addContact(candidatoId, { name: "Marina", company: "Nubank", category: "ai-leader" });
    const vagaId = await criarVaga({ empresa: "Nubank", fit: 70 });
    await db.insert(application).values({
      candidateId: candidatoId,
      jobId: vagaId,
      status: "applied",
      channel: "referral",
    });

    expect((await referralOpportunities(candidatoId, 45))[0]?.status).toBe("applied");
  });

  it("pontua por candidato: a vaga de outro candidato não vaza", async () => {
    // `job_score` é por candidato. Ler o fit sem filtrar traria a nota de
    // outra pessoa e mudaria a ordem da fila de trabalho de quem consultou.
    await addContact(candidatoId, { name: "Marina", company: "Nubank", category: "ai-leader" });
    await criarVaga({ empresa: "Nubank", fit: 90 });
    const outro = await ensureCandidate({ slug: "outro", name: "Outro Candidato" });

    expect(await referralOpportunities(outro, 45)).toEqual([]);
    expect(await referralOpportunities(candidatoId, 45)).toHaveLength(1);
  });

  it("usa 45 como corte padrão", async () => {
    await addContact(candidatoId, { name: "Marina", company: "Nubank", category: "ai-leader" });
    await criarVaga({ empresa: "Nubank", titulo: "Quase", fit: 44 });
    const passa = await criarVaga({ empresa: "Nubank", titulo: "Passa", fit: 45 });
    expect((await referralOpportunities(candidatoId)).map((o) => o.jobId)).toEqual([passa]);
  });
});

describe("seedWorkHistory: o histórico de trabalho é a rede mais forte", () => {
  it("cadastra as empresas onde o candidato realmente entregou", async () => {
    // Não são alvos aspiracionais — são ex-empregadores e ex-clientes, o mais
    // perto de apresentação calorosa que existe. Estavam no currículo, sem uso.
    const r = await seedWorkHistory(candidatoId);
    expect(r.inserted).toBeGreaterThan(10);
    expect(r.updated).toBe(0);

    const linhas = await db.select().from(targetAccount);
    expect(linhas.every((l) => l.category === "former")).toBe(true);
    // Nome e empresa iguais: a entrada é a EMPRESA, ainda sem pessoa nomeada.
    expect(linhas.every((l) => l.name === l.company)).toBe(true);
    expect(linhas.map((l) => l.name)).toContain("BairesDev");
  });

  it("é idempotente: rodar de novo atualiza a nota, não duplica a linha", async () => {
    // Regra do projeto: tudo idempotente. Um seed que duplica inflaria a
    // contagem de contatos e o relatório de indicação junto.
    const primeira = await seedWorkHistory(candidatoId);
    const segunda = await seedWorkHistory(candidatoId);

    expect(segunda.inserted).toBe(0);
    expect(segunda.updated).toBe(primeira.inserted);
    expect(await db.select().from(targetAccount)).toHaveLength(primeira.inserted);
  });

  it("não sequestra um contato homônimo de outra categoria", async () => {
    // A busca do seed casa por nome E categoria 'former'. Um recrutador
    // chamado "Revelo" cadastrado à mão continua sendo recrutador.
    await addContact(candidatoId, { name: "Revelo", company: "Revelo", category: "recruiter" });
    await seedWorkHistory(candidatoId);

    const revelos = await db.select().from(targetAccount).where(eq(targetAccount.name, "Revelo"));
    expect(revelos.map((r) => r.category).sort()).toEqual(["former", "recruiter"]);
  });

  it("alimenta o casamento de indicação de ponta a ponta", async () => {
    // O teste que justifica o resto: depois do seed, uma vaga na Regal
    // Rexnord aparece como oportunidade de indicação sem nenhum cadastro
    // manual — que é o valor todo da funcionalidade.
    await seedWorkHistory(candidatoId);
    await criarVaga({ empresa: "Regal Rexnord Inc.", fit: 66 });

    const [oportunidade] = await referralOpportunities(candidatoId, 45);
    expect(oportunidade?.contacts).toEqual(["Regal Rexnord (ex-colega)"]);
  });
});

describe("a rede é de um candidato só (#379)", () => {
  // A rede do dono vazava em /referrals para qualquer conta: `target_account`
  // não tinha dono, e uma conta nova via "14 empresas na sua rede" e, ao lado
  // de cada vaga, os NOMES dos contatos dele. São pessoas de fora, que nunca
  // consentiram em aparecer para outra conta.
  let outra: number;

  beforeEach(async () => {
    outra = await ensureCandidate({ slug: "outra-conta", name: "Outra Conta" });
  });

  it("a outra conta não vê empresa nem nome da rede do dono", async () => {
    await addContact(candidatoId, { name: "Marina", company: "Nubank", category: "ai-leader" });
    await seedWorkHistory(candidatoId);
    // A outra conta tem nota alta na mesma vaga: sem o escopo, ela veria
    // "via Marina" ao lado.
    await criarVaga({ empresa: "Nubank", fit: 90, para: outra });

    expect(await companiesWithContacts(outra)).toEqual(new Map());
    expect(await listContacts(outra)).toEqual([]);
    expect(await referralOpportunities(outra, 45)).toEqual([]);
    // A rede do dono continua inteira para ele.
    expect((await companiesWithContacts(candidatoId)).get("nubank")).toEqual(["Marina"]);
  });

  it("cada conta lê só a própria rede, mesmo na mesma empresa", async () => {
    await addContact(candidatoId, { name: "Marina", company: "Nubank", category: "ai-leader" });
    await addContact(outra, { name: "Rafael", company: "Nubank", category: "peer" });
    await criarVaga({ empresa: "Nubank", fit: 70 });
    await criarVaga({ empresa: "Nubank", titulo: "Staff", fit: 80, para: outra });

    expect((await referralOpportunities(candidatoId, 45)).map((o) => o.contacts)).toEqual([["Marina"]]);
    expect((await referralOpportunities(outra, 45)).map((o) => o.contacts)).toEqual([["Rafael"]]);
    expect((await listContacts(outra)).map((c) => c.name)).toEqual(["Rafael"]);
  });

  it("a mesma URL do LinkedIn em outra conta é recusada, sem tocar no contato do dono", async () => {
    // O índice único da URL ainda é global (a troca por um índice por
    // candidato exige migration com revisão humana). Até lá, a segunda conta
    // é recusada: negar é o lado seguro. O que não pode é casar pela URL
    // global e sobrescrever nome, cargo e nota do contato do dono.
    const url = "https://www.linkedin.com/in/marina";
    const doDono = await addContact(candidatoId, {
      name: "Marina Alves",
      company: "Nubank",
      category: "ai-leader",
      linkedinUrl: url,
      notes: "nota do dono",
    });

    await expect(
      addContact(outra, { name: "Marina", company: "Outra Empresa", category: "peer", linkedinUrl: url }),
    ).rejects.toThrow();

    const linhas = await db.select().from(targetAccount);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      id: doDono.id,
      candidateId: candidatoId,
      name: "Marina Alves",
      notes: "nota do dono",
    });
    expect(await listContacts(outra)).toEqual([]);
  });

  it("contato sem dono não aparece para ninguém", async () => {
    // A migration aditiva deixa as linhas antigas com `candidate_id` nulo até
    // o backfill com revisão humana. Nenhuma leitura pode tratá-las como de
    // alguém: o filtro por candidato as esconde de todas as contas.
    await db.insert(targetAccount).values({
      name: "Contato antigo",
      company: "Nubank",
      category: "former",
      linkedinUrl: "https://www.linkedin.com/in/antigo",
    });
    await criarVaga({ empresa: "Nubank", fit: 90 });
    await criarVaga({ empresa: "Nubank", titulo: "Staff", fit: 90, para: outra });

    for (const conta of [candidatoId, outra]) {
      expect(await companiesWithContacts(conta)).toEqual(new Map());
      expect(await listContacts(conta)).toEqual([]);
      expect(await referralOpportunities(conta, 45)).toEqual([]);
    }
  });

  it("escrita nova grava o dono", async () => {
    const r = await addContact(outra, { name: "Rafael", company: "Acme", category: "peer" });
    await seedWorkHistory(outra);

    const [linha] = await db.select().from(targetAccount).where(eq(targetAccount.id, r.id));
    expect(linha?.candidateId).toBe(outra);
    const semDono = await db.select().from(targetAccount).where(isNull(targetAccount.candidateId));
    expect(semDono).toEqual([]);
  });

  it("o seed de uma conta não atualiza a linha homônima de outra", async () => {
    await seedWorkHistory(outra);
    const antes = await db.select().from(targetAccount).where(eq(targetAccount.candidateId, outra));

    const r = await seedWorkHistory(candidatoId);
    expect(r.updated).toBe(0);
    expect(await db.select().from(targetAccount).where(eq(targetAccount.candidateId, outra))).toEqual(antes);
  });

  it("apagar o candidato apaga a rede dele, e só a dele", async () => {
    // `ON DELETE CASCADE` (G20): contato sem dono não teria a quem pertencer,
    // e deixá-lo órfão seria reabrir o vazamento na próxima leitura sem filtro.
    await addContact(candidatoId, { name: "Marina", company: "Nubank", category: "ai-leader" });
    await addContact(outra, { name: "Rafael", company: "Nubank", category: "peer" });

    await db.delete(candidate).where(eq(candidate.id, outra));

    const restantes = await db.select().from(targetAccount);
    expect(restantes.map((l) => [l.candidateId, l.name])).toEqual([[candidatoId, "Marina"]]);
  });
});
