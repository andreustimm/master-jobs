/**
 * Casos de uso das trilhas de alvo. Orquestração burra: valida pelo domínio,
 * grava pelo adapter, pede repontuação quando o alvo muda.
 *
 * O candidato vem sempre de quem chama — a sessão, nunca a entrada do usuário.
 */
import { and, eq } from "drizzle-orm";
import { clock } from "../../../core/clock.ts";
import { getDb } from "../../../core/db/client.ts";
import { isDuplicateKey } from "../../../core/db/retry.ts";
import { targetTrack } from "../../../core/db/schema.ts";
import { loadProfile } from "../../../core/profile/load.ts";
import { ProfileSchema, type Profile } from "../../../core/profile/schema.ts";
import { enqueueScore } from "../../../core/scoring/queue.ts";
import { loadRates } from "../../fx/index.ts";
import { candidateSkills, listCatalog } from "../../skills/index.ts";
import { validateTerm, type TermError, type ValidTerm } from "../../../core/term.ts";
import {
  effectiveProfile,
  evidenceInherited,
  evidenceSupport,
  inheritedFields,
  MAX_ACTIVE_TRACKS,
  nameKey,
  suggestTrack,
  targetOf,
  validateTrackName,
  validateTrackTarget,
  type OwnEvidence,
  type Track,
  type TrackError,
  type TrackTarget,
} from "../domain/track.ts";
import {
  loadCandidateMatchingProfile,
  profileHash,
  saveCandidateMatchingProfile,
} from "../infra/drizzle-profile.ts";
import {
  countActive,
  findTrack,
  isOwner,
  listTracks,
  lockCandidateTracks,
  nextPosition,
  pauseTermsOf,
  resumeTermsOf,
  toTrack,
} from "../infra/drizzle-tracks.ts";
import { MAX_ACTIVE_TERMS } from "../domain/saved-term.ts";
import { countActiveTerms } from "../infra/drizzle-saved-terms.ts";

/** Nome da trilha principal criada a partir do perfil existente. */
export const PRIMARY_TRACK_NAME = "Principal";

export type PersonProfile = { profile: Profile; source: "candidate" | "default" };

/**
 * O perfil da pessoa.
 *
 * O gravado, quando existe. O dono da instalação sem perfil gravado usa o
 * `profile.yaml` — o padrão é dele. Qualquer outro candidato sem perfil próprio
 * não tem perfil: pontuá-lo com o de outra pessoa é o defeito que a M-06 fechou.
 */
export async function personProfile(candidateId: number): Promise<PersonProfile | null> {
  const stored = await loadCandidateMatchingProfile(candidateId);
  if (stored.source === "candidate") return { profile: stored.profile, source: "candidate" };
  if (await isOwner(candidateId)) return { profile: stored.profile, source: "default" };
  return null;
}

async function unreviewedFor(candidateId: number, profile: Profile): Promise<Track["unreviewed"]> {
  return inheritedFields(profile, await loadProfile(true), { isOwner: await isOwner(candidateId) });
}

/**
 * Grava o alvo da trilha principal, criando-a se preciso.
 *
 * `unreviewed` marca o que o perfil herdou do padrão sem a pessoa ter salvo.
 */
async function writePrimary(
  candidateId: number,
  target: TrackTarget,
  unreviewed: Track["unreviewed"],
): Promise<Track> {
  const now = clock().iso();
  return getDb().transaction(async (tx) => {
    await lockCandidateTracks(tx, candidateId);
    const primary = (await listTracks(candidateId, tx)).find((track) => track.isPrimary);
    const values = { targetJson: JSON.stringify(target), unreviewedJson: JSON.stringify(unreviewed), updatedAt: now };
    if (primary) {
      const [row] = await tx.update(targetTrack).set(values).where(eq(targetTrack.id, primary.id)).returning();
      return toTrack(row!);
    }
    const [row] = await tx
      .insert(targetTrack)
      .values({
        candidateId,
        name: PRIMARY_TRACK_NAME,
        nameKey: nameKey(PRIMARY_TRACK_NAME),
        isPrimary: true,
        status: "active",
        position: await nextPosition(tx, candidateId),
        ...values,
      })
      .returning();
    return toTrack(row!);
  });
}

/**
 * A trilha principal com alvo, criando ou completando a partir do perfil.
 *
 * Idempotente. Devolve `null` quando o candidato não tem perfil próprio: a
 * principal fica pendente e ninguém pontua para ele.
 */
