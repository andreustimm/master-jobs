import { describe, expect, it } from "vitest";
import { publicCvText, REDACTED } from "../src/core/public-cv.ts";

/**
 * A versão publicável do CV, como função pura. O teste de `publicProfile`
 * prova a composição com o banco; este prova as bordas da detecção — inclusive
 * o que ela declara NÃO pegar, para que ninguém a leia como sanitização
 * perfeita.
 */
describe("publicCvText", () => {
  it("retira o bloco de cada rótulo de pretensão salarial", () => {
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
    for (const line of lines) {
      // Cada rótulo no seu parágrafo: o que vem depois da linha em branco fica.
      expect(publicCvText(`Experiência\n\n${line}\n\nFim`), line).toBe("Experiência\n\n\nFim");
    }
  });

  it("na mesma linha, sai só a frase do piso", () => {
    expect(publicCvText("Senior AI Software Architect. Piso: 180000 USD/ano.")).toBe("Senior AI Software Architect.");
    // Do rótulo ao fim da linha: o que vem depois pode ser o próprio valor.
    expect(publicCvText("Remoto B2B · Salary floor: 150k · São Paulo")).toBe("Remoto B2B ·");
    // `30.000` não é fim de frase: o valor não sobra depois do corte.
    expect(publicCvText("Pretensão salarial: R$ 30.000 mensais")).toBe("");
  });

  it("o valor não escapa do rótulo por separador, tabela, abreviação ou quebra de linha", () => {
    for (const cv of [
      "| Pretensão salarial | R$ 30.000 |",
      "Pretensão salarial · R$ 30.000",
      "Salary expectation approx. 150k USD",
      "Pretensão salarial aprox. R$ 30.000 mensais",
      "## Pretensão salarial\n\nR$ 30.000 mensais",
      "| Pretensão salarial | Disponibilidade |\n|---|---|\n| R$ 30.000 | Imediata |",
      "Pretensão salarial (2026):\nR$ 30.000 mensais",
      "Salary expectations (12 months):\n150k USD",
    ]) {
      // O bloco do rótulo termina na linha em branco; `Fim` está depois dela.
    const out = publicCvText(`Experiência\n\n${cv}\n\n## Fim`);
      expect(out, cv).not.toMatch(/30\.000|150k/);
      expect(out, cv).toContain("Experiência");
      expect(out, cv).toContain("Fim");
    }
  });

  it("reconhece os rótulos curtos, e não confunde taxa de sucesso com pretensão", () => {
    for (const cv of ["Pretensão: 30k", "Salário: R$ 30.000", "Salary: 150k", "Rate: 90 USD/h", "- Hourly rate: 90"]) {
      expect(publicCvText(cv), cv).toBe("");
    }
    expect(publicCvText("Success rate: 99% em produção")).toBe("Success rate: 99% em produção");
    for (const cv of ["Pretensões salariais: 30k", "Pretensa\u0303o: 30k", "Faixa salarial: 25-30k", "Valor hora: R$ 200"]) {
      expect(publicCvText(cv), cv).toBe("");
    }
    // Palavras vizinhas de rótulo, sem ser rótulo, não apagam currículo.
    expect(publicCvText("Projeto sem pretensões comerciais.\n2019-2021 Staff Engineer na Acme")).toBe(
      "Projeto sem pretensões comerciais.\n2019-2021 Staff Engineer na Acme",
    );
    expect(publicCvText("Built salary range benchmarking tool for HR\n2019-2021 Staff")).toBe(
      "Built salary range benchmarking tool for HR\n2019-2021 Staff",
    );
    // `piso` que não é salário é currículo, e a linha seguinte também fica.
    expect(publicCvText("Automação do piso de fábrica\n2019-2021")).toBe("Automação do piso de fábrica\n2019-2021");
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
    // Grupos soltos, como se escreve em vários países.
    expect(publicCvText("+55 11 9 1234-5678")).toBe(REDACTED);
    expect(publicCvText("+33 1 23 45 67 89")).toBe(REDACTED);
    expect(publicCvText("(11) 9 1234-5678")).toBe(REDACTED);
    // Dígitos logo depois do telefone não o escondem da detecção.
    expect(publicCvText("+55 11 91234-5678\n2015-2020 Staff")).toBe(`${REDACTED}\n2015-2020 Staff`);
    expect(publicCvText("+55 11 91234-5678 2015")).toBe(`${REDACTED} 2015`);
    // Poucos dígitos depois do `+` não são telefone.
    expect(publicCvText("+30% de conversão, +2 anos")).toBe("+30% de conversão, +2 anos");
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
