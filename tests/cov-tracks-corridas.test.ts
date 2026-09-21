/**
 * Duas trilhas com o mesmo nome, criadas ao mesmo tempo — e a trilha sem alvo.
 *
 * ## A corrida, e o que ela de fato exercita
 *
 * `createTrack` e `updateTrack` validam o nome antes de gravar, e a validação é
 * uma consulta. O que impede a janela entre ela e o `insert` é um
 * `pg_advisory_xact_lock` por candidato, tomado no início da transação: duas
 * criações simultâneas **serializam**, e a segunda vê a primeira já gravada na
 * própria validação.
 *
 * Medido: por isso estes casos NÃO alcançam o `catch` de 23505. A recusa que eles
 * observam vem da validação, e o `catch` do índice único permanece como cinto de
 * segunda ordem — ele existe para o dia em que o lock for removido ou o caminho
 * mudar, e por isso continua sem cobertura, por design.
 *
 * O que os casos provam é o que importa para quem usa: dois cliques rápidos não
 * criam duas trilhas nem vazam erro de PostgreSQL, e a recusa carrega o código
 * que a tela sabe traduzir.
 *
 * ## A trilha sem alvo
 *
 * Trilha principal de quem não salvou perfil existe e não tem alvo. Três leitores
 * dependem disso: `trackOverview` declara `pending`, `trackScoringProfiles`
 * devolve `null` — e ninguém pontua para essa conta — e `ensurePrimaryTrack`
 * completa o alvo quando o perfil chega. Tratar alvo ausente como alvo vazio
 * faria a conta pontuar contra um perfil que não existe.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { candidate } from "../src/core/db/schema.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  createTrack,
  ensurePrimaryTrack,
  listCandidateTracks as listTracks,
  setMatchingProfile,
  suggestTrack,
  targetOf,
  trackOverview,
  trackScoringProfiles,
  updateTrack,
} from "../src/contexts/matching/index.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(async () => {
  await releaseTestDb();
});

async function comPerfil(slug = "dono"): Promise<number> {
  const [linha] = await db
    .insert(candidate)
    .values({ slug, name: slug, isDefault: slug === "dono" })
    .returning({ id: candidate.id });
  await setMatchingProfile(linha!.id, await loadProfile(true));
  return linha!.id;
}

async function semPerfil(slug = "novo"): Promise<number> {
  const [linha] = await db
    .insert(candidate)
    .values({ slug, name: slug, isDefault: false })
    .returning({ id: candidate.id });
  return linha!.id;
}

async function alvo() {
  const primary = targetOf(await loadProfile(true));
  return suggestTrack({ term: "Laravel", catalog: [], primary }).target;
}

describe("duas criações simultâneas com o mesmo nome", () => {
  it("UT-320 uma cria, a outra recebe `track_name_duplicate`", async () => {
    // A recusa vem da validação, não do índice — ver o bloco no topo do arquivo.
    const candidateId = await comPerfil();
    const target = await alvo();

    const [a, b] = await Promise.all([
      createTrack(candidateId, { name: "Dev PHP", target }),
      createTrack(candidateId, { name: "Dev PHP", target }),
    ]);

    const criadas = [a, b].filter((r) => r.ok);
    const recusadas = [a, b].filter((r) => !r.ok);
    expect(criadas).toHaveLength(1);
    expect(recusadas[0]).toMatchObject({ ok: false, code: "track_name_duplicate" });

    // E o banco tem uma só, além da principal.
    const trilhas = await listTracks(candidateId);
    expect(trilhas.filter((t) => t.name === "Dev PHP")).toHaveLength(1);
  });

  it("UT-321 caixa e espaço nas BORDAS disputam a mesma chave; espaço interno não", async () => {
    // Medido: `nameKey` é `trim().toLowerCase()`, e não colapsa espaço interno.
    // "Dev PHP", "dev php" e " Dev PHP " são a mesma chave; "Dev  PHP", com dois
    // espaços, é outra — e nasce uma segunda trilha visualmente idêntica à
    // primeira. É fricção conhecida, registrada aqui em vez de abençoada em
    // silêncio: mudar a normalização mexe num índice único com dados vivos, e
    // isso é decisão de migração, não de teste.
    const candidateId = await comPerfil();
    const target = await alvo();

    const mesmaChave = await Promise.all([
      createTrack(candidateId, { name: "Dev PHP", target }),
      createTrack(candidateId, { name: "dev php", target }),
      createTrack(candidateId, { name: " Dev PHP ", target }),
    ]);

    expect(mesmaChave.filter((r) => r.ok)).toHaveLength(1);
    for (const recusada of mesmaChave.filter((r) => !r.ok)) {
      expect(recusada).toMatchObject({ code: "track_name_duplicate" });
    }

    // E a chave diferente entra: dois espaços não são um.
    const espacoDuplo = await createTrack(candidateId, { name: "Dev  PHP", target });
    expect(espacoDuplo.ok).toBe(true);
  });

  it("UT-322 renomear para o nome de outra trilha é recusado igual", async () => {
    const candidateId = await comPerfil();
    const target = await alvo();
    const php = await createTrack(candidateId, { name: "Dev PHP", target });
    const ia = await createTrack(candidateId, { name: "Dev IA", target });
    if (!php.ok || !ia.ok) throw new Error("setup");

    const resultado = await updateTrack(candidateId, ia.track.id, {
      name: "Dev PHP",
      target,
      expectedUpdatedAt: ia.track.updatedAt,
    });

    expect(resultado).toMatchObject({ ok: false, code: "track_name_duplicate" });
  });
});

describe("alvo inválido é recusado antes de gravar", () => {
  it("UT-323 faixa com alvo abaixo do piso é recusada no update", async () => {
    // A mesma validação que o `profile.yaml` sofre, aplicada ao alvo da trilha:
    // uma faixa invertida daria nota crescente para salário decrescente.
    const candidateId = await comPerfil();
    const target = await alvo();
    const php = await createTrack(candidateId, { name: "Dev PHP", target });
    if (!php.ok) throw new Error("setup");

    const invertido = structuredClone(target);
    invertido.compensation.ranges = [
      { currency: "USD", period: "year", floor: 200_000, target: 100_000, ideal: 300_000 },
    ];

    const resultado = await updateTrack(candidateId, php.track.id, {
      target: invertido,
      expectedUpdatedAt: php.track.updatedAt,
    });

    expect(resultado.ok).toBe(false);
  });
});

describe("a conta sem perfil próprio", () => {
  it("UT-324 a principal existe sem alvo, e ninguém pontua para ela", async () => {
    const candidateId = await semPerfil();

    // `ensurePrimaryTrack` devolve `null`: não há perfil de onde tirar o alvo.
    expect(await ensurePrimaryTrack(candidateId)).toBeNull();
    // E a porta de pontuação recusa, em vez de pontuar contra o perfil do dono.
    expect(await trackScoringProfiles(candidateId)).toBeNull();

    const visao = await trackOverview(candidateId);
    expect(visao.pending).toBe(true);
  });

  it("UT-325 quando o perfil chega, a principal ganha alvo e a pontuação abre", async () => {
    // O outro lado do mesmo par: `ensurePrimaryTrack` é idempotente e completa a
    // principal que já existia sem alvo, em vez de criar uma segunda.
    const candidateId = await semPerfil();
    await ensurePrimaryTrack(candidateId);
    const antes = await listTracks(candidateId);

    await setMatchingProfile(candidateId, await loadProfile(true));

    const principal = await ensurePrimaryTrack(candidateId);
    expect(principal?.target).toBeTruthy();
    expect(await trackScoringProfiles(candidateId)).not.toBeNull();
    expect((await trackOverview(candidateId)).pending).toBe(false);

    // Nenhuma trilha nova: a mesma principal foi completada.
    const depois = await listTracks(candidateId);
    expect(depois.filter((t) => t.isPrimary)).toHaveLength(1);
    expect(depois).toHaveLength(Math.max(antes.length, 1));
  });
});
