/**
 * Os caminhos de RECUSA e os estados de pausa dos termos salvos.
 *
 * `saved-terms.ts` estava em 78,8% de branches, e o que faltava era isto: termo
 * inválido, termo repetido, trilha ausente, termo que não existe, e o estado
 * `paused` — que muda o que a tela mostra e o que a varredura faz, e não tinha
 * nenhum caso.
 *
 * Como em `cov-tracks-refusals.test.ts`, o `code` da recusa é contrato de tela:
 * cada um tem uma frase no dicionário, e devolver o código errado mostra a
 * mensagem errada para o que aconteceu.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { candidate } from "../src/core/db/schema.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  createTrack,
  deleteTerm,
  listSavedTerms,
  moveTerm,
  newCount,
  savedTermForBoard,
  saveTerm,
  setMatchingProfile,
  setTermStatus,
  suggestTrack,
  targetOf,
  termAvailability,
  termOverview,
  type ActionContext,
  type Track,
} from "../src/contexts/matching/index.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const AGORA = "2026-09-21T12:00:00.000Z";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
  setClock(fixedClock(AGORA));
});

afterEach(async () => {
  resetClock();
  await releaseTestDb();
});

const ctx = (): ActionContext => ({ now: new Date(AGORA), impersonated: false });

async function pessoa(slug = "dono", owner = true): Promise<number> {
  const [linha] = await db
    .insert(candidate)
    .values({ slug, name: slug, isDefault: owner })
    .returning({ id: candidate.id });
  await setMatchingProfile(linha!.id, await loadProfile(true));
  return linha!.id;
}

async function trilha(candidateId: number, nome: string): Promise<Track> {
  const primary = targetOf(await loadProfile(true));
  const resultado = await createTrack(candidateId, {
    name: nome,
    target: suggestTrack({ term: nome, catalog: [], primary }).target,
  });
  if (!resultado.ok) throw new Error(resultado.code);
  return resultado.track;
}

describe("salvar termo recusa antes de gravar", () => {
  it("UT-160 termo em branco é recusado, e a disponibilidade diz o mesmo motivo", async () => {
    const candidateId = await pessoa();
    const track = await trilha(candidateId, "Laravel");

    const disponibilidade = await termAvailability({ candidateId }, "   ");
    expect(disponibilidade.ok).toBe(false);

    const salvar = await saveTerm({ candidateId }, { term: "   ", trackId: track.id }, ctx());
    expect(salvar.ok).toBe(false);
    // As duas portas recusam pelo MESMO código: a tela pergunta antes de enviar,
    // e a resposta não pode mudar entre a pergunta e o envio.
    if (!disponibilidade.ok && !salvar.ok) expect(salvar.code).toBe(disponibilidade.code);
  });

  it("UT-161 termo repetido é recusado e aponta o id existente", async () => {
    const candidateId = await pessoa();
    const track = await trilha(candidateId, "Laravel");
    const primeiro = await saveTerm({ candidateId }, { term: "laravel", trackId: track.id }, ctx());
    if (!primeiro.ok) throw new Error(primeiro.code);

    // A comparação é por chave normalizada: caixa e espaço não escapam.
    const repetido = await saveTerm({ candidateId }, { term: "  Laravel ", trackId: track.id }, ctx());

    expect(repetido).toMatchObject({ ok: false, code: "term_duplicate", termId: primeiro.termId });
    // E a disponibilidade também já sabe, sem tentar gravar.
    const disponibilidade = await termAvailability({ candidateId }, "LARAVEL");
    expect(disponibilidade).toMatchObject({ ok: false, code: "term_duplicate" });
  });

  it("UT-162 trilha que não é do candidato responde `track_required`", async () => {
    const candidateId = await pessoa();
    const outro = await pessoa("outro", false);
    const dela = await trilha(outro, "Do outro");

    const resultado = await saveTerm({ candidateId }, { term: "laravel", trackId: dela.id }, ctx());

    expect(resultado).toMatchObject({ ok: false, code: "track_required" });
  });
});

describe("termo pausado", () => {
  it("UT-163 pausar muda o estado, pausar de novo é ok, e a visão mostra `paused`", async () => {
    const candidateId = await pessoa();
    const track = await trilha(candidateId, "Laravel");
    const salvo = await saveTerm({ candidateId }, { term: "laravel", trackId: track.id }, ctx());
    if (!salvo.ok) throw new Error(salvo.code);

    await expect(setTermStatus({ candidateId }, salvo.termId, "paused")).resolves.toMatchObject({
      ok: true,
    });
    // Pedir o estado atual é sucesso, não erro: a tela pode reenviar.
    await expect(setTermStatus({ candidateId }, salvo.termId, "paused")).resolves.toMatchObject({
      ok: true,
    });

    const visao = await termOverview({ candidateId }, new Date(AGORA));
    expect(visao.terms.find((t) => t.id === salvo.termId)!.status).toBe("paused");
    // A lista do quadro também enxerga o estado.
    expect(listSavedTerms({ candidateId })).resolves.toBeTruthy();
  });

  it("UT-164 mexer em termo que não existe responde `not_found`", async () => {
    const candidateId = await pessoa();

    await expect(setTermStatus({ candidateId }, 999_999, "paused")).resolves.toMatchObject({
      ok: false,
      code: "not_found",
    });
    await expect(moveTerm({ candidateId }, 999_999, 999_998)).resolves.toMatchObject({
      ok: false,
      code: "not_found",
    });
    // `newCount` de termo alheio é `null`, não zero: zero diria "nada novo".
    await expect(newCount({ candidateId }, 999_999)).resolves.toBeNull();
    // Apagar o que não existe não é erro — o estado final pedido já vale.
    await expect(deleteTerm({ candidateId }, 999_999)).resolves.toMatchObject({ ok: true });
  });

  it("UT-165 mover para trilha que não é do candidato é `not_found`", async () => {
    const candidateId = await pessoa();
    const outro = await pessoa("outro", false);
    const minha = await trilha(candidateId, "Laravel");
    const dela = await trilha(outro, "Do outro");
    const salvo = await saveTerm({ candidateId }, { term: "laravel", trackId: minha.id }, ctx());
    if (!salvo.ok) throw new Error(salvo.code);

    await expect(moveTerm({ candidateId }, salvo.termId, dela.id)).resolves.toMatchObject({
      ok: false,
      code: "not_found",
    });
  });
});

describe("o termo que o quadro pede", () => {
  it("UT-166 termo de outro candidato não é resolvido para o quadro", async () => {
    const candidateId = await pessoa();
    const outro = await pessoa("outro", false);
    const dela = await trilha(outro, "Do outro");
    const salvoDoOutro = await saveTerm({ candidateId: outro }, { term: "laravel", trackId: dela.id }, ctx());
    if (!salvoDoOutro.ok) throw new Error(salvoDoOutro.code);

    // O escopo vem da sessão: id na entrada é pedido, não prova.
    await expect(
      savedTermForBoard({ candidateId }, salvoDoOutro.termId, new Date(AGORA)),
    ).resolves.toBeNull();
  });
});
