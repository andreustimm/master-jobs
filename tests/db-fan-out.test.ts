/**
 * Suíte: nenhuma leitura de tela pede mais conexões do que o pool tem.
 *
 * O cliente abre três conexões (`max: 3` em `src/core/db/client.ts`). Uma quarta
 * consulta simultânea espera, e em produção essa espera não terminava: as telas
 * `/candidate/skills` e `/searches/tracks/new?term=…` devolviam 504 aos 30s da
 * função da Vercel, enquanto todas as outras respondiam em 1–5s. As mesmas
 * chamadas, num build de produção local contra o MESMO banco, levavam 600ms — o
 * que descarta consulta lenta e sobra a espera por conexão.
 *
 * O teste não mede tempo, que varia de máquina: mede o **pico de consultas em
 * voo**, que é a propriedade que o pool limita.
 *
 * **A régua é menor que o pool, e isso é o conserto de 2026-09-20.** Ela era
 * `<= 3`, que aprova exatamente o caminho que esgota as três conexões. Uma
 * requisição sozinha cabe em três e responde 200 — foi assim que esta tela
 * passou por toda a suíte. Mas a instância serverless é reaproveitada entre
 * requisições concorrentes, então duas na mesma instância pedem seis conexões a
 * um pool de três, cada uma espera a outra, e as duas morrem aos 30s. Os logs
 * de produção mostram o par: um 200, e 266ms depois um 504 na mesma rota.
 *
 * Por isso o limite é `POOL - 1`: uma leitura de tela precisa caber deixando
 * conexão para o resto da requisição e para a requisição do lado.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { candidate, company, job, source } from "../src/core/db/schema.ts";
import type { DB } from "../src/core/db/client.ts";
import { boardFacets, ensurePrimaryTrack, trackOverview, trackSuggestion } from "../src/contexts/matching/index.ts";
import { candidateSkills } from "../src/contexts/skills/index.ts";
import { loadSkillsScreen } from "../app/candidate/skills/data.ts";
import { loadCockpit } from "../app/cockpit-data.ts";
import { loadSearchesScreen } from "../app/searches/searches-data.ts";
import { loadJobsView } from "../app/jobs/jobs-data.ts";
import { readFilters, toBoardFilters } from "../app/filter-state.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(async () => {
  await releaseTestDb();
});

/** O pico de consultas simultâneas enquanto `run` acontece. */
async function peakInFlight(run: () => Promise<unknown>): Promise<number> {
  const client = db.$client as unknown as { unsafe: (...args: unknown[]) => Promise<unknown> };
  const original = client.unsafe.bind(client);
  let inFlight = 0;
  let peak = 0;
  client.unsafe = (...args: unknown[]) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    const result = original(...args) as Promise<unknown> & { finally?: unknown };
    // Drizzle usa o resultado como thenable e às vezes como iterável; só o
    // encadeamento do settle interessa aqui, e ele não altera o valor.
    void Promise.resolve(result).then(
      () => { inFlight -= 1; },
      () => { inFlight -= 1; },
    );
    return result;
  };
  try {
    await run();
  } finally {
    client.unsafe = original;
  }
  return peak;
}

/** O SQL de cada consulta que `run` mandou ao banco, na ordem em que saiu. */
async function queriesOf(run: () => Promise<unknown>): Promise<string[]> {
  const client = db.$client as unknown as { unsafe: (...args: unknown[]) => Promise<unknown> };
  const original = client.unsafe.bind(client);
  const sent: string[] = [];
  client.unsafe = (...args: unknown[]) => {
    sent.push(String(args[0]));
    return original(...args);
  };
  try {
    await run();
  } finally {
    client.unsafe = original;
  }
  return sent;
}

const POOL = 3;

/** Uma conexão fica de fora de propósito — ver o cabeçalho. */
const TETO = POOL - 1;

async function seedOwner(): Promise<number> {
  const [owner] = await db
    .insert(candidate)
    .values({ slug: "dono", name: "Dono", isDefault: true })
    .returning({ id: candidate.id });
  await db.insert(source).values({ id: "manual:leque", kind: "manual", handle: "leque", label: "Leque" });
  await db.insert(company).values({ slug: "leque", name: "Leque" });
  await db.insert(job).values({
    sourceId: "manual:leque",
    companyName: "Leque",
    externalId: "leque-1",
    title: "AI Solutions Architect",
    descriptionText:
      "Remote LATAM role designing distributed systems, RAG platforms, TypeScript services and observability, with technical leadership across teams and cloud architecture on AWS.",
    locationRaw: "Remote LATAM",
    url: "manual://leque/1",
    fingerprint: "leque-1",
    contentHash: "leque-1",
    raw: "{}",
  });
  return owner!.id;
}

