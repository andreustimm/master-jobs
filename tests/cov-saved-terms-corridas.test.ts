/**
 * Dois cliques ao mesmo tempo, e o que "buscar de novo" faz em cada estado.
 *
 * Os dois caminhos que nenhum teste sequencial alcança:
 *
 * 1. **Salvar o mesmo termo duas vezes ao mesmo tempo.** O índice único escolhe
 *    um; o outro recebe 23505 do PostgreSQL. `saveTerm` traduz isso em
 *    `term_duplicate` **com o id do vencedor**, porque a tela precisa levar a
 *    pessoa ao termo que existe em vez de mostrar um erro de banco.
 * 2. **Pedir a busca de novo duas vezes ao mesmo tempo.** O que se mede aqui é
 *    que a concorrência não cria captura nenhuma. A âncora de 24 horas avança
 *    por `is not distinct from`, mas a guarda de captura pendente vem antes
 *    dela: com a captura do salvamento na fila, os dois pedidos respondem
 *    `running` e nada é enfileirado. Foi o que a medição mostrou, e o caso
 *    prende isso em vez do desfecho que eu esperava.
 *
 * Um teste sequencial passa no primeiro caso sem exercitá-lo: entre a leitura e
 * a escrita não existe ninguém. Aqui os dois saem juntos, de `Promise.all`, no
 * mesmo PostgreSQL de teste.
 *
 * O resto do arquivo cobre os estados de `rerunTerm` que a tela mostra com
 * frases diferentes — pausado, captura desligada, sessão emprestada, janela de
 * espera — porque devolver o código errado mostra a frase errada.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { candidate, termCapture } from "../src/core/db/schema.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  createTrack,
  rerunTerm,
  saveTerm,
  setMatchingProfile,
  setTermStatus,
  suggestTrack,
  targetOf,
  type ActionContext,
  type Track,
} from "../src/contexts/matching/index.ts";
import { loadProfile } from "../src/core/profile/load.ts";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

const AGORA = "2026-09-21T12:00:00.000Z";
const ambiente = { ...process.env };

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
  setClock(fixedClock(AGORA));
});

afterEach(async () => {
  process.env = { ...ambiente };
  resetClock();
  await releaseTestDb();
});

const ctx = (overrides: Partial<ActionContext> = {}): ActionContext => ({
  now: new Date(AGORA),
  impersonated: false,
  ...overrides,
});

async function pessoa(slug = "dono"): Promise<number> {
  const [linha] = await db
    .insert(candidate)
    .values({ slug, name: slug, isDefault: slug === "dono" })
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

describe("dois envios simultâneos do mesmo termo", () => {
  it("UT-300 um grava, o outro recebe `term_duplicate` com o id do vencedor", async () => {
    const candidateId = await pessoa();
    const track = await trilha(candidateId, "Laravel");

    const [a, b] = await Promise.all([
      saveTerm({ candidateId }, { term: "laravel", trackId: track.id }, ctx()),
      saveTerm({ candidateId }, { term: "laravel", trackId: track.id }, ctx()),
    ]);

    const vencedores = [a, b].filter((r) => r.ok);
    const perdedores = [a, b].filter((r) => !r.ok);
    expect(vencedores).toHaveLength(1);
    expect(perdedores).toHaveLength(1);

    const perdedor = perdedores[0]!;
    const vencedor = vencedores[0]!;
    if (perdedor.ok || vencedor.ok !== true) throw new Error("estado impossível");
    expect(perdedor.code).toBe("term_duplicate");
    // O id do vencedor é o que torna a recusa útil: a tela abre o termo que
    // existe em vez de pedir para a pessoa procurá-lo. `termId` só existe no
    // ramo `term_duplicate`, então a checagem do código é o que o libera.
    if (perdedor.code !== "term_duplicate") throw new Error("estado impossível");
    expect(perdedor.termId).toBe(vencedor.termId);
  });

  it("UT-301 variações de caixa e espaço disputam a MESMA chave", async () => {
    // A chave é normalizada, então "Laravel" e " laravel " são o mesmo termo —
    // e enviados juntos disputam o mesmo índice único.
    const candidateId = await pessoa();
    const track = await trilha(candidateId, "Laravel");

    const resultados = await Promise.all([
      saveTerm({ candidateId }, { term: "Laravel", trackId: track.id }, ctx()),
      saveTerm({ candidateId }, { term: " laravel ", trackId: track.id }, ctx()),
      saveTerm({ candidateId }, { term: "LARAVEL", trackId: track.id }, ctx()),
    ]);

    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    for (const recusado of resultados.filter((r) => !r.ok)) {
      expect(recusado).toMatchObject({ code: "term_duplicate" });
    }
  });
});

describe("buscar de novo, pedido duas vezes ao mesmo tempo", () => {
  it("UT-302 nenhum dos dois enfileira uma segunda captura do mesmo dia", async () => {
    const candidateId = await pessoa();
    const track = await trilha(candidateId, "Laravel");
    const salvo = await saveTerm({ candidateId }, { term: "laravel", trackId: track.id }, ctx());
    if (!salvo.ok) throw new Error(salvo.code);

    const antes = await db.select({ id: termCapture.id }).from(termCapture);

    const [a, b] = await Promise.all([
      rerunTerm({ candidateId }, salvo.termId, ctx()),
      rerunTerm({ candidateId }, salvo.termId, ctx()),
    ]);

    // Medido: com a captura do salvamento ainda na fila, os DOIS pedidos
    // respondem `running`. A guarda de captura pendente vem antes da janela de
    // 24 horas, e é a resposta certa — enfileirar de novo gastaria cota da
    // plataforma para buscar o que já está sendo buscado.
    for (const resultado of [a, b]) {
      expect(resultado, JSON.stringify(resultado)).toMatchObject({
        ok: false,
        code: "running",
      });
    }

    // A prova que importa: a concorrência não criou linha de captura nenhuma.
    const depois = await db.select({ id: termCapture.id }).from(termCapture);
    expect(depois).toHaveLength(antes.length);
  });
});

describe("os estados em que buscar de novo não busca", () => {
  async function termoSalvo(): Promise<{ candidateId: number; termId: number }> {
    const candidateId = await pessoa();
    const track = await trilha(candidateId, "Laravel");
    const salvo = await saveTerm({ candidateId }, { term: "laravel", trackId: track.id }, ctx());
    if (!salvo.ok) throw new Error(salvo.code);
    return { candidateId, termId: salvo.termId };
  }

  it("UT-303 termo que não existe é `not_found`, e não um sucesso vazio", async () => {
    const candidateId = await pessoa();

    await expect(rerunTerm({ candidateId }, 987_654, ctx())).resolves.toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("UT-304 termo pausado recusa: pausar é «nem sozinho, nem pela mão»", async () => {
    const { candidateId, termId } = await termoSalvo();
    await setTermStatus({ candidateId }, termId, "paused");

    await expect(rerunTerm({ candidateId }, termId, ctx())).resolves.toMatchObject({
      ok: false,
      code: "paused",
    });
  });

  it("UT-305 sessão emprestada não dispara captura, e diz que a varredura pega", async () => {
    // Um admin olhando pela conta de alguém não gasta a cota dessa pessoa nem
    // enfileira trabalho em nome dela. A varredura periódica continua valendo.
    const { candidateId, termId } = await termoSalvo();

    await expect(
      rerunTerm({ candidateId }, termId, ctx({ impersonated: true })),
    ).resolves.toMatchObject({ ok: true, run: "waiting_sweep" });
  });

  it("UT-306 com a captura desligada pelo ambiente, responde `captures_off`", async () => {
    const { candidateId, termId } = await termoSalvo();
    // A política de ingestão nega por omissão; a tela precisa dizer "desligada"
    // e não "nada encontrado", que sugeriria que a busca rodou.
    delete process.env.JHO_ENV;
    delete process.env.JHO_INGESTION_OPT_IN;

    await expect(rerunTerm({ candidateId }, termId, ctx())).resolves.toMatchObject({
      ok: true,
      run: "captures_off",
    });
  });

  it("UT-307 captura pendente recusa antes da janela de 24 horas ser consultada", async () => {
    const { candidateId, termId } = await termoSalvo();

    // A ordem das guardas é observável: com captura de hoje na fila a resposta é
    // `running`, e não `cooldown`. As duas recusam, mas dizem coisas diferentes
    // — "já está buscando" é informação, "espere até amanhã" seria engano.
    await expect(rerunTerm({ candidateId }, termId, ctx())).resolves.toMatchObject({
      ok: false,
      code: "running",
    });
  });
});
