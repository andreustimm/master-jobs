/**
 * Composição do dicionário de sinônimos: flag, arquivo e cache (#370, Fase 0).
 *
 * É a borda que lê ambiente e disco; `synonyms.ts` só valida o que recebe.
 * Leitura síncrona e em cache porque o filtro da URL (`readFilters`) é
 * síncrono e roda em toda requisição de Vagas.
 *
 * Desligada (padrão), devolve a lista vazia sem tocar no disco: a busca é
 * exatamente a de antes. Ligada com arquivo ilegível ou inválido, a busca
 * também volta a ser a de antes e o defeito vai para o log — uma lista
 * quebrada não derruba a tela Vagas. O teste que carrega o arquivo versionado
 * é quem reprova a lista inválida antes de ela chegar aqui.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { buildSynonymDictionary, EMPTY_SYNONYMS, type SynonymDictionary } from "./synonyms.ts";

export function synonymsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.SEARCH_SYNONYMS_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export function synonymsPath(env: Record<string, string | undefined> = process.env): string {
  return env.JHO_SEARCH_SYNONYMS_PATH?.trim() || resolve(process.cwd(), "config/search-synonyms.yaml");
}

/** Lê e valida o arquivo, sem cache e sem olhar a flag. Lança se for inválido. */
export function readSynonymDictionary(path: string): SynonymDictionary {
  return buildSynonymDictionary(parse(readFileSync(path, "utf8")));
}

let cached: { path: string; dictionary: SynonymDictionary } | undefined;

export function searchSynonyms(env: Record<string, string | undefined> = process.env): SynonymDictionary {
  if (!synonymsEnabled(env)) return EMPTY_SYNONYMS;
  const path = synonymsPath(env);
  if (cached?.path === path) return cached.dictionary;
  let dictionary = EMPTY_SYNONYMS;
  try {
    dictionary = readSynonymDictionary(path);
  } catch (error) {
    console.error(`[search-synonyms] lista ignorada: ${error instanceof Error ? error.message : String(error)}`);
  }
  cached = { path, dictionary };
  return dictionary;
}

/** Só para teste: esquece o cache. */
export function resetSynonymsCache(): void {
  cached = undefined;
}
