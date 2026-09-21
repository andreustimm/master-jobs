/**
 * Os caminhos de RECUSA das trilhas.
 *
 * `tracks.ts` estava em 75,8% de branches, e o que faltava era quase inteiramente
 * isto: nome inválido, alvo inválido, nome repetido, trilha inexistente, trilha
 * que já é primária, trilha que já está ativa. São os caminhos que decidem se
 * uma ação do usuário é recusada com motivo ou aceita por engano — e nenhum
 * deles aparece num teste de caminho feliz, por definição.
 *
 * A recusa importa mais que o sucesso aqui porque ela é o contrato da tela: cada
 * `code` tem uma frase no dicionário, e um `code` errado mostra a mensagem errada
 * para o que aconteceu.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { candidate } from "../src/core/db/schema.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  archiveTrack,
  createTrack,
  ensurePrimaryTrack,
  listCandidateTracks,
  restoreTrack,
  setMatchingProfile,
  setPrimaryTrack,
  suggestTrack,
  targetOf,
  trackScoringProfiles,
  trackSuggestion,
  updateTrack,
  type Track,
  type TrackTarget,
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

/** Um candidato com perfil de matching, que é o que dá alvo à trilha primária. */
async function pessoa(slug = "dono", owner = true): Promise<number> {
  const [linha] = await db
    .insert(candidate)
    .values({ slug, name: slug, isDefault: owner })
    .returning({ id: candidate.id });
  await setMatchingProfile(linha!.id, await loadProfile(true));
  return linha!.id;
}

async function alvoValido(): Promise<TrackTarget> {
  const primary = targetOf(await loadProfile(true));
  return suggestTrack({ term: "laravel", catalog: [], primary }).target;
}

async function trilha(candidateId: number, nome: string): Promise<Track> {
  const resultado = await createTrack(candidateId, { name: nome, target: await alvoValido() });
  if (!resultado.ok) throw new Error(resultado.code);
  return resultado.track;
}

describe("criar trilha recusa antes de gravar", () => {
  it("UT-140 nome vazio é recusado sem chegar ao banco", async () => {
    const candidateId = await pessoa();

    const vazio = await createTrack(candidateId, { name: "   ", target: await alvoValido() });

    expect(vazio.ok).toBe(false);
    // Nada foi criado além da primária que `ensurePrimaryTrack` garante.
    const tracks = await listCandidateTracks(candidateId);
    expect(tracks.filter((t) => !t.isPrimary)).toHaveLength(0);
  });

  it("UT-141 alvo sem cargo e alvo sem palavra-chave são recusados por motivos diferentes", async () => {
    const candidateId = await pessoa();
    const alvo = await alvoValido();

    // Trilha sem cargo nenhum não sabe o que procurar.
    const semCargo = await createTrack(candidateId, {
      name: "Sem cargo",
      target: { ...alvo, targets: { clusters: {}, avoid_titles: [] } } as TrackTarget,
    });
    expect(semCargo).toMatchObject({ ok: false, code: "track_titles_required" });

    // Com cargo e sem palavra-chave positiva, o scorer não tem o que casar — e o
    // motivo tem de ser OUTRO, porque a tela mostra uma frase por código.
    const semPalavra = await createTrack(candidateId, {
      name: "Sem palavra",
      target: {
        ...alvo,
        keywords: { critical: [], strong: [], stack: [], negative: [] },
      } as TrackTarget,
    });
    expect(semPalavra).toMatchObject({ ok: false, code: "track_keywords_required" });
  });

  it("UT-142 nome repetido é recusado com `track_name_duplicate`", async () => {
    const candidateId = await pessoa();
    await trilha(candidateId, "Laravel");

    // A comparação é por chave normalizada, então caixa e espaço não escapam.
    const repetida = await createTrack(candidateId, {
      name: "  laravel  ",
      target: await alvoValido(),
    });

    expect(repetida).toMatchObject({ ok: false, code: "track_name_duplicate" });
  });
});

describe("atualizar trilha recusa o que não existe e o nome de outra", () => {
  it("UT-143 id que não é do candidato responde `not_found`", async () => {
    const candidateId = await pessoa();
    const outro = await pessoa("outro", false);
    const dela = await trilha(outro, "Do outro");

    const resultado = await updateTrack(candidateId, dela.id, {
      target: await alvoValido(),
      expectedUpdatedAt: dela.updatedAt,
    });

    expect(resultado).toMatchObject({ ok: false, code: "not_found" });
  });

  it("UT-144 renomear para o nome de outra trilha é recusado", async () => {
    const candidateId = await pessoa();
    await trilha(candidateId, "Laravel");
    const php = await trilha(candidateId, "PHP");

    const resultado = await updateTrack(candidateId, php.id, {
      name: "Laravel",
      target: await alvoValido(),
      expectedUpdatedAt: php.updatedAt,
    });

    expect(resultado).toMatchObject({ ok: false, code: "track_name_duplicate" });
  });

  it("UT-145 nome inválido é recusado antes de qualquer leitura", async () => {
    const candidateId = await pessoa();
    const php = await trilha(candidateId, "PHP");

    const resultado = await updateTrack(candidateId, php.id, {
      name: "",
      target: await alvoValido(),
      expectedUpdatedAt: php.updatedAt,
    });

    expect(resultado.ok).toBe(false);
  });
});

describe("ciclo de vida: o que já está no estado pedido não é erro", () => {
  it("UT-146 tornar primária a que já é primária responde ok, sem mexer", async () => {
    const candidateId = await pessoa();
    const primaria = await ensurePrimaryTrack(candidateId);

    const resultado = await setPrimaryTrack(candidateId, primaria!.id);

    // Idempotente: pedir o estado atual é sucesso, não `já_é`.
    expect(resultado.ok).toBe(true);
  });

  it("UT-147 restaurar trilha que já está ativa responde ok", async () => {
    const candidateId = await pessoa();
    const php = await trilha(candidateId, "PHP");

    const resultado = await restoreTrack(candidateId, php.id);

    expect(resultado.ok).toBe(true);
  });

  it("UT-148 arquivar, restaurar e mexer no que não existe respondem `not_found`", async () => {
    const candidateId = await pessoa();

    await expect(archiveTrack(candidateId, 999_999)).resolves.toMatchObject({
      ok: false,
      code: "not_found",
    });
    await expect(restoreTrack(candidateId, 999_999)).resolves.toMatchObject({
      ok: false,
      code: "not_found",
    });
    await expect(setPrimaryTrack(candidateId, 999_999)).resolves.toMatchObject({
      ok: false,
      code: "not_found",
    });
  });
});

describe("sugestão e perfis de pontuação sem perfil de matching", () => {
  it("UT-149 candidato sem perfil não tem perfis de pontuação", async () => {
    // Sem `setMatchingProfile`: é o estado de uma conta recém-criada.
    const [linha] = await db
      .insert(candidate)
      .values({ slug: "novo", name: "novo", isDefault: false })
      .returning({ id: candidate.id });

    await expect(trackScoringProfiles(linha!.id)).resolves.toBeNull();
  });

  it("UT-150 sugestão para termo inválido é recusada sem consultar catálogo", async () => {
    const candidateId = await pessoa();

    const resultado = await trackSuggestion(candidateId, "  ");

    expect(resultado.ok).toBe(false);
  });
});
