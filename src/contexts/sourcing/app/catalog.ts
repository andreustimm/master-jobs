/**
 * Casos de uso do catálogo. Orquestração burra: validar com o domínio, gravar
 * pela infra recebida, devolver o código que a tela traduz.
 */
import { HttpError } from "../../../core/sources/http-port.ts";
import type { SourceSnapshot } from "../../../core/sources/types.ts";
import {
  classifySourceProbe,
  validateCatalogWrite,
  type CatalogError,
  type CatalogWrite,
  type SourceProbeOutcome,
} from "../domain/catalog.ts";

export type RegisterDeps = {
  existing(): Promise<{ kind: string; handle: string }[]>;
  insert(write: CatalogWrite, now: string): Promise<{ ok: true; id: string } | { ok: false }>;
  now(): string;
};

export async function registerSource(
  input: CatalogWrite,
  deps: RegisterDeps,
): Promise<{ ok: true; id: string } | { ok: false; code: CatalogError }> {
  const valid = validateCatalogWrite(input, await deps.existing());
  if (!valid.ok) return valid;
  const written = await deps.insert(valid.value, deps.now());
  // A validação leu antes; dois cadastros simultâneos do mesmo handle chegam
  // aqui e o índice único decide quem fica.
  return written.ok ? written : { ok: false, code: "duplicate" };
}

export type ProbeReport = {
  outcome: SourceProbeOutcome;
  status: number | null;
  count: number | null;
  completeness: SourceSnapshot["completeness"] | null;
};

/**
 * Sonda um handle sem gravar nada: nem vaga, nem saúde da fonte, nem cota. É a
 * mesma pergunta do `jho sources probe`, atrás da guarda de quem chama.
 */
export async function probeSource(readListing: () => Promise<SourceSnapshot>): Promise<ProbeReport> {
  try {
    const snapshot = await readListing();
    const count = snapshot.jobs.length;
    // Adapter que engole a falha (careers sem resposta, robots.txt negando)
    // devolve lista vazia, parcial e com aviso. Isso não é board vazio: é não
    // ter lido. Lista COMPLETA e vazia prova o vazio mesmo com aviso — o Ashby
    // avisa em todo board sem vaga listada.
    if (count === 0 && snapshot.warnings.length > 0 && snapshot.completeness !== "complete") {
      return { outcome: classifySourceProbe({ status: null, count: null }), status: null, count: null, completeness: null };
    }
    return { outcome: classifySourceProbe({ status: 200, count }), status: 200, count, completeness: snapshot.completeness };
  } catch (error) {
    const status = error instanceof HttpError ? error.status : null;
    return { outcome: classifySourceProbe({ status, count: null }), status, count: null, completeness: null };
  }
}
