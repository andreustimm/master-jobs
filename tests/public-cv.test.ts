import { describe, expect, it } from "vitest";
import { publicCvText, REDACTED } from "../src/core/public-cv.ts";

/**
 * A versão publicável do CV, como função pura. O teste de `publicProfile`
 * prova a composição com o banco; este prova as bordas da detecção — inclusive
 * o que ela declara NÃO pegar, para que ninguém a leia como sanitização
 * perfeita.
 */
describe("publicCvText", () => {
  it("retira a linha inteira de cada rótulo de pretensão salarial", () => {
    const lines = [
      "Piso: 180000 USD/ano",
      "Pretensão salarial: R$ 30.000",
      "Expectativa salarial — a combinar acima de 25k",
      "Remuneração pretendida: 20k",
      "Salário mínimo aceitável: 22k",
      "Salary floor: $150k",
      "Salary expectations: 12k/month",
      "Minimum rate: 90 USD/h",
      "Desired compensation: 200k",
      "Compensation requirements: 180k",
    ];
    const out = publicCvText(["Experiência", ...lines, "Fim"].join("\n"));
    expect(out).toBe("Experiência\nFim");
  });

  it("na mesma linha, sai só a frase do piso", () => {
    expect(publicCvText("Senior AI Software Architect. Piso: 180000 USD/ano.")).toBe("Senior AI Software Architect.");
    expect(publicCvText("Remoto B2B · Salary floor: 150k · São Paulo")).toBe("Remoto B2B · São Paulo");
    // `30.000` não é fim de frase: o valor não sobra depois do corte.
    expect(publicCvText("Pretensão salarial: R$ 30.000 mensais")).toBe("");
  });

  it("troca todo endereço de e-mail e o cadastrado, mesmo fora do padrão geral", () => {
    expect(publicCvText("fale com a.b+c@exemplo.com.br hoje")).toBe(`fale com ${REDACTED} hoje`);
    expect(publicCvText("contato: dono@intranet", { email: "dono@intranet" })).toBe(`contato: ${REDACTED}`);
    expect(publicCvText("DONO@INTRANET", { email: "dono@intranet" })).toBe(REDACTED);
  });

  it("troca telefone com código de país ou DDD entre parênteses", () => {
    expect(publicCvText("+55 11 91234-5678")).toBe(REDACTED);
    expect(publicCvText("+1 (415) 555-0100")).toBe(REDACTED);
    expect(publicCvText("(11) 91234-5678")).toBe(REDACTED);
  });

  it("preserva o que é currículo: anos, intervalos e números sem marca de telefone", () => {
    const cv = "2015-2020 · 2020–2026 · 20+ anos · 99,9% uptime · 12345678 requisições/dia";
    expect(publicCvText(cv)).toBe(cv);
  });

  it("limite declarado: valor sem rótulo e telefone sem marca passam", () => {
    // Documentado em `src/core/public-cv.ts`. Se um dia a detecção crescer,
    // este teste muda junto — e a documentação também.
    expect(publicCvText("Aceito a partir de 180000 USD")).toContain("180000");
    expect(publicCvText("ligue 91234-5678")).toContain("91234-5678");
  });

  it("texto sem nada protegido sai idêntico", () => {
    const cv = "# Nome\n\nSenior AI Software Architect.\n\n- LangGraph\n- TypeScript";
    expect(publicCvText(cv)).toBe(cv);
  });
});
