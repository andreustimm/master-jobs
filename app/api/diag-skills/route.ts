import { sql } from "drizzle-orm";
import { getDb } from "../../../src/core/db/client.ts";
import { candidateSkills, listCatalog, skillDemand } from "../../../src/contexts/skills/index.ts";
import { loadSkillsScreen } from "../../candidate/skills/data";
import { requirePage } from "../../auth";

export const dynamic = "force-dynamic";

/**
 * TEMPORÁRIO — onde vão os 30 segundos de `/candidate/skills` em produção.
 *
 * A tela é a última que ainda devolve 504. Tudo o que se mede de fora já foi
 * medido: 4 a 5 consultas, cada uma abaixo de 700ms contra o mesmo banco; nenhum
 * bloqueio; 600ms num build de produção nesta máquina; e acontece com candidato
 * sem skill nenhuma. Reduzir consultas simultâneas consertou a tela de nova
 * trilha e NÃO consertou esta — então a conta está em outro lugar, e só medindo
 * de dentro do runtime da Vercel se descobre qual.
 *
 * Sai junto com a correção. Só leitura, e só para quem administra.
 */
export async function GET() {
  const session = await requirePage("admin:access");
  const candidateId = session.candidateId ?? 1;
  const db = getDb();
  const passos: { passo: string; ms: number; tamanho?: number; erro?: string; estourou?: boolean }[] = [];

  /**
   * Cada passo tem prazo próprio, menor que o da função.
   *
   * Sem isso a rota morre junto com a tela: a Vercel mata o processo aos 30s e
   * nada é devolvido, que é exatamente a cegueira que ela existe para remover.
   * Com prazo por passo, o que já mediu volta, e o passo que estourou é
   * nomeado — que é a única informação que falta.
   */
  const LIMITE_MS = 7_000;
  const medir = async (passo: string, executar: () => Promise<unknown>) => {
    const inicio = Date.now();
    const estouro = Symbol("estouro");
    try {
      const valor = await Promise.race([
        executar(),
        new Promise((resolve) => setTimeout(() => resolve(estouro), LIMITE_MS)),
      ]);
      if (valor === estouro) {
        passos.push({ passo, ms: Date.now() - inicio, estourou: true });
        return;
      }
      const tamanho = Array.isArray(valor) ? valor.length : JSON.stringify(valor ?? null).length;
      passos.push({ passo, ms: Date.now() - inicio, tamanho });
    } catch (erro) {
      passos.push({ passo, ms: Date.now() - inicio, erro: String(erro).slice(0, 180) });
    }
  };

  await medir("select 1 — conexão e ida e volta", () => db.execute(sql`select 1`));
  await medir("select 1 de novo — só ida e volta", () => db.execute(sql`select 1`));
  await medir("candidateSkills", () => candidateSkills(candidateId));
  await medir("listCatalog", () => listCatalog());
  await medir("corpus: bytes das 400 descrições", () =>
    db.execute(
      sql`select coalesce(sum(length(description_text)), 0)::int as bytes from (select description_text from job where description_text is not null and length(description_text) >= 400 limit 400) amostra`,
    ));
  await medir("skillDemand — corpus, catálogo e a medição pura", () =>
    skillDemand({ minFit: 60, candidateId }));
  await medir("loadSkillsScreen — o que a tela faz", () => loadSkillsScreen(candidateId));

  return Response.json({
    regiao: process.env.VERCEL_REGION ?? null,
    ambiente: process.env.VERCEL_ENV ?? null,
    candidato: candidateId,
    passos,
  });
}