describe("leque de consultas por tela", () => {
  it("lê contadores e opções de facetas em uma única ida ao banco", async () => {
    const candidateId = await seedOwner();
    await ensurePrimaryTrack(candidateId);
    const queries = await queriesOf(() => boardFacets(candidateId, { groupRepeats: true }));
    expect(queries).toHaveLength(1);
  });

  it("a tela de skills não passa do tamanho do pool", async () => {
    const candidateId = await seedOwner();
    await ensurePrimaryTrack(candidateId);

    // A função da própria tela, não uma cópia da ordem dela.
    const peak = await peakInFlight(async () => {
      const { mine, demand } = await loadSkillsScreen(candidateId);
      expect(Array.isArray(mine)).toBe(true);
      expect(Array.isArray(demand)).toBe(true);
    });

    expect(peak).toBeLessThanOrEqual(TETO);
  });

  it("a visão geral das trilhas não passa do teto", async () => {
    // Este caminho nasceu do próprio conserto: `ownEvidence` passou a usar duas
    // conexões, e somar `listTracks` em paralelo devolvia o pico a três. A
    // varredura por `Promise.all` só encontra o que já existe; o teto é que
    // impede o próximo.
    const candidateId = await seedOwner();
    await ensurePrimaryTrack(candidateId);

    const peak = await peakInFlight(async () => {
      const visao = await trackOverview(candidateId);
      expect(Array.isArray(visao.tracks)).toBe(true);
    });

    expect(peak).toBeLessThanOrEqual(TETO);
  });

  /**
   * As três telas que a régua não alcançava.
   *
   * A régua media FUNÇÃO, e tela não é função: `/`, `/jobs` e `/searches`
   * compunham as leituras no corpo do Server Component, onde `peakInFlight` não
   * chega. As três funções consertadas passavam, a suíte ficava verde, e o
   * cockpit — rota que a PWA abre e onde o candidato cai depois do login — pedia
   * sete conexões de um pool de três.
   *
   * Por isso cada caso abaixo chama a função de composição da tela: enquanto a
   * leitura mora na página, nada aqui a vê.
   */
  it("o cockpit não passa do teto", async () => {
    const candidateId = await seedOwner();
    await ensurePrimaryTrack(candidateId);
    const state = readFilters({});

    const peak = await peakInFlight(async () => {
      const visao = await loadCockpit(candidateId, state, toBoardFilters(state));
      expect(Array.isArray(visao.top)).toBe(true);
      // O número do título vem de `countBoard`, não de `facets.total`: as
      // facetas anulam cada dimensão na própria contagem e respondem outra
      // pergunta.
      expect(typeof visao.total).toBe("number");
    });

    expect(peak).toBeLessThanOrEqual(TETO);
  });

  it("a tela de vagas não passa do teto, nem com faixa salarial", async () => {
    // Com faixa o caminho é o mais largo que existe: as três leituras pesadas
    // normalizam pagamento, e antes cada uma ia buscar o câmbio por conta
    // própria — duas consultas cada, quatro vezes o mesmo câmbio.
    const candidateId = await seedOwner();
    await ensurePrimaryTrack(candidateId);

    const peak = await peakInFlight(async () => {
      const visao = await loadJobsView({
        candidateId,
        params: { pay: "6000", payMax: "30000", cur: "USD", per: "month" },
        page: 1,
        pageSize: 25,
        prefetch: false,
        schedule: () => {},
        now: new Date("2026-09-20T12:00:00Z"),
      });
      expect(Array.isArray(visao.rows)).toBe(true);
    });

    expect(peak).toBeLessThanOrEqual(TETO);
  });

  it("a tela de vagas lê as trilhas e o câmbio uma vez só", async () => {
    // Cada ida ao banco é um round-trip, e o prelúdio da tela vinha em série:
    // trilhas para o seletor, as MESMAS trilhas para o escopo (e de novo para o
    // cluster) e o câmbio em duas consultas. A régua de pico não vê isso — cada
    // uma cabe no teto —, então a contagem é o que impede a volta.
    const candidateId = await seedOwner();
    await ensurePrimaryTrack(candidateId);

    const queries = await queriesOf(() =>
      loadJobsView({
        candidateId,
        params: { cluster: "architect" },
        page: 1,
        pageSize: 25,
        prefetch: false,
        schedule: () => {},
        now: new Date("2026-09-20T12:00:00Z"),
      }),
    );

    const from = (table: string) => queries.filter((query) => query.includes(`from "production"."${table}"`)).length;
    expect(from("target_track")).toBe(1);
    expect(from("fx_rate")).toBe(1);
  });

  it("a tela de buscas não passa do teto", async () => {
    // Duas leituras corrigidas uma a uma para caber em duas, somadas em
    // paralelo pela única página que usa as duas: quatro em voo.
    const candidateId = await seedOwner();
    await ensurePrimaryTrack(candidateId);

    const peak = await peakInFlight(async () => {
      const visao = await loadSearchesScreen(candidateId, new Date("2026-09-20T12:00:00Z"));
      expect(Array.isArray(visao.tracks.tracks)).toBe(true);
    });

    expect(peak).toBeLessThanOrEqual(TETO);
  });

  it("a sugestão de trilha não passa do tamanho do pool", async () => {
    const candidateId = await seedOwner();
    await ensurePrimaryTrack(candidateId);

    const peak = await peakInFlight(() => trackSuggestion(candidateId, "Laravel"));

    expect(peak).toBeLessThanOrEqual(TETO);
  });

  it("uma leitura em série continua sendo uma consulta de cada vez", async () => {
    // Controle: se o medidor estiver quebrado e sempre devolver 1, os dois
    // casos acima passariam sem provar nada. Aqui o pico TEM de ser 2.
    const candidateId = await seedOwner();
    const peak = await peakInFlight(() =>
      Promise.all([candidateSkills(candidateId), candidateSkills(candidateId)]));
    expect(peak).toBe(2);
  });
});
