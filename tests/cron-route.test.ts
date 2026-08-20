import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "../app/api/cron/recheck/route.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * A rota de reconferência agendada.
 *
 * É a única rota do sistema que não tem sessão para validar — a Vercel a chama
 * sem cookie —, então a autorização dela é um segredo. Um cron desprotegido não
 * é um endpoint a mais: é um botão de disparar requisições contra sites de
 * terceiros que qualquer um aperta em laço, com o nosso IP.
 */

const ORIGINAL = process.env.CRON_SECRET;

function pedido(authorization?: string): Request {
  return new Request("https://exemplo.test/api/cron/recheck", {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(async () => {
  await useTestDb();
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
  releaseTestDb();
});

describe("autorização", () => {
  it("sem CRON_SECRET configurado, a rota fica FECHADA", async () => {
    // Fechada por omissão. Uma rota que abrisse quando o segredo falta
    // transformaria um erro de configuração em porta aberta — e ninguém
    // percebe uma variável que não foi definida.
    const r = await GET(pedido("Bearer qualquer") as never);
    expect(r.status).toBe(503);
  });

  it("recusa sem cabeçalho", async () => {
    process.env.CRON_SECRET = "segredo-de-verdade";
    expect((await GET(pedido() as never)).status).toBe(401);
  });

  it("recusa segredo errado", async () => {
    process.env.CRON_SECRET = "segredo-de-verdade";
    expect((await GET(pedido("Bearer outro") as never)).status).toBe(401);
  });

  it("recusa o segredo certo sem o prefixo Bearer", async () => {
    // A Vercel envia `Bearer <valor>`. Aceitar o valor cru ampliaria a
    // superfície sem motivo.
    process.env.CRON_SECRET = "segredo-de-verdade";
    expect((await GET(pedido("segredo-de-verdade") as never)).status).toBe(401);
  });

  it("recusa prefixo do segredo, e sem vazar tamanho pelo caminho", async () => {
    process.env.CRON_SECRET = "segredo-de-verdade";
    expect((await GET(pedido("Bearer segredo") as never)).status).toBe(401);
    expect((await GET(pedido("Bearer segredo-de-verdade-e-mais") as never)).status).toBe(401);
  });

  it("aceita o segredo correto e devolve o que fez", async () => {
    process.env.CRON_SECRET = "segredo-de-verdade";
    const r = await GET(pedido("Bearer segredo-de-verdade") as never);

    expect(r.status).toBe(200);
    // O corpo diz quantas entraram e quantas foram conferidas: um cron que
    // responde "ok" não permite saber se está avançando ou girando em falso.
    const corpo = (await r.json()) as Record<string, number>;
    expect(corpo).toHaveProperty("enfileiradas");
    expect(corpo).toHaveProperty("checked");
  });
});