export async function ensurePrimaryTrack(candidateId: number): Promise<Track | null> {
  const primary = (await listTracks(candidateId)).find((track) => track.isPrimary);
  if (primary?.target) return primary;
  const person = await personProfile(candidateId);
  if (!person) return null;
  const unreviewed = person.source === "candidate" ? await unreviewedFor(candidateId, person.profile) : [];
  return writePrimary(candidateId, targetOf(person.profile), unreviewed);
}

/**
 * Grava o perfil de matching e alinha a trilha principal a ele.
 *
 * O perfil gravado continua sendo o da pessoa; a parte-alvo dele passa a morar
 * na principal. `replace` é quem grava um perfil de propósito; `fill` é a
 * derivação por currículo, que completa uma principal pendente e nunca
 * sobrescreve uma que já tem alvo — o dono edita a principal que o
 * `profile.yaml` preencheu, e o primeiro currículo apagaria essas edições.
 */
export async function saveMatchingProfile(
  candidateId: number,
  input: unknown,
  opts: { primary: "replace" | "fill" } = { primary: "replace" },
): Promise<{ hash: string }> {
  const profile = ProfileSchema.parse(input);
  const saved = await saveCandidateMatchingProfile(candidateId, profile);
  const primary = (await listTracks(candidateId)).find((track) => track.isPrimary);
  if (opts.primary === "fill" && primary?.target) return saved;
  await writePrimary(candidateId, targetOf(profile), await unreviewedFor(candidateId, profile));
  return saved;
}

export type TrackResult =
  | { ok: true; track: Track }
  | { ok: false; code: TrackError | "track_name_duplicate" | "track_limit" | "primary_pending" };

export async function createTrack(
  candidateId: number,
  input: { name: string; target: TrackTarget },
): Promise<TrackResult> {
  const name = validateTrackName(input.name);
  if (!name.ok) return name;
  const valid = validateTrackTarget(input.target, await loadRates("USD"));
  if (!valid.ok) return valid;
  await ensurePrimaryTrack(candidateId);

  let result: TrackResult;
  try {
    result = await getDb().transaction(async (tx): Promise<TrackResult> => {
      await lockCandidateTracks(tx, candidateId);
      const tracks = await listTracks(candidateId, tx);
      if (!tracks.find((track) => track.isPrimary)?.target) return { ok: false, code: "primary_pending" };
      if (tracks.some((track) => nameKey(track.name) === name.key)) return { ok: false, code: "track_name_duplicate" };
      if ((await countActive(tx, candidateId)) >= MAX_ACTIVE_TRACKS) return { ok: false, code: "track_limit" };
      const [row] = await tx
        .insert(targetTrack)
        .values({
          candidateId,
          name: name.name,
          nameKey: name.key,
          isPrimary: false,
          status: "active",
          position: await nextPosition(tx, candidateId),
          targetJson: JSON.stringify(input.target),
          unreviewedJson: "[]",
          updatedAt: clock().iso(),
        })
        .returning();
      return { ok: true, track: toTrack(row!) };
    });
  } catch (error) {
    if (isDuplicateKey(error)) return { ok: false, code: "track_name_duplicate" };
    throw error;
  }
  if (result.ok) await enqueueScore(candidateId, { origin: "perfil" });
  return result;
}

export type UpdateTrackResult =
  | TrackResult
  | { ok: false; code: "not_found" }
  | { ok: false; code: "stale"; current: Track };

/**
 * Salva a edição de uma trilha.
 *
 * `expectedUpdatedAt` é o carimbo que a tela leu: se outra aba salvou no meio,
 * a gravação é recusada com os valores atuais em vez de apagar a edição dela.
 * Salvar é revisar — os campos marcados como herdados deixam de estar.
 */
export async function updateTrack(
  candidateId: number,
  trackId: number,
  input: { name?: string; target: TrackTarget; expectedUpdatedAt: string },
): Promise<UpdateTrackResult> {
  const name = input.name === undefined ? null : validateTrackName(input.name);
  if (name && !name.ok) return name;
  const valid = validateTrackTarget(input.target, await loadRates("USD"));
  if (!valid.ok) return valid;

  let result: UpdateTrackResult;
  try {
    result = await getDb().transaction(async (tx): Promise<UpdateTrackResult> => {
      await lockCandidateTracks(tx, candidateId);
      const track = await findTrack(candidateId, trackId, tx);
      if (!track) return { ok: false, code: "not_found" };
      if (track.updatedAt !== input.expectedUpdatedAt) return { ok: false, code: "stale", current: track };
      const others = (await listTracks(candidateId, tx)).filter((other) => other.id !== trackId);
      if (name && others.some((other) => nameKey(other.name) === name.key)) {
        return { ok: false, code: "track_name_duplicate" };
      }
      const [row] = await tx
        .update(targetTrack)
        .set({
          ...(name ? { name: name.name, nameKey: name.key } : {}),
          targetJson: JSON.stringify(input.target),
          unreviewedJson: "[]",
          updatedAt: clock().iso(),
        })
        .where(eq(targetTrack.id, trackId))
        .returning();
      return { ok: true, track: toTrack(row!) };
    });
  } catch (error) {
    if (isDuplicateKey(error)) return { ok: false, code: "track_name_duplicate" };
    throw error;
  }
  // Trilha arquivada não pontua; a restauração pede a repontuação.
  if (result.ok && result.track.status === "active") await enqueueScore(candidateId, { origin: "perfil" });
  return result;
}

