/**
 * Suíte: `src/core/ingest/import.ts` — o payload que o humano copiou de uma
 * plataforma autenticada.
 *
 * Este caminho existe porque a ADR 0001 recusou guardar sessão de terceiro:
 * Revelo, BairesDev e marketplaces afins só servem vaga logado, e não há adapter
 * público para escrever. A pessoa autentica, copia o JSON que a própria página
 * já buscou, e isto vira linha normal.
 *
 * O que os casos protegem: o parser é deliberadamente agnóstico de formato, e
 * agnóstico sem honestidade vira lixo silencioso. Por isso ele **relata** o que
 * não conseguiu mapear em vez de descartar sem contar.
 *
 * Fronteira DENTRO: parsing, persistência via `observeRawJob` e o banco real.
 * Fronteira FORA: como o usuário obteve o JSON.
 */
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { importJobs, parseFile, parsePayload } from "../src/core/ingest/import.ts";
import { job, source } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
let temporario: string;

beforeEach(async () => {
  db = await useTestDb();
  temporario = mkdtempSync(join(tmpdir(), "jho-import-"));
});

afterEach(() => {
  releaseTestDb();
  rmSync(temporario, { recursive: true, force: true });
});

describe("parsePayload: coerção de campos que chegam em qualquer tipo", () => {
  it("aceita id numérico, que é como metade dessas APIs identifica a vaga", () => {
    // `id: 90210` é comum. Exigir string faria a vaga cair no ramo "sem id" e
    // ganhar o próprio título como identificador — que muda quando o anúncio é
    // editado, e a deduplicação para de funcionar.
    const r = parsePayload([{ id: 90_210, title: "Engenheiro", url: "https://x.test/1" }]);

    expect(r.jobs[0]!.externalId).toBe("90210");
  });

  it("limpa símbolo e separador de moeda antes de ler o salário", () => {
    // "R$ 25.000" e "US$ 12,000" chegam como texto formatado para humano. Sem a
    // limpeza o componente de remuneração leria NaN e a vaga perderia 8 pontos
    // por um detalhe de apresentação.
    const r = parsePayload([
      {
        title: "Engenheiro",
        url: "https://x.test/1",
        salaryMin: "US$ 9000",
        salaryMax: "13.500",
      },
    ]);

    expect(r.jobs[0]!.compMin).toBe(9000);
    expect(r.jobs[0]!.compMax).toBe(13.5);
  });

  it("trata salário textual que não vira número como ausente, não como zero", () => {
    // Regra 8: dado faltante pontua neutro. Zero seria uma afirmação — "esta
    // vaga paga nada" — e puniria o anúncio pela formatação da API.
    const r = parsePayload([
      { title: "Engenheiro", url: "https://x.test/1", salaryMin: "a combinar", salaryMax: "0" },
    ]);

    expect(r.jobs[0]!.compMin).toBeNull();
    expect(r.jobs[0]!.compMax).toBeNull();
  });

  it("ignora campo presente porém vazio e segue para o próximo apelido", () => {
    // Regra 17: `??` não protege contra string vazia. `company: ""` seguido de
    // `employer: "Acme"` tem que resultar em Acme, não em vazio.
    const r = parsePayload([
      { title: "Engenheiro", url: "https://x.test/1", company: "", employer: "Acme" },
    ]);

    expect(r.jobs[0]!.companyName).toBe("Acme");
  });

  it("descarta entrada sem link e sem base para construir um", () => {
    // Vaga sem URL não é rastreável nem candidatável. Guardá-la encheria o
    // quadro de linhas em que clicar não leva a lugar nenhum.
    const r = parsePayload([
      { title: "Tem link", url: "https://x.test/1" },
      { title: "Sem link nenhum", id: "abc" },
    ]);

    expect(r.jobs).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(r.warnings.join(" ")).toContain("falta de título ou URL");
  });

  it("cai para o nome de empresa informado no comando quando o payload não traz", () => {
    // Marketplace anonimiza o cliente com frequência. O rótulo do comando é o
    // melhor dado disponível, e "Desconhecida" é o último recurso — visível de
    // propósito, para o usuário saber que aquilo não veio da fonte.
    const comOpcao = parsePayload([{ title: "Engenheiro", url: "https://x.test/1" }], {
      company: "Revelo",
    });
    const semOpcao = parsePayload([{ title: "Engenheiro", url: "https://x.test/1" }]);

    expect(comOpcao.jobs[0]!.companyName).toBe("Revelo");
    expect(semOpcao.jobs[0]!.companyName).toBe("Desconhecida");
  });
});

