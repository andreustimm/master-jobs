/**
 * O diretório de perfis para recrutadores (#465, ADR-010, ADR-013).
 *
 * Recrutador autenticado busca, por texto e filtros simples, os perfis que a
 * própria pessoa marcou como Recrutadores ou Público, e lê só a lista de
 * permissão de `toAllowlistedProfile()` — a mesma do `/p/`. Três decisões que
 * não mudam com o pedido:
 *
 * - **As visibilidades são constante deste módulo** (`DIRECTORY_VISIBILITIES`).
 *   Nenhum parâmetro da requisição chega ao filtro de visibilidade nem à lista
 *   de campos; parâmetro desconhecido é ignorado por `parseDirectoryQuery()`.
 * - **O texto casa só o que o cartão mostra:** nome, headline e skill
 *   CONFIRMADA, e a localização casa a localização mostrada. Piso salarial,
 *   notas e currículo nunca entram na consulta — procurar pelo valor do piso
 *   não pode responder "achei alguém". E "mostra" é depois da lista de
 *   permissão: o campo que `toAllowlistedProfile()` esvazia por trazer contato
 *   também não casa, senão o recrutador digitaria um telefone escondido e
 *   descobriria de quem é (`matchesShown`).
 * - **Nada conta perfil Privado.** O total é o das linhas visíveis que casaram;
 *   o vazio é o mesmo com ou sem perfis privados na instalação.
 *
 * As funções puras (análise da busca, dobra de acento, decisão do limite) não
 * tocam banco nem relógio; `searchDirectory` e `recordDirectorySearch` são o
 * adapter.
 */
import { and, asc, count, eq, gt, inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { getDb } from "./db/client.ts";
import { candidate, candidateSkill, recruiterDirectoryQuery, skill } from "./db/schema.ts";
import {
  EXPERIENCE_LEVELS,
  WORK_MODELS,
  type ExperienceLevel,
  type WorkModel,
} from "./candidate-public-facts.ts";
import {
  loadAllowlistRows,
  toAllowlistedProfile,
  type ProfileVisibilities,
  type PublicProfile,
} from "./candidate-public.ts";
import { parseQuery } from "./search.ts";
import { termRegexSql, validateTerm, type ValidTerm } from "./term.ts";

/** Quem o diretório alcança. Constante no servidor: a requisição não a amplia. */
export const DIRECTORY_VISIBILITIES = ["recruiters", "public"] as const satisfies ProfileVisibilities;

/** Texto da busca: o que passar disto é cortado antes da análise. */
export const DIRECTORY_TEXT_MAX = 200;
/** Filtro de localização: texto livre, cortado aqui. */
export const DIRECTORY_LOCATION_MAX = 100;
/** Cartões por página. */
export const DIRECTORY_PAGE_SIZE = 20;
/** Buscas por recrutador na janela (ADR-017). */
export const DIRECTORY_RATE_LIMIT = 60;
export const DIRECTORY_RATE_WINDOW_MS = 10 * 60_000;

/**
 * Visibilidade guardada que o diretório lista. Valor desconhecido ou ausente
 * conta como Privado (US-030.EC-3): a coluna é texto, e uma grafia errada não
 * pode virar exposição.
 */
export function isDirectoryVisible(visibility: unknown): boolean {
  return typeof visibility === "string" && (DIRECTORY_VISIBILITIES as readonly string[]).includes(visibility);
}

/**
 * Letras acentuadas do português e vizinhas, e o que cada uma vira. A MESMA
 * tabela serve ao TypeScript e ao `translate()` do PostgreSQL: se as duas
 * dobras discordassem, "senior" acharia "Sênior" num lado e não no outro.
 */
const ACCENTED = "áàâãäåçéèêëíìîïñóòôõöúùûüýÿ";
const PLAIN = "aaaaaaceeeeiiiinooooouuuuyy";

/** Minúscula e sem acento: "Sênior São Paulo" → "senior sao paulo". */
export function foldAccents(text: string): string {
  let out = "";
  for (const char of text.toLowerCase()) {
    const at = ACCENTED.indexOf(char);
    out += at === -1 ? char : PLAIN[at];
  }
  return out;
}

/** A mesma dobra, no banco. `coalesce` porque headline e localização aceitam nulo. */
function foldSql(column: SQLWrapper): SQL {
  return sql`translate(lower(coalesce(${column}, '')), ${ACCENTED}, ${PLAIN})`;
}

/** A busca já analisada. Só estas chaves existem; nada da requisição passa direto. */
export type DirectoryQuery = {
  /** O texto como fica no campo da busca, já cortado. */
  text: string;
  /** Cada palavra válida, dobrada; todas precisam casar. */
  terms: ValidTerm[];
  /** Houve texto. Com texto e nenhum termo válido, o resultado é vazio. */
  textGiven: boolean;
  location: string | null;
  workModel: WorkModel | null;
  level: ExperienceLevel | null;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));