export type LifecycleResult =
  | { ok: true; track: Track }
  | { ok: false; code: "not_found" | "track_archived" | "primary_cannot_archive" | "track_limit" };

/**
 * Promove uma trilha a principal. A principal pontua o acervo inteiro e a
 * antiga passa a pontuar só o relevante, então a troca pede repontuação.
 */
export async function setPrimaryTrack(candidateId: number, trackId: number): Promise<LifecycleResult> {
  const result = await getDb().transaction(async (tx): Promise<LifecycleResult> => {
    await lockCandidateTracks(tx, candidateId);
    const track = await findTrack(candidateId, trackId, tx);
    if (!track) return { ok: false, code: "not_found" };
    if (track.status === "archived") return { ok: false, code: "track_archived" };
    if (track.isPrimary) return { ok: true, track };
    const now = clock().iso();
    await tx
      .update(targetTrack)
      .set({ isPrimary: false, updatedAt: now })
      .where(and(eq(targetTrack.candidateId, candidateId), eq(targetTrack.isPrimary, true)));
    const [row] = await tx
      .update(targetTrack)
      .set({ isPrimary: true, updatedAt: now })
      .where(eq(targetTrack.id, trackId))
      .returning();
    return { ok: true, track: toTrack(row!) };
  });
  if (result.ok) await enqueueScore(candidateId, { origin: "perfil" });
  return result;
}

/**
 * Arquiva uma trilha: some do seletor, deixa de mostrar fit e pausa os termos
 * dela. Nunca apaga vaga, candidatura ou nota — restaurar devolve tudo.
 */
export async function archiveTrack(candidateId: number, trackId: number): Promise<LifecycleResult> {
  return getDb().transaction(async (tx): Promise<LifecycleResult> => {
    await lockCandidateTracks(tx, candidateId);
    const track = await findTrack(candidateId, trackId, tx);
    if (!track) return { ok: false, code: "not_found" };
    if (track.isPrimary) return { ok: false, code: "primary_cannot_archive" };
    if (track.status === "archived") return { ok: true, track };
    const now = clock().iso();
    const [row] = await tx
      .update(targetTrack)
      .set({ status: "archived", updatedAt: now })
      .where(eq(targetTrack.id, trackId))
      .returning();
    await pauseTermsOf(tx, trackId, now);
    return { ok: true, track: toTrack(row!) };
  });
}

export async function restoreTrack(candidateId: number, trackId: number): Promise<LifecycleResult> {
  const result = await getDb().transaction(async (tx): Promise<LifecycleResult> => {
    await lockCandidateTracks(tx, candidateId);
    const track = await findTrack(candidateId, trackId, tx);
    if (!track) return { ok: false, code: "not_found" };
    if (track.status === "active") return { ok: true, track };
    if ((await countActive(tx, candidateId)) >= MAX_ACTIVE_TRACKS) return { ok: false, code: "track_limit" };
    const now = clock().iso();
    const [row] = await tx
      .update(targetTrack)
      .set({ status: "active", updatedAt: now })
      .where(eq(targetTrack.id, trackId))
      .returning();
    await resumeTermsOf(tx, trackId, now, MAX_ACTIVE_TERMS - (await countActiveTerms(tx, candidateId)));
    return { ok: true, track: toTrack(row!) };
  });
  if (result.ok) await enqueueScore(candidateId, { origin: "perfil" });
  return result;
}

export type TrackOverview = {
  /** Sem perfil próprio: principal pendente, nada pontua. */
  pending: boolean;
  tracks: Array<Track & { support: { supported: string[]; gaps: string[] } }>;
};

