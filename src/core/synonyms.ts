/**
 * Dicionário bilíngue de sinônimos da consulta (#370, Fase 0).
 *
 * A lista curada à mão (`config/search-synonyms.yaml`) diz que "engenheiro" e
 * "engineer" são o mesmo pedido. Aqui só se valida e se indexa o conteúdo já
 * lido: ler o arquivo e decidir se a flag está ligada é da composição
 * (`synonyms-load.ts`), para o domínio continuar sem disco nem ambiente.
 *
 * Cada entrada passa pelo mesmo `validateTerm` do filtro, e a chave de busca é
 * a de `termKey`: sem diferença de caixa, espaço ou hífen, mas COM acento, como
 * o filtro — "sênior" e "senior" são entradas distintas, e as duas grafias
 * podem ser listadas. O dicionário só amplia, e ampliar errado é pior do que
 * não ampliar. Termo inválido, grupo de uma entrada só ou o mesmo termo
 * em dois grupos faz a carga falhar, em vez de a busca tropeçar em silêncio.
 */
import { z } from "zod";
import { validateTerm, type ValidTerm } from "./term.ts";

const SynonymsFile = z.object({
  /** Cada grupo é uma lista de termos equivalentes entre si. */
  groups: z.array(z.array(z.string()).min(2)),
});

export type SynonymDictionary = {
  /** `termKey` de um termo listado → os outros termos do grupo dele. */
  readonly lookup: ReadonlyMap<string, readonly ValidTerm[]>;
};

export const EMPTY_SYNONYMS: SynonymDictionary = { lookup: new Map() };

/**
 * Valida o conteúdo já lido e monta o índice. Lança `Error` legível, com o
 * caminho do defeito, no primeiro problema de forma ou de termo.
 */
export function buildSynonymDictionary(raw: unknown): SynonymDictionary {
  const parsed = SynonymsFile.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `search-synonyms.yaml is invalid:\n${parsed.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  const lookup = new Map<string, readonly ValidTerm[]>();
  parsed.data.groups.forEach((group, groupIndex) => {
    const members: ValidTerm[] = [];
    group.forEach((entry, entryIndex) => {
      const where = `groups.${groupIndex}.${entryIndex}`;
      const valid = validateTerm(entry);
      if (!valid.ok) throw new Error(`search-synonyms.yaml is invalid:\n  - ${where}: "${entry}" (${valid.code})`);
      members.push(valid.value);
    });
    const keys = members.map((member) => member.key);
    keys.forEach((key, index) => {
      if (lookup.has(key) || keys.indexOf(key) !== index) {
        throw new Error(
          `search-synonyms.yaml is invalid:\n  - groups.${groupIndex}.${index}: "${members[index]!.term}" appears twice`,
        );
      }
    });
    keys.forEach((key, index) => {
      lookup.set(key, members.filter((_, other) => other !== index));
    });
  });
  return { lookup };
}

/** Os outros termos do grupo de `term`; vazio quando ele não está na lista. */
export function synonymsOf(dictionary: SynonymDictionary, term: ValidTerm): readonly ValidTerm[] {
  return dictionary.lookup.get(term.key) ?? [];
}