describe("parseFile", () => {
  it("lê o arquivo e devolve o mesmo resultado do payload em memória", async () => {
    // A CLI recebe caminho; o dashboard recebe objeto. As duas superfícies têm
    // que concordar sobre o que aquele JSON significa.
    const caminho = join(temporario, "vagas.json");
    writeFileSync(
      caminho,
      JSON.stringify({ positions: [{ id: "a1", title: "Arquiteto", url: "https://x.test/a1" }] }),
    );

    const r = await parseFile(caminho, { company: "Revelo" });

    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]!.companyName).toBe("Revelo");
  });

  it("nomeia o arquivo quando o conteúdo não é JSON válido", async () => {
    // O erro mais provável deste fluxo é colar HTML da página em vez do JSON da
    // requisição. A mensagem precisa dizer qual arquivo, senão quem importou
    // três de uma vez não sabe qual refazer.
    const caminho = join(temporario, "quebrado.json");
    writeFileSync(caminho, "<html>não é json</html>");

    await expect(parseFile(caminho)).rejects.toThrow(/quebrado\.json/);
    await expect(parseFile(caminho)).rejects.toThrow(/não é JSON válido/);
  });

  it("propaga o erro do sistema de arquivos para arquivo inexistente", async () => {
    await expect(parseFile(join(temporario, "nao-existe.json"))).rejects.toThrow();
  });
});

describe("importJobs", () => {
  const payload = (over: Record<string, unknown> = {}) =>
    parsePayload([
      {
        id: "vaga-1",
        title: "Arquiteto de IA",
        company: "Acme",
        url: "https://x.test/vaga-1",
        description: "Construir plataformas de IA em produção.",
        ...over,
      },
    ]);

  it("cria a fonte desabilitada, porque não há nada público para varrer", async () => {
    // Se a fonte entrasse habilitada, o próximo `jho jobs sync` tentaria buscar
    // um endpoint que não existe e registraria erro para sempre.
    await importJobs(payload(), { sourceKey: "revelo", label: "Revelo" });

    const [linha] = await db.select().from(source).where(eq(source.id, "manual:revelo"));
    expect(linha!.enabled).toBe(false);
    expect(linha!.kind).toBe("manual");
    expect(linha!.label).toBe("Revelo");
  });

  it("conta inserção, repetição e edição separadamente na reimportação", async () => {
    // Os três números respondem perguntas diferentes: quanto entrou, quanto era
    // ruído e quanto mudou de verdade. Um agregado só ("updated") esconde que o
    // anúncio foi editado, que é o único caso que invalida o score.
    const primeira = await importJobs(payload(), { sourceKey: "revelo", label: "Revelo" });
    expect(primeira).toMatchObject({ inserted: 1, unchanged: 0, changed: 0, reopened: 0 });
    expect(primeira.jobIds).toHaveLength(1);

    const repetida = await importJobs(payload(), { sourceKey: "revelo", label: "Revelo" });
    expect(repetida).toMatchObject({ inserted: 0, unchanged: 1, changed: 0, updated: 1 });

    const editada = await importJobs(payload({ description: "Escopo totalmente outro." }), {
      sourceKey: "revelo",
      label: "Revelo",
    });
    expect(editada).toMatchObject({ inserted: 0, unchanged: 0, changed: 1, updated: 1 });
    expect(editada.jobIds).toEqual(primeira.jobIds);
  });

  it("reabre a vaga fechada em vez de criar uma segunda linha", async () => {
    // Regra 3: vaga que some é fechada, nunca deletada — e reaparecer tem que
    // reabrir a mesma linha. Criar outra quebraria o vínculo com a candidatura
    // que aponta para a primeira.
    const primeira = await importJobs(payload(), { sourceKey: "revelo", label: "Revelo" });
    await db
      .update(job)
      .set({ closedAt: "2026-03-03T00:00:00.000Z" })
      .where(eq(job.id, primeira.jobIds[0]!));

    const revolta = await importJobs(payload(), { sourceKey: "revelo", label: "Revelo" });

    expect(revolta).toMatchObject({ inserted: 0, reopened: 1, updated: 1 });
    expect(revolta.jobIds).toEqual(primeira.jobIds);
    const linhas = await db.select().from(job);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.closedAt).toBeNull();
  });

  it("preserva os avisos do parsing no resultado da importação", async () => {
    // O aviso "nenhuma vaga trouxe descrição" é o que diz ao usuário que ele
    // copiou o endpoint de listagem em vez do de detalhe. Perdê-lo na
    // persistência deixaria um acervo inteiro com keyword zerada e sem
    // explicação.
    const semDescricao = parsePayload([
      { id: "x", title: "Arquiteto", url: "https://x.test/x", englishLevel: "advanced" },
    ]);

    const r = await importJobs(semDescricao, { sourceKey: "revelo", label: "Revelo" });

    expect(r.warnings.join(" ")).toContain("keywords");
    expect(r.unmappedFields).toContain("englishLevel");
    expect(r.inserted).toBe(1);
  });
});
