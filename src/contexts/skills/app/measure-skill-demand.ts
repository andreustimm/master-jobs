import { measureDemand } from "../domain/gap.ts";
import type { MarketSkillDemand } from "../domain/types.ts";
import type {
  CandidateSkillPort,
  SkillCatalogPort,
  TargetCorpusPort,
} from "../ports.ts";

export type MeasureSkillDemandInput = {
  candidateId: number;
  minFit?: number;
  corpusLimit?: number;
};

export async function measureSkillDemand(
  input: MeasureSkillDemandInput,
  deps: {
    catalog: Pick<SkillCatalogPort, "all">;
    candidates: Pick<CandidateSkillPort, "list">;
    corpus: TargetCorpusPort;
  },
): Promise<MarketSkillDemand[]> {
  // Duas de cada vez, nunca três.
  //
  // O cliente abre três conexões, e as três consultas disparadas juntas
  // consumiam exatamente as três. Uma requisição sozinha cabe — e por isso esta
  // tela respondia 200 quando ninguém mais a pedia. Mas a instância serverless
  // é reaproveitada entre requisições concorrentes: duas requisições na mesma
  // instância pedem seis conexões a um pool de três, cada uma espera a outra, e
  // a Vercel mata as duas aos trinta segundos. Nos logs de produção dá para ver
  // exatamente isso — um 200, e 266ms depois um 504 na mesma rota.
  //
  // A pesada vai sozinha, depois das duas leves, para que sempre sobre uma
  // conexão para o resto da requisição.
  const [catalog, candidateSkills] = await Promise.all([
    deps.catalog.all(),
    deps.candidates.list(input.candidateId),
  ]);
  const corpus = await deps.corpus.targetTexts({
    candidateId: input.candidateId,
    minFit: input.minFit ?? 60,
    limit: input.corpusLimit ?? 400,
  });
  const statusBySlug = new Map(candidateSkills.map((entry) => [entry.slug, entry.status]));
  const demandBySlug = new Map(measureDemand(catalog, corpus).map((entry) => [entry.slug, entry]));

  return catalog
    .map((entry): MarketSkillDemand => {
      const postings = demandBySlug.get(entry.slug)?.jobCount ?? 0;
      return {
        slug: entry.slug,
        name: entry.name,
        category: entry.category,
        demand: corpus.length === 0 ? 0 : postings / corpus.length,
        postings,
        candidateStatus: statusBySlug.get(entry.slug) ?? null,
      };
    })
    .filter((entry) => entry.postings > 0)
    .sort((a, b) => b.demand - a.demand || a.name.localeCompare(b.name));
}