/**
 * Lê só `q`, `location`, `workModel`, `level` e `page`. Valor fora da lista é
 * descartado em silêncio — `visibility`, `fields` e qualquer outra chave nem
 * são lidas (US-026.EC-4).
 *
 * O texto passa por `parseQuery`, como a busca de vagas, e cada palavra vira um
 * termo validado por `validateTerm`: `<script>` e `!!!` não sobrevivem, e o
 * resultado é vazio em vez de "tudo" — quem digitou alguma coisa não pediu a
 * lista inteira.
 */
export function parseDirectoryQuery(params: Params): DirectoryQuery {
  const text = [...first(params.q)].slice(0, DIRECTORY_TEXT_MAX).join("").trim();
  const parsed = parseQuery(text);
  const words = [...parsed.terms, ...parsed.phrases].flatMap((part) => part.split(/\s+/)).filter(Boolean);
  const terms: ValidTerm[] = [];
  for (const word of words) {
    const valid = validateTerm(foldAccents(word));
    if (valid.ok && !terms.some((term) => term.key === valid.value.key)) terms.push(valid.value);
  }

  const location = [...first(params.location).trim()].slice(0, DIRECTORY_LOCATION_MAX).join("").trim();
  const workModel = first(params.workModel);
  const level = first(params.level);
  const rawPage = first(params.page);
  const page = /^\d+$/.test(rawPage) ? Number(rawPage) : 1;

  return {
    text,
    terms,
    textGiven: text !== "",
    location: location === "" ? null : location,
    workModel: (WORK_MODELS as readonly string[]).includes(workModel) ? (workModel as WorkModel) : null,
    level: (EXPERIENCE_LEVELS as readonly string[]).includes(level) ? (level as ExperienceLevel) : null,
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
  };
}

/**
 * O limite por recrutador, já com a busca atual contada: a 60ª passa, a 61ª
 * não. "Grava e depois conta" (ADR-017): `recorded` inclui esta busca.
 */
export function directoryRateDecision(recorded: number): { ok: boolean } {
  return { ok: recorded <= DIRECTORY_RATE_LIMIT };
}

/** O cartão de um resultado: o id da rota e campos do perfil por lista de permissão. */
export type DirectoryCard = { id: number } & Pick<PublicProfile, "name" | "headline" | "location" | "skills" | "facts">;

export type DirectoryResult = {
  cards: DirectoryCard[];
  /** Perfis VISÍVEIS que casaram — nunca inclui Privado. */
  total: number;
  /** A página servida, já trazida para dentro do intervalo. */
  page: number;
  pageCount: number;
};

/**
 * Onde cada termo pode casar: nome, headline ou o nome de uma skill
 * confirmada, sem diferenciar caixa nem acento. Termos se juntam por `and`.
 * O padrão vai como parâmetro ligado, nunca interpolado.
 *
 * No banco isto é só PRÉ-FILTRO, condição necessária: casa o valor guardado,
 * e o valor guardado pode ter contato que a lista de permissão esconde. Quem
 * decide é `matchesShown`, sobre o perfil já montado.
 */
function termCondition(term: ValidTerm): SQL {
  const pattern = termRegexSql(term.term);
  return sql`(${foldSql(candidate.name)} ~* ${pattern}
    or ${foldSql(candidate.headline)} ~* ${pattern}
    or exists (
      select 1 from ${candidateSkill}
      inner join ${skill} on ${skill.id} = ${candidateSkill.skillId}
      where ${candidateSkill.candidateId} = ${candidate.id}
        and ${candidateSkill.status} = 'confirmed'
        and ${foldSql(skill.canonicalName)} ~* ${pattern}
    ))`;
}

function conditions(query: DirectoryQuery): SQL[] {
  const out: SQL[] = [inArray(candidate.visibility, [...DIRECTORY_VISIBILITIES])];
  for (const term of query.terms) out.push(termCondition(term));
  if (query.location !== null) {
    // `strpos` e não `like`: o texto da pessoa é dado, e `%` ou `_` nele não
    // podem virar curinga.
    out.push(sql`strpos(${foldSql(candidate.location)}, ${foldAccents(query.location)}) > 0`);
  }
  // Modelo de trabalho e nível só filtram onde o opt-in está ligado: filtrar
  // pelo valor escondido diria, pela presença na lista, o que a pessoa não
  // quis mostrar.
  if (query.workModel !== null) {
    out.push(sql`${candidate.publicWorkModel} is true and ${query.workModel} = any(${candidate.workModel})`);
  }
  if (query.level !== null) {
    out.push(sql`${candidate.publicExperienceLevel} is true and ${candidate.experienceLevel} = ${query.level}`);
  }
  return out;
}

/**
 * A busca casa o perfil pelo que ele MOSTRA, já passado pela lista de
 * permissão: nome, headline e skills do cartão para o texto, a localização
 * mostrada para o filtro. Campo esvaziado por trazer contato vale vazio aqui
 * também. Puro; a mesma dobra e a mesma regex do pré-filtro do banco.
 */
