/**
 * Os limites e os estados vazios do contexto de matching.
 *
 * O que faltava em `saved-terms.ts` (85,8% de branches) e `tracks.ts` (87,4%) era
 * quase todo de um tipo: o que acontece **no teto** e **antes de existir perfil**.
 *
 * Os dois são estados reais e desagradáveis — conta recém-criada, e vigésimo
 * primeiro termo salvo — e nenhum aparece num teste de caminho feliz, porque o
 * caminho feliz tem perfil e salva um termo.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { candidate } from "../src/core/db/schema.ts";
import type { DB } from "../src/core/db/client.ts";
import {
  createTrack,
  ensurePrimaryTrack,
  personProfile,
  saveTerm,
  setMatchingProfile,
  setTermStatus,
  suggestTrack,
  targetOf,
  termAvailability,
  termOverview,
  trackOverview,
  trackScoringProfiles,
  trackSuggestion,
  type ActionContext,
  type Track,
} from "../src/contexts/matching/index.ts";
import { MAX_ACTIVE_TERMS } from "../src/contexts/matching/domain/saved-term.ts";
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

const ctx = (): ActionContext => ({ now: new Date(AGORA), impersonated: false });

/** Candidato COM perfil de matching — o caminho normal. */
async function comPerfil(slug = "dono"): Promise<number> {
  const [linha] = await db
    .insert(candidate)
    .values({ slug, name: slug, isDefault: slug === "dono" })
    .returning({ id: candidate.id });
  await setMatchingProfile(linha!.id, await loadProfile(true));
  return linha!.id;
}

/** Candidato SEM perfil — o estado de uma conta recém-criada. */
async function semPerfil(slug = "novo"): Promise<number> {
  const [linha] = await db
    .insert(candidate)
    .values({ slug, name: slug, isDefault: false })
    .returning({ id: candidate.id });
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

describe("o teto de termos ativos", () => {
  it("UT-230 no limite, salvar o próximo é recusado com `term_limit`", async () => {
    const candidateId = await comPerfil();
    const track = await trilha(candidateId, "Laravel");

    for (let i = 0; i < MAX_ACTIVE_TERMS; i += 1) {
      const salvo = await saveTerm({ candidateId }, { term: `termo${i}`, trackId: track.id }, ctx());
      expect(salvo.ok, `termo${i}`).toBe(true);
    }

    const excedente = await saveTerm(
      { candidateId },
      { term: "umAMais", trackId: track.id },
      ctx(),
    );
    expect(excedente).toMatchObject({ ok: false, code: "term_limit" });

    // E a porta que a tela usa antes de enviar diz o mesmo, sem tentar gravar.
    await expect(termAvailability({ candidateId }, "outroQualquer")).resolves.toMatchObject({
      ok: false,
      code: "term_limit",
    });
  });

  it("UT-231 pausar libera vaga, e reativar no teto é recusado", async () => {
    const candidateId = await comPerfil();
    const track = await trilha(candidateId, "Laravel");
    const ids: number[] = [];
    for (let i = 0; i < MAX_ACTIVE_TERMS; i += 1) {
      const salvo = await saveTerm({ candidateId }, { term: `t${i}`, trackId: track.id }, ctx());
      if (!salvo.ok) throw new Error(salvo.code);
      ids.push(salvo.termId);
    }

    // Pausar um abre espaço: o teto conta ATIVOS.
    await expect(setTermStatus({ candidateId }, ids[0]!, "paused")).resolves.toMatchObject({
      ok: true,
    });
    const caber = await saveTerm({ candidateId }, { term: "novo", trackId: track.id }, ctx());
    expect(caber.ok).toBe(true);

    // Agora reativar o pausado excederia — e é recusado em vez de estourar.
    const reativar = await setTermStatus({ candidateId }, ids[0]!, "active");
    expect(reativar.ok).toBe(false);
  });
});

describe("antes de existir perfil de matching", () => {
  it("UT-232 candidato sem perfil não tem perfil de pessoa nem de pontuação", async () => {
    const candidateId = await semPerfil();

    await expect(personProfile(candidateId)).resolves.toBeNull();
    await expect(trackScoringProfiles(candidateId)).resolves.toBeNull();
  });

  it("UT-233 a visão das trilhas sem perfil declara pendência e não inventa apoio", async () => {
    const candidateId = await semPerfil();

    const visao = await trackOverview(candidateId);

    // `pending` é o campo que a tela usa para dizer "principal pendente, nada
    // pontua". Sem perfil próprio ele tem de ser verdadeiro — dizer o contrário
    // faria a tela prometer nota que não existe.
    expect(visao.pending).toBe(true);
    // E nenhuma trilha listada pode alegar apoio: sem evidência, `supported`
    // vazio é a resposta honesta, e inventar aqui quebraria a regra 7 na origem.
    for (const track of visao.tracks) {
      expect(track.support.supported, track.name).toEqual([]);
    }
  });

  it("UT-234 sugerir trilha sem primária com alvo responde `primary_pending`", async () => {
    // `ensurePrimaryTrack` cria a primária, mas sem perfil ela nasce sem alvo:
    // é o estado de quem entrou e ainda não salvou currículo.
    const candidateId = await semPerfil();
    await ensurePrimaryTrack(candidateId);

    const sugestao = await trackSuggestion(candidateId, "laravel");

    expect(sugestao).toMatchObject({ ok: false, code: "primary_pending" });
  });

  it("UT-235 criar trilha sem primária com alvo também é `primary_pending`", async () => {
    const candidateId = await semPerfil();
    const primary = targetOf(await loadProfile(true));

    const resultado = await createTrack(candidateId, {
      name: "Laravel",
      target: suggestTrack({ term: "laravel", catalog: [], primary }).target,
    });

    expect(resultado).toMatchObject({ ok: false, code: "primary_pending" });
  });
});

describe("com a ingestão bloqueada pelo ambiente", () => {
  it("UT-236 termo que nunca rodou aparece como `captures_off`, não como erro", async () => {
    const candidateId = await comPerfil();
    const track = await trilha(candidateId, "Laravel");

    // O bloqueio vem ANTES de salvar, senão o próprio `saveTerm` pede a captura
    // e o termo nasce `running` — nunca alcançando o estado que este caso mede.
    //
    // A política de ingestão nega por omissão: sem ambiente declarado o contexto
    // normaliza para `preview` e bloqueia. A tela então tem de dizer "captura
    // desligada" em vez de "nunca rodou", que sugeriria espera.
    delete process.env.JHO_ENV;
    delete process.env.JHO_INGESTION_OPT_IN;

    const salvo = await saveTerm({ candidateId }, { term: "laravel", trackId: track.id }, ctx());
    if (!salvo.ok) throw new Error(salvo.code);

    const visao = await termOverview({ candidateId }, new Date(AGORA));

    expect(visao.terms.find((t) => t.id === salvo.termId)?.run).toBe("captures_off");
  });
});
