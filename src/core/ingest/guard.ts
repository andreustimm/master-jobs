/**
 * A fronteira entre a política pura e o processo.
 *
 * Este é o único lugar do sistema que lê o ambiente para decidir sobre
 * ingestão. Manter a leitura aqui é o que permite testar a regra sem mexer em
 * `process.env` e o que garante que sync, scrape, recheck, probe e a varredura
 * automatizada respondam à MESMA decisão — um guarda por entrypoint, todos
 * chamando a mesma função.
 */
import {
  assertIngestionAllowed,
  normalizeIngestionContext,
  type IngestionContext,
} from "./environment.ts";

/**
 * Só o que esta fronteira precisa ler. `NodeJS.ProcessEnv` exigiria `NODE_ENV`
 * de quem chama — inclusive do teste, que ficaria obrigado a montar um
 * ambiente inteiro para afirmar uma regra sobre três chaves.
 */
export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

/**
 * `JHO_ENV` é a declaração explícita do deployment. Sem ela, `VERCEL_ENV`
 * responde por preview e production na Vercel; sem nenhuma das duas, a
 * normalização trata como `preview` e nega — ambiente que não se identifica
 * não recebe crédito de produção.
 *
 * `JHO_INGESTION_OPT_IN` é o diagnóstico local, e `JHO_SOURCE_ALLOWLIST` é a
 * lista que a produção precisa declarar para gastar cota.
 */
export function currentIngestionContext(env: EnvironmentSource = process.env): IngestionContext {
  return normalizeIngestionContext({
    environment: env.JHO_ENV ?? env.VERCEL_ENV ?? null,
    explicitOptIn: env.JHO_INGESTION_OPT_IN ?? null,
    productionAllowlist: env.JHO_SOURCE_ALLOWLIST ?? null,
  });
}

/**
 * Chamada de uma linha no topo de cada entrypoint de ingestão. Lança
 * `IngestionBlockedError` antes de qualquer adapter, fila ou worker existir.
 */
export function guardIngestion(env: EnvironmentSource = process.env): void {
  assertIngestionAllowed(currentIngestionContext(env));
}