export function matchesShown(
  profile: Pick<PublicProfile, "name" | "headline" | "location" | "skills">,
  query: Pick<DirectoryQuery, "terms" | "location">,
): boolean {
  const fields = [profile.name, profile.headline ?? "", ...profile.skills.map((item) => item.name)].map(foldAccents);
  for (const term of query.terms) {
    const pattern = new RegExp(termRegexSql(term.term), "i");
    if (!fields.some((field) => pattern.test(field))) return false;
  }
  return query.location === null || foldAccents(profile.location ?? "").includes(foldAccents(query.location));
}

const EMPTY: DirectoryResult = { cards: [], total: 0, page: 1, pageCount: 1 };

/**
 * Os cartões destes ids, na ordem dada. O cartão sai do MESMO montador do
 * perfil, sem o currículo: um campo que o `/p/` não libera não tem por onde
 * chegar aqui. A visibilidade é conferida de novo na carga — entre a consulta
 * dos ids e esta leitura o perfil pode ter ficado privado, e então ele some.
 */
async function loadCards(ids: number[], query: DirectoryQuery): Promise<DirectoryCard[]> {
  if (ids.length === 0) return [];
  const loaded = await loadAllowlistRows(inArray(candidate.id, ids), DIRECTORY_VISIBILITIES);
  const byId = new Map(loaded.map((item) => [item.id, item]));
  const cards: DirectoryCard[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) continue;
    const profile = toAllowlistedProfile(item.row, item.skills, null);
    if (!matchesShown(profile, query)) continue;
    cards.push({
      id,
      name: profile.name,
      headline: profile.headline,
      location: profile.location,
      skills: profile.skills,
      facts: profile.facts,
    });
  }
  return cards;
}

/**
 * Uma página do diretório, por nome e depois id. Página além da última vira a
 * última (US-026.EC-5); sem resultado, página 1 e nenhum cartão.
 */
export async function searchDirectory(query: DirectoryQuery): Promise<DirectoryResult> {
  // Texto dado e nada válido nele: vazio, sem ir ao banco.
  if (query.textGiven && query.terms.length === 0) return EMPTY;

  const db = getDb();
  const where = and(...conditions(query))!;
  const ordered = () =>
    db.select({ id: candidate.id }).from(candidate).where(where).orderBy(asc(candidate.name), asc(candidate.id));

  if (query.terms.length > 0 || query.location !== null) {
    // Com texto ou localização, o banco só pré-filtra pelo valor guardado; a
    // decisão é de `matchesShown` sobre o perfil montado. Então o total e a
    // página saem DEPOIS dela — contar no banco contaria quem só casou por um
    // campo escondido.
    const matched = await loadCards((await ordered()).map((row) => row.id), query);
    if (matched.length === 0) return EMPTY;
    const pageCount = Math.ceil(matched.length / DIRECTORY_PAGE_SIZE);
    const page = Math.min(query.page, pageCount);
    const start = (page - 1) * DIRECTORY_PAGE_SIZE;
    return { cards: matched.slice(start, start + DIRECTORY_PAGE_SIZE), total: matched.length, page, pageCount };
  }

  // Sem texto nem localização, nada casa por campo: conta e pagina no banco.
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(candidate).where(where);
  if (total === 0) return EMPTY;
  const pageCount = Math.ceil(total / DIRECTORY_PAGE_SIZE);
  const page = Math.min(query.page, pageCount);
  const ids = (await ordered().limit(DIRECTORY_PAGE_SIZE).offset((page - 1) * DIRECTORY_PAGE_SIZE)).map((row) => row.id);
  return { cards: await loadCards(ids, query), total, page, pageCount };
}

/**
 * Grava a busca e conta as da janela, nessa ordem (ADR-017). Gravar antes de
 * contar é o que faz N buscas simultâneas se enxergarem: cada uma conta, no
 * mínimo, a si mesma e as que gravaram antes — no limite, no máximo a sobra
 * passa. Busca recusada também é gravada, como a tentativa de senha errada.
 *
 * A linha não leva texto da busca nem candidato: só quem buscou e quando.
 */
export async function recordDirectorySearch(recruiterUserId: number, nowIso: string): Promise<{ ok: boolean }> {
  const db = getDb();
  await db.insert(recruiterDirectoryQuery).values({ recruiterUserId, at: nowIso });
  const since = new Date(Date.parse(nowIso) - DIRECTORY_RATE_WINDOW_MS).toISOString();
  const [{ recorded } = { recorded: 0 }] = await db
    .select({ recorded: count() })
    .from(recruiterDirectoryQuery)
    .where(and(eq(recruiterDirectoryQuery.recruiterUserId, recruiterUserId), gt(recruiterDirectoryQuery.at, since)));
  return directoryRateDecision(recorded);
}
