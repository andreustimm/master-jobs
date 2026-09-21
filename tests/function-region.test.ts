import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRODUCTION_POOLER_HOST } from "../scripts/migration/production-target.ts";

/**
 * Região do Supabase → região das funções da Vercel que fica ao lado dela.
 *
 * Só as regiões que já foram uma escolha real entram: uma região nova reprova
 * abaixo pedindo o par, em vez de passar por omissão.
 */
const VERCEL_REGION_BESIDE: Record<string, string> = {
  "sa-east-1": "gru1",
  "us-east-1": "iad1",
};

describe("função da Vercel ao lado do banco", () => {
  it("vercel.json fixa a região vizinha ao pooler de produção", () => {
    const supabaseRegion = /^aws-\d+-([a-z0-9-]+)\.pooler\.supabase\.com$/.exec(PRODUCTION_POOLER_HOST)?.[1];
    expect(supabaseRegion, "o host do pooler deveria trazer a região").toBeDefined();

    const beside = VERCEL_REGION_BESIDE[supabaseRegion!];
    expect(beside, `sem par de região da Vercel para ${supabaseRegion}: acrescente-o em VERCEL_REGION_BESIDE`).toBeDefined();

    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { regions?: string[] };
    // Cada consulta é um round-trip entre a função e o banco, e uma tela do
    // quadro faz mais de dez em série. Função em iad1 com banco em sa-east-1
    // pagava o continente inteiro a cada uma — sem nenhum erro para avisar.
    expect(vercel.regions).toEqual([beside]);
  });
});
