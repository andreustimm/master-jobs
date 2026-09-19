/**
 * Regras da captura por termo. Puras: sem banco, sem rede, sem relógio.
 */
import { matchesTerm } from "../../../core/term.ts";
import { HttpError } from "../../../core/sources/http-port.ts";
import type {
  FetchableSourceKind,
  RawJob,
  SourceAdapter,
  SourceConfig,
} from "../../../core/sources/types.ts";

/** Quantas vagas uma captura observa por plataforma, no máximo. */
export const CAPTURE_LIMIT = 100;

export type FailureCode = "http_error" | "network" | "parse" | "endpoint_gone";

export type CaptureFailure =
  | { status: "waiting_quota"; exhaustDay: true }
  | { status: "failed"; code: FailureCode; retryable: boolean };

/**
 * O que um erro da plataforma significa para a fila.
 *
 * 429 é a plataforma dizendo que o dia acabou: a cota do dia inteiro vai a
 * zero e a captura espera a próxima janela, em vez de falhar. 404/410 no
 * endpoint de busca é integração quebrada, não vaga sumida — não adianta
 * repetir amanhã, e a tela de saúde precisa mostrar. O resto é transitório.
 */
export function classifyCaptureFailure(error: unknown): CaptureFailure {
  if (error instanceof HttpError) {
    if (error.status === 429) return { status: "waiting_quota", exhaustDay: true };
    if (error.status === 404 || error.status === 410) {
      return { status: "failed", code: "endpoint_gone", retryable: false };
    }
    return { status: "failed", code: "http_error", retryable: true };
  }
  if (error instanceof SyntaxError) return { status: "failed", code: "parse", retryable: true };
  return { status: "failed", code: "network", retryable: true };
}

/**
 * A vaga menciona o termo?
 *
 * Decidido na captura, porque as tags só existem no payload da plataforma e a
 * observação descarta esse payload. A busca da plataforma devolve vaga que não
 * cita o termo (a Remotive devolveu 16 para "Laravel", 6 citavam); só a que
 * cita entra no filtro "trazida por".
 */
export function isAttributable(
  term: string,
  raw: Pick<RawJob, "title" | "companyName" | "descriptionText" | "tags">,
): boolean {
  const texts = [raw.title, raw.companyName, raw.descriptionText ?? "", ...(raw.tags ?? [])];
  return texts.some((text) => text.length > 0 && matchesTerm(term, text));
}

function postedTime(raw: Pick<RawJob, "postedAt">): number {
  const time = raw.postedAt ? Date.parse(raw.postedAt) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * As `max` mais recentes; sem data vão para o fim, na ordem em que vieram.
 * `totalHint` guarda quantas a plataforma devolveu, para "100 de cerca de N".
 */
export function capNewest<T extends Pick<RawJob, "postedAt">>(
  raws: readonly T[],
  max: number,
): { jobs: T[]; totalHint: number } {
  const ordered = raws
    .map((raw, index) => ({ raw, index, time: postedTime(raw) }))
    .sort((a, b) => (b.time === a.time ? a.index - b.index : b.time > a.time ? 1 : -1));
  return { jobs: ordered.slice(0, max).map((entry) => entry.raw), totalHint: raws.length };
}

/** Plataformas com busca por termo validada contra a API real. */
export function validatedPlatforms(adapters: Iterable<SourceAdapter>): FetchableSourceKind[] {
  return [...adapters]
    .filter((adapter) => adapter.termSearch !== undefined && adapter.termSearch.validatedOn !== null)
    .map((adapter) => adapter.kind);
}

/**
 * Onde uma captura pode rodar: busca validada e plataforma ligada no
 * `sources.yaml`. Candidato nenhum liga plataforma (ADR-004).
 */
export function reachablePlatforms(
  adapters: Iterable<SourceAdapter>,
  config: readonly SourceConfig[],
): FetchableSourceKind[] {
  const enabled = new Set(config.map((entry) => entry.kind));
  return validatedPlatforms(adapters).filter((kind) => enabled.has(kind));
}

const PLATFORM_NAMES: Partial<Record<FetchableSourceKind, string>> = {
  hackernews: "Hacker News",
  himalayas: "Himalayas",
  jobicy: "Jobicy",
  remoteok: "RemoteOK",
  remotive: "Remotive",
  workable: "Workable",
};

/** A fonte das capturas por termo: nunca sincronizada, nunca no YAML (ADR-011). */
export function termSource(kind: FetchableSourceKind): { id: string; handle: string; label: string } {
  const name = PLATFORM_NAMES[kind] ?? kind;
  return { id: `${kind}:~terms`, handle: "~terms", label: `${name} — termos` };
}