/** A evidência que é da pessoa: linhas do currículo e competências confirmadas. */
async function ownEvidence(candidateId: number): Promise<OwnEvidence> {
  // Duas consultas de cada vez, nunca três: o pool tem três conexões e a
  // instância serverless é reaproveitada entre requisições, então um caminho
  // que pede as três exatas deixa a requisição do lado esperando até os 30s da
  // Vercel. `loadProfile` lê arquivo e não gasta conexão, por isso viaja junto.
  const [person, owner] = await Promise.all([personProfile(candidateId), isOwner(candidateId)]);
  const [confirmed, defaultProfile] = await Promise.all([
    candidateSkills(candidateId, "confirmed"),
    loadProfile(true),
  ]);
  return {
    lines: person ? Object.values(person.profile.evidence).flat() : [],
    confirmedSkills: confirmed.map((skill) => skill.name),
    inherited: person ? evidenceInherited(person.profile, defaultProfile, { isOwner: owner }) : false,
  };
}

/**
 * As trilhas do candidato com o marcador de evidência de cada uma.
 *
 * A migração 0005 deixa a principal do dono sem perfil gravado com alvo nulo,
 * para a aplicação copiar o `profile.yaml` no primeiro uso: esta leitura é o
 * primeiro uso da tela Buscas.
 */
export async function trackOverview(candidateId: number): Promise<TrackOverview> {
  await ensurePrimaryTrack(candidateId);
  // Em série: `ownEvidence` já usa duas conexões, e somar `listTracks` a elas
  // devolveria o pico a três — o pool inteiro, que é o que trava a requisição
  // do lado.
  const tracks = await listTracks(candidateId);
  const evidence = await ownEvidence(candidateId);
  return {
    pending: !tracks.find((track) => track.isPrimary)?.target,
    tracks: tracks.map((track) => ({
      ...track,
      support: track.target ? evidenceSupport(track.target, evidence) : { supported: [], gaps: [] },
    })),
  };
}

export type TrackSuggestion =
  | {
      ok: true;
      term: ValidTerm;
      target: TrackTarget;
      /** The term is not in the skill catalog: the suggestion is thin. */
      thin: boolean;
      support: { supported: string[]; gaps: string[] };
      /** The CV the evidence came from is the default profile's. */
      inherited: boolean;
    }
  | { ok: false; code: TermError | "primary_pending" };

/**
 * A track to start from for a term: catalog titles and the term as the key
 * keyword, the primary's pay ranges and seniority, and how much of it the
 * candidate's own evidence supports. Nothing is saved — the candidate edits
 * and confirms (ADR-002, ADR-009).
 */
export async function trackSuggestion(candidateId: number, rawTerm: string): Promise<TrackSuggestion> {
  const valid = validateTerm(rawTerm);
  if (!valid.ok) return { ok: false, code: valid.code };
  const primary = await ensurePrimaryTrack(candidateId);
  if (!primary?.target) return { ok: false, code: "primary_pending" };
  // Em série: `ownEvidence` já consulta três coisas ao mesmo tempo e o pool tem
  // três conexões. Ver o comentário em `app/candidate/skills/page.tsx`.
  const catalog = await listCatalog();
  const evidence = await ownEvidence(candidateId);
  const suggestion = suggestTrack({ term: valid.value, catalog, primary: primary.target });
  return {
    ok: true,
    term: valid.value,
    target: suggestion.target,
    thin: suggestion.thin,
    support: evidenceSupport(suggestion.target, evidence),
    inherited: evidence.inherited,
  };
}

/** Evidence support for a target the candidate is editing. */
export async function trackSupport(
  candidateId: number,
  target: TrackTarget,
): Promise<{ supported: string[]; gaps: string[]; inherited: boolean }> {
  const evidence = await ownEvidence(candidateId);
  return { ...evidenceSupport(target, evidence), inherited: evidence.inherited };
}

export type TrackScoringProfile = { track: Track; profile: Profile; hash: string };

/**
 * O perfil efetivo de cada trilha ativa, para o scorer.
 *
 * `null` quando a principal está pendente: sem perfil próprio, não se pontua.
 */
export async function trackScoringProfiles(candidateId: number): Promise<TrackScoringProfile[] | null> {
  const primary = await ensurePrimaryTrack(candidateId);
  if (!primary?.target) return null;
  const person = await personProfile(candidateId);
  if (!person) return null;
  return (await listTracks(candidateId))
    .filter((track) => track.status === "active" && track.target)
    .map((track) => {
      const profile = effectiveProfile(person.profile, track.target!);
      // O papel entra no hash: trocar a principal muda o que a trilha pontua (a
      // aceita só o relevante), e sem isso as linhas da antiga principal
      // continuavam "frescas" e o portão de relevância nunca era reaplicado.
      const hash = profileHash(profile);
      return { track, profile, hash: track.isPrimary ? hash : `${hash}:accepted` };
    });
}
