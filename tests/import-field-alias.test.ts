import { describe, expect, it } from "vitest";
import { parsePayload } from "../src/core/ingest/import.ts";

/**
 * Escolha de apelido de campo, pelo CONTEÚDO e não pela presença.
 *
 * O defeito que estes casos travam não era cosmético.
 * `referralOpportunities()` casa vaga com contato por `job.companyName`: uma
 * vaga em empresa onde a pessoa já trabalhou, importada como "Desconhecida",
 * nunca aparece em `jho referrals`. E o caminho afetado é o das plataformas
 * logadas, que são a fonte com empregador nomeado — a que o invariante de
 * qualidade diz valer mais que volume anônimo.
 */

/** Sem banco: o defeito era do mapeamento, e é onde ele se prova. */
function importar(entry: Record<string, unknown>) {
  const result = parsePayload([{ title: "Staff AI Engineer", url: "https://x.test/1", ...entry }]);
  return result.jobs[0];
}

describe("apelido só vale se o valor sobreviver à normalização", () => {
  it("objeto com nome em branco NÃO consome a vez do apelido seguinte", async () => {
    // O caso exato do defeito. `company` existe e não é "" — um objeto sempre
    // passa nesse teste —, então `employer` nunca era lido.
    const row = importar({ company: { name: "  " }, employer: "Acme" });
    expect(row?.companyName).toBe("Acme");
  });

  it("string em branco também não consome", () => {
    const row = importar({ company: "   ", employer: "Acme" });
    expect(row?.companyName).toBe("Acme");
  });

  it("objeto sem nenhuma chave de nome não consome", () => {
    const row = importar({ company: { id: 42 }, employer: "Acme" });
    expect(row?.companyName).toBe("Acme");
  });

  it("o primeiro apelido com conteúdo continua vencendo", async () => {
    // A correção não pode inverter a precedência: a ordem dos apelidos é
    // deliberada, e `company` vale mais que `employer`.
    const row = importar({ company: "Autodesk", employer: "Outra" });
    expect(row?.companyName).toBe("Autodesk");
  });

  it("objeto com nome de verdade continua sendo lido", () => {
    const row = importar({ company: { name: "Autodesk" } });
    expect(row?.companyName).toBe("Autodesk");
  });

  it("sem nenhum apelido com conteúdo, cai em Desconhecida", async () => {
    // Continua sendo o último recurso legítimo. O defeito era CHEGAR aqui com
    // `employer: "Acme"` no payload.
    const row = importar({ company: { name: "" }, employer: "  " });
    expect(row?.companyName).toBe("Desconhecida");
  });
});

describe("a mesma regra vale para os outros campos", () => {
  it("local: objeto em branco cede a vez", () => {
    const row = importar({ location: { name: " " }, city: "São Paulo" });
    expect(row?.locationRaw).toBe("São Paulo");
  });

  it("número: valor não numérico cede a vez", async () => {
    // `asNumber` devolve null para string sem dígito; o apelido seguinte
    // precisa ser tentado.
    const row = importar({ salaryMin: "a combinar", minSalary: 120000 });
    expect(row?.compMin).toBe(120000);
  });

  it("descrição: objeto vazio cede a vez ao texto real", () => {
    const row = importar({
      description: {},
      jobDescription: "Buscamos alguém com LangGraph e Python.",
    });
    expect(row?.descriptionText).toContain("LangGraph");
  });
});
