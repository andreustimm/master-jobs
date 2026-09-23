/**
 * Publica no Sentry os mapas de origem do SERVIDOR, logo depois da compilação.
 *
 * Existe porque a pilha que chegava no Sentry era minificada
 * (`chunks/5303.js:1:1963`) — foi assim que o erro da 1.13.1 apareceu. Com o
 * mapa publicado, a mesma pilha aponta arquivo e linha do código-fonte.
 *
 * Roda no gancho `compiler.runAfterProductionCompile` do `next.config.ts`, e
 * não por `withSentryConfig`, por três motivos concretos:
 *
 * - `withSentryConfig` injeta `instrumentation-client.ts` na entrada do cliente
 *   pelo webpack — arquivo que o Next já carrega sozinho — e embrulha cada
 *   página e rota do servidor. É mudança de runtime para ganhar um upload.
 * - Não há SDK de browser (a CSP declara `connect-src 'self'`), então mapa de
 *   cliente não resolveria pilha nenhuma; só publicaria o código do cliente.
 * - O gancho roda antes do rastreamento de arquivos do build, então o que
 *   recebe o identificador de depuração é o que vai para a função.
 *
 * Só `.next/server`. Os `.map` ficam no pacote da função, que não é servido ao
 * browser: apagá-los quebra o build, porque a saída `standalone` copia
 * `proxy.js.map` pelo manifesto de rastreamento — foi o que um build de teste
 * com token mostrou.
 *
 * **Sem `SENTRY_AUTH_TOKEN`, não faz nada** e diz isso no log — o build de CI,
 * o local e o da Vercel antes do cadastro do token seguem iguais a hoje. Com o
 * token, uma falha de envio também não derruba o build: relato de erro nunca
 * derruba o que ele observa, e um deploy barrado por indisponibilidade do
 * Sentry seria trocar pilha legível por produto fora do ar.
 */

import path from "node:path";
import { redactSecrets, sourceMapPlan } from "../src/core/observability.ts";

export type SourceMapDeps = {
  env?: Readonly<{ [key: string]: string | undefined }>;
  log?: (message: string) => void;
  /** Roda o `sentry-cli` com estes argumentos; rejeita se ele falhar. */
  run?: (args: string[]) => Promise<void>;
};

async function runSentryCli(args: string[]): Promise<void> {
  const { default: SentryCli } = await import("@sentry/cli");
  await new SentryCli().execute(args, "rejectOnError");
}

/** Uma variável de ambiente pode estar no texto do erro; o log de build é lido por outras pessoas. */
function describeError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}

export async function publishServerSourceMaps(
  { distDir }: { distDir: string },
  deps: SourceMapDeps = {},
): Promise<void> {
  const log = deps.log ?? ((message: string) => console.info(message));
  const plan = sourceMapPlan(deps.env ?? process.env);
  if (!plan.upload) {
    log(`[sentry] ${plan.reason}`);
    return;
  }

  const serverDir = path.join(distDir, "server");
  const run = deps.run ?? runSentryCli;
  try {
    // O identificador de depuração no .js e no .map é o que casa a pilha com
    // o mapa, sem depender de caminho de arquivo nem de release.
    await run(["sourcemaps", "inject", serverDir]);
    await run([
      "sourcemaps",
      "upload",
      "--org",
      plan.org,
      "--project",
      plan.project,
      ...(plan.release ? ["--release", plan.release] : []),
      serverDir,
    ]);
    log(`[sentry] mapas de origem do servidor publicados em ${plan.org}/${plan.project}`);
  } catch (error) {
    log(`[sentry] falha ao publicar mapas de origem; o build segue sem eles: ${describeError(error)}`);
  }
}
