/**
 * O que um cliente REAL do Sentry decide coletar com as opções que passamos.
 *
 * No SDK 11 a coleta automática saiu de `sendDefaultPii` (removida) para
 * `dataCollection`, resolvida pelo cliente com padrões permissivos. Afirmar a
 * chave no objeto de opções não prova nada: uma chave que o SDK não lê passa
 * no teste e não desliga coisa alguma — foi assim que `sendDefaultPii: false`
 * ficou morto na subida para o 11. Aqui o cliente resolve, e o teste lê a
 * resolução.
 */

import { expect } from "vitest";

type SentrySdk = typeof import("@sentry/nextjs");
type Resolvido = ReturnType<InstanceType<SentrySdk["NodeClient"]>["getDataCollectionOptions"]>;

/** Linhas de código-fonte ao redor do quadro: é o nosso código, não dado de quem usa. */
const FORA_DA_PROMESSA = new Set(["frameContextLines"]);

export async function dataCollectionDoCliente(opcoes: object, sdk?: SentrySdk): Promise<Resolvido> {
  const Sentry = sdk ?? (await import("@sentry/nextjs"));
  // A peneira de span não decide coleta; sem a marca de `withStaticSpan` o
  // cliente só avisaria que vai ignorá-la.
  const { beforeSendSpan: _span, ...resto } = opcoes as Record<string, unknown>;
  const cliente = new Sentry.NodeClient({
    ...resto,
    integrations: [],
    stackParser: Sentry.defaultStackParser,
    transport: () => ({ send: async () => ({}), flush: async () => true }),
  });
  try {
    return cliente.getDataCollectionOptions();
  } finally {
    await cliente.close(0);
  }
}

/**
 * Toda chave que o SDK resolve está desligada. Percorre o objeto resolvido, e
 * não uma lista nossa: chave nova que uma versão futura acrescentar com padrão
 * ligado reprova aqui até alguém decidir sobre ela.
 */
export function naoColetaNada(resolvido: Resolvido): void {
  for (const [chave, valor] of Object.entries(resolvido)) {
    if (FORA_DA_PROMESSA.has(chave)) continue;
    if (Array.isArray(valor)) expect(valor, chave).toEqual([]);
    else if (valor && typeof valor === "object") {
      for (const [sub, v] of Object.entries(valor)) expect(v, `${chave}.${sub}`).toBe(false);
    } else expect(valor, chave).toBe(false);
  }
}
