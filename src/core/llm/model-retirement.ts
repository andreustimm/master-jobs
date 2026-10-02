/**
 * Modelos que o provedor desligou (#438) — dado puro, sem banco nem rede.
 *
 * O cadastro semeado envelhece: o provedor aposenta modelos mais rápido que
 * qualquer release. Um modelo desligado no cadastro não falha aqui, falha lá na
 * frente, como `provider_error` numa análise que a pessoa pediu e esperou. Este
 * catálogo é o que o projeto SABE que saiu do ar, com o status que o provedor
 * devolveu e a data: a escolha de modelo o pula, `jho llm list` o sinaliza, a
 * semente não o cadastra mais e `jho llm use` recusa torná-lo padrão.
 *
 * Vale também para cadastros antigos, que já têm a linha no banco: a marca é
 * lida aqui, na hora, sem escrever em banco nenhum.
 *
 * Achou outro desligado? Entre aqui com o status e a data em que foi visto. Não
 * é lugar de escolher substituto: modelo novo é decisão de quem paga a chave.
 */

export type Retirement = {
  /** O que o provedor respondeu: 410 (fim de vida anunciado) ou 404 (sumiu). */
  httpStatus: 404 | 410;
  /** Fim de vida anunciado pelo provedor, quando ele diz; ISO `AAAA-MM-DD`. */
  endOfLife: string | null;
  /** Quando a resposta foi observada (chamada direta, uma por modelo). */
  observedOn: string;
};

export type RetiredModel = Retirement & {
  providerSlug: string;
  providerLabel: string;
  modelId: string;
  label: string;
};

export const RETIRED_MODELS: readonly RetiredModel[] = [
  // Observados no QA da #223 (docs/qa/reports/2026-10-01-qa-223-verificacoes.md).
  {
    providerSlug: "nvidia",
    providerLabel: "NVIDIA NIM",
    modelId: "moonshotai/kimi-k2-instruct",
    label: "Kimi K2",
    httpStatus: 410,
    endOfLife: "2026-05-12",
    observedOn: "2026-10-01",
  },
  {
    providerSlug: "nvidia",
    providerLabel: "NVIDIA NIM",
    modelId: "qwen/qwen3-coder-480b-a35b-instruct",
    label: "Qwen3 Coder 480B",
    httpStatus: 410,
    endOfLife: "2026-06-11",
    observedOn: "2026-10-01",
  },
  {
    providerSlug: "nvidia",
    providerLabel: "NVIDIA NIM",
    modelId: "meta/llama-3.1-405b-instruct",
    label: "Llama 3.1 405B",
    httpStatus: 404,
    endOfLife: null,
    observedOn: "2026-10-01",
  },
];

export function retirementOf(providerSlug: string, modelId: string): Retirement | null {
  const found = RETIRED_MODELS.find((m) => m.providerSlug === providerSlug && m.modelId === modelId);
  return found ? { httpStatus: found.httpStatus, endOfLife: found.endOfLife, observedOn: found.observedOn } : null;
}

/** Para a CLI: "desligado pelo provedor (HTTP 410, fim de vida em 2026-05-12)". */
export function describeRetirement(r: Retirement): string {
  const when = r.endOfLife ? `fim de vida em ${r.endOfLife}` : `visto em ${r.observedOn}`;
  return `desligado pelo provedor (HTTP ${r.httpStatus}, ${when})`;
}
