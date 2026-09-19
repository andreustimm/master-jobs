/**
 * Quem pode gastar cota de fonte externa — e quem não pode.
 *
 * A pergunta não é "qual ambiente é este", é "esta chamada pode tocar a rede
 * de terceiro e escrever no acervo". Dev, staging e preview nunca podem: eles
 * existem para exercitar a interface sobre fixtures, e um sync acidental ali
 * queima cota de um board que o produto não controla, além de encher um banco
 * que deveria ser descartável (ADR 0021).
 *
 * A decisão é função pura de propósito. Ler `process.env` aqui tornaria o
 * comportamento impossível de testar sem mexer no ambiente do processo, e a
 * regra que protege cota é justamente a que precisa de teste exaustivo.
 */

export const INGESTION_ENVIRONMENTS = [
  "production",
  "staging",
  "dev",
  "local",
  "preview",
] as const;

export type IngestionEnvironment = (typeof INGESTION_ENVIRONMENTS)[number];

export type IngestionContext = {
  environment: IngestionEnvironment;
  /** Diagnóstico local pedido à mão. Nunca vale para ambiente remoto. */
  explicitOptIn: boolean;
  /** Normalizado na fronteira: ausente ou malformado vira `false`. */
  productionAllowlistSatisfied: boolean;
};

export type IngestionDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Falha fechado: o `default` cobre valor desconhecido que escapou do tipo —
 * e é ele que protege o dia em que alguém acrescentar um ambiente novo sem
 * passar por aqui.
 */
export function canRunIngestion(context: IngestionContext): IngestionDecision {
  switch (context.environment) {
    case "production":
      return context.productionAllowlistSatisfied
        ? { allowed: true }
        : { allowed: false, reason: "production allowlist not satisfied" };
    case "local":
      return context.explicitOptIn
        ? { allowed: true }
        : { allowed: false, reason: "local ingestion requires explicit opt-in" };
    case "dev":
    case "staging":
    case "preview":
      return { allowed: false, reason: `${context.environment} runs on fixtures only` };
    default:
      return { allowed: false, reason: "unknown environment" };
  }
}

/**
 * Normaliza a configuração crua numa decisão possível.
 *
 * Tudo que não for exatamente um dos ambientes conhecidos vira `preview`, o
 * mais restrito dos remotos: ambiente ilegível é ambiente não confiável, e
 * chutar "produção" aqui seria transformar um erro de digitação em gasto de
 * cota. A allowlist só conta como satisfeita quando chega uma lista não vazia.
 */
export function normalizeIngestionContext(raw: {
  environment?: string | null;
  explicitOptIn?: boolean | string | null;
  productionAllowlist?: readonly string[] | string | null;
}): IngestionContext {
  const declared = raw.environment?.trim().toLowerCase();
  const environment = (INGESTION_ENVIRONMENTS as readonly string[]).includes(declared ?? "")
    ? (declared as IngestionEnvironment)
    : "preview";

  const optIn = typeof raw.explicitOptIn === "string"
    ? raw.explicitOptIn.trim().toLowerCase() === "true"
    : raw.explicitOptIn === true;

  const allowlist = typeof raw.productionAllowlist === "string"
    ? raw.productionAllowlist.split(",").map((entry) => entry.trim()).filter(Boolean)
    : (raw.productionAllowlist ?? []).filter((entry) => entry.trim().length > 0);

  return {
    environment,
    explicitOptIn: optIn,
    productionAllowlistSatisfied: allowlist.length > 0,
  };
}

/**
 * Erro operacional, não exceção de programação: a chamada estava correta, o
 * ambiente é que não autoriza. Carrega ambiente e motivo e nada mais — nome de
 * fonte, handle e credencial ficam de fora porque este texto vai para log de
 * CI, que é lido por mais gente do que o banco.
 */
export class IngestionBlockedError extends Error {
  readonly code = "ingestion_blocked";
  readonly environment: IngestionEnvironment;
  readonly reason: string;

  constructor(environment: IngestionEnvironment, reason: string) {
    super(`Ingestion blocked in ${environment}: ${reason}`);
    this.name = "IngestionBlockedError";
    this.environment = environment;
    this.reason = reason;
  }
}

/**
 * A porta única. Chamar ANTES de resolver adapter, abrir fila ou subir worker
 * — depois já é tarde: o custo que se quer evitar é a conexão, não a escrita.
 */
export function assertIngestionAllowed(context: IngestionContext): void {
  const decision = canRunIngestion(context);
  if (!decision.allowed) throw new IngestionBlockedError(context.environment, decision.reason);
}
