import { describe, expect, it } from "vitest";
import { publicCvMarkdown, publicCvText, REDACTED } from "../src/core/public-cv.ts";

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

  it("a linha do rótulo sai inteira, porque o valor pode vir antes dele", () => {
    for (const cv of [
      "Senior AI Software Architect. Piso: 180000 USD/ano.",
      "Remoto B2B · Salary floor: 150k · São Paulo",
      "| R$ 30.000 | Pretensão salarial |",
      "180k USD · Salary expectation",
      "Aceito R$ 30.000; é minha pretensão salarial",
    ]) {
      expect(publicCvText(`# Nome\n\n${cv}\n\nFim`), cv).toBe("# Nome\n\n\nFim");
    }
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
    for (const cv of ["Pretensão: 30k", "Salário: R$ 30.000", "Salary: 150k", "Rate: 90 USD/h", "- Hourly rate: 90", "Daily rate: 600 EUR", "Day rate: 600 EUR", "  Rate: 90 USD/h", "1. Rate: 90 USD/h"]) {
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
    // Rótulos que a revisão achou escapando: qualificador, estado atual,
    // quebra de linha no meio do rótulo.
    for (const cv of ["Pretensão PJ: R$ 30.000", "Salário atual: R$ 25.000", "Expectativa\nsalarial: 30k", "Salary\nexpectation: 150k"]) {
      expect(publicCvText(`Topo\n\n${cv}\n\nFim`), cv).toBe("Topo\n\n\nFim");
    }
    // Ênfase Markdown, título de remuneração e valor com cara de ano.
    for (const cv of ["**Piso**: 180000 USD/ano", "**Rate**: 90 USD/h", "Salary: 2000 EUR/month"]) {
      expect(publicCvText(`Topo\n\n${cv}\n\nFim`), cv).toBe("Topo\n\n\nFim");
    }
    expect(publicCvText("# Nome\n\n## Salário\nR$ 30.000 mensais\n\n## Fim")).toBe("# Nome\n\n## Fim");
    expect(publicCvText("# Nome\n\n## Remuneração\n\nR$ 30.000\n\n## Fim")).toBe("# Nome\n\n## Fim");
    // Rótulo sozinho no parágrafo leva junto o parágrafo do valor.
    expect(publicCvText("Topo\n\nPretensão salarial:\n\nR$ 30.000 mensais\n\nFim")).toBe("Topo\n\n\n\nFim");
    // Ano DENTRO do rótulo não é o valor: o parágrafo seguinte também sai.
    expect(publicCvText("Topo\n\nPretensão salarial (2026):\n\nR$ 30.000 mensais\n\nFim")).toBe("Topo\n\n\n\nFim");
    for (const cv of ["Valor/hora: R$ 200", "Valor-hora: R$ 200"]) {
      expect(publicCvText(`Topo\n\n${cv}\n\nFim`), cv).toBe("Topo\n\n\nFim");
    }
    // Título em texto puro, com ou sublinhado, promete o valor no bloco seguinte.
    for (const title of ["Salário", "Salary", "Salário\n-------", "Remuneração:"]) {
      expect(publicCvText(`Topo\n\n${title}\n\nR$ 30.000 mensais\n\nFim`), title).toBe("Topo\n\n\n\nFim");
    }
    // Moeda colada ao número é valor.
    expect(publicCvText("Topo\n\nSalário em torno de EUR150k anuais\n\nFim")).toBe("Topo\n\n\nFim");
    // O título seguinte ao rótulo isolado abre outra seção e fica.
    expect(publicCvText("Topo\n\nPretensão salarial:\n\n## Projetos 2024\n\nFim")).toBe("Topo\n\n\n## Projetos 2024\n\nFim");
    // Ano com moeda é valor.
    expect(publicCvText("Topo\n\nRemuneração mínima de 2000 EUR\n\nFim")).toBe("Topo\n\n\nFim");
    // Hífen no meio da frase não é marcador de item.
    expect(publicCvText("Reduced error-rate: 0.1% across services")).toBe("Reduced error-rate: 0.1% across services");
    // O bloco inteiro sai, inclusive as linhas ACIMA do rótulo.
    expect(publicCvText("Topo\n\nR$ 30.000 mensais\nPretensão salarial\n\nFim")).toBe("Topo\n\n\nFim");
  });

  it("troca todo endereço de e-mail e o cadastrado, mesmo fora do padrão geral", () => {
    expect(publicCvText("fale com a.b+c@exemplo.com.br hoje")).toBe(`fale com ${REDACTED} hoje`);
    expect(publicCvText("contato: dono@intranet", { email: "dono@intranet" })).toBe(`contato: ${REDACTED}`);
    expect(publicCvText("DONO@INTRANET", { email: "dono@intranet" })).toBe(REDACTED);
    // Endereço colado ao fim do anterior também sai.
    for (const sep of ["-", "_", "+", "1", "."]) {
      expect(publicCvText(`ana@empresa.com${sep}bia@empresa.org`), sep).not.toContain("bia@");
    }
    expect(publicCvText("ana@empresa.com-bia@empresa.org")).toBe(`${REDACTED}${REDACTED}`);
    expect(publicCvText("a@x.co-b@c.de@f.gh@i.jk")).toBe(`${REDACTED}${REDACTED}@${REDACTED}`);
  });

  it("troca telefone com código de país ou DDD entre parênteses", () => {
    expect(publicCvText("+55 11 91234-5678")).toBe(REDACTED);
    expect(publicCvText("+1 (415) 555-0100")).toBe(REDACTED);
    expect(publicCvText("(11) 91234-5678")).toBe(REDACTED);
    // Grupos soltos, como se escreve em vários países.
    expect(publicCvText("+55 11 9 1234-5678")).toBe(REDACTED);
    expect(publicCvText("+33 1 23 45 67 89")).toBe(REDACTED);
    expect(publicCvText("(11) 9 1234-5678")).toBe(REDACTED);
    expect(publicCvText("+55 11 91234–5678")).toBe(REDACTED);
    expect(publicCvText("(11) 91234/5678")).toBe(REDACTED);
    expect(publicCvText("+55 11 91234 - 5678")).toBe(REDACTED);
    expect(publicCvText("(415) 555-0100")).toBe(REDACTED);
    // Espaço inseparável entre os grupos.
    expect(publicCvText("+55\u00A011\u00A091234-5678")).toBe(REDACTED);
    expect(publicCvText("(11)\u202F91234\u202F5678")).toBe(REDACTED);
    expect(publicCvText("+1 415 555 0100 2015")).toBe(`${REDACTED} 2015`);
    expect(publicCvText("(11) 91234 - 5678")).toBe(REDACTED);
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

  it("CV sem linha em branco perde só as linhas do piso, não o documento", () => {
    // Texto extraído de PDF costuma vir sem parágrafos: o bloco é o CV inteiro.
    const cv = [
      "ANDREUS TIMM",
      "Senior AI Software Architect",
      "EXPERIÊNCIA",
      "2019-2021 Staff Engineer na Acme",
      "PRETENSÃO SALARIAL",
      "R$ 30.000 mensais",
      "FORMAÇÃO",
      "Ciência da Computação",
    ].join("\n");
    const out = publicCvText(cv);
    expect(out).not.toMatch(/30\.000|PRETENSÃO/);
    expect(out).toContain("Senior AI Software Architect");
    expect(out).toContain("2019-2021 Staff Engineer na Acme");
    expect(out).toContain("Ciência da Computação");
  });

  it("no bloco longo, sai a seção do piso até o próximo nome de seção conhecido", () => {
    // Cada trecho entre EXPERIÊNCIA e FORMAÇÃO; nenhum valor pode sobrar, e as
    // outras seções ficam.
    for (const piso of [
      "Pretensão salarial: R$ 30.000",
      "Expectativa\nsalarial: 30k",
      "Salary\nexpectation: 150k",
      "Pretensão salarial:\nCLT: R$ 30.000\nPJ: R$ 40.000",
      "PRETENSÃO SALARIAL\nCLT\nR$ 30.000\nPJ\nR$ 40.000",
      "PRETENSÃO SALARIAL\nCLT: R$ 30.000\nPJ MENSAL\nR$ 40.000",
      "| Pretensão salarial | Disponibilidade |\n|---|---|\n| R$ 30.000 | Imediata |",
      "| Cargo | Pretensão salarial |\n|---|---|\n| Staff | R$ 30.000 |\n| Senior | R$ 40.000 |",
      "Salário\n-------\nCLT R$ 30.000\nPJ R$ 40.000",
      "Salary expectations (12 months):\n150k USD",
      "Pretensão salarial (2026):\nR$ 30.000 mensais",
      "Pretensão salarial (CLT, 40h/semana):\nA combinar\nR$ 30.000",
    ]) {
      const cv = `Nome\nEXPERIÊNCIA\n2019-2021 Staff na Acme\n${piso}\nFORMAÇÃO\nCiência da Computação`;
      for (const out of [publicCvText(cv), publicCvMarkdown(cv)]) {
        expect(out, piso).not.toMatch(/30\.000|40\.000|30k|150k/);
        expect(out, piso).toContain("Nome");
        expect(out, piso).toContain("Ciência da Computação");
      }
    }
  });

  it("valor com moeda nas bordas da seção derruba o bloco inteiro", () => {
    for (const piso of [
      // Nome de seção conhecido dentro da pretensão.
      "Salary expectations\nContractor: 90 USD/hour\nEmployment:\n150k USD",
      "PRETENSÃO SALARIAL\nCLT: R$ 30.000\nObjetivo\nPJ: R$ 40.000",
      // Título falso acima de rótulo que não é título.
      "PJ R$ 40.000\nCLT MENSAL\nPretensão salarial\nR$ 30.000",
      // Valor uma ou duas linhas acima do rótulo.
      "R$ 30.000 mensais\nPretensão salarial",
      "R$ 30.000\nmensais\nPretensão salarial",
      "R$ 30.000 (CLT)\nou\nPRETENSÃO SALARIAL\nPJ R$ 40.000",
      // Valor sem moeda: milhar, `mil`, número solto.
      "30.000\nPRETENSÃO SALARIAL\nPJ R$ 40.000",
      "30.000 mensais\nPRETENSÃO SALARIAL\nPJ: 40.000",
      "CLT 30 mil\nPRETENSÃO SALARIAL\nPJ 40 mil",
      "PRETENSÃO SALARIAL\nCLT: 30.000\nObjetivo\nPJ: 40.000",
      "Salary expectations\nContract: 90/hour\nEmployment:\n150,000 per year",
      "PJ 40.000\nCLT MENSAL\nPretensão salarial\nR$ 30.000",
      "PRETENSÃO SALARIAL\nCLT 30 mil\nResumo\nPJ 40 mil",
      "Contract: 90/hour\nPRETENSÃO SALARIAL\nCLT R$ 30.000",
      // Nomes de seção seguidos não encerram a borda.
      "PRETENSÃO SALARIAL\nCLT: R$ 30.000\nSkills\nIdiomas\nPJ: R$ 40.000",
      "PJ 40000\nObjetivo\nPRETENSÃO SALARIAL\nCLT R$ 30.000",
      // Taxa sem moeda e valor por extenso.
      "PRETENSÃO SALARIAL\nCLT: R$ 30.000\nProjetos\nPJ: 150/hora",
      "PJ 150/h\nCLT MENSAL\nPretensão salarial\nR$ 30.000",
      "150/hora\nou\nPRETENSÃO SALARIAL\nCLT R$ 30.000",
      "Salary expectations\nContract: 90/hour\nEmployment:\n150 thousand per year",
    ]) {
      const cv = `EXPERIÊNCIA\n2019-2021 Staff na Acme\n${piso}\nFORMAÇÃO\nCiência da Computação`;
      for (const out of [publicCvText(cv), publicCvMarkdown(cv)]) {
        expect(out, piso).not.toMatch(/30\.000|40\.000|40000|30 mil|40 mil|150k|150,000|90 USD|90\/hour|150\/h|150 thousand/);
      }
    }
  });

  it("número que não é dinheiro na seção vizinha não derruba o currículo", () => {
    const cv = [
      "EXPERIÊNCIA",
      "Equipe de 12 pessoas, 20+ anos, 99,9% uptime, 2019-2021",
      // A linha colada acima de um rótulo-título sai se tiver número.
      "Staff Engineer na Acme",
      "PRETENSÃO SALARIAL",
      "R$ 30.000",
      "FORMAÇÃO",
      "Ciência da Computação",
    ].join("\n");
    const out = publicCvMarkdown(cv);
    expect(out).not.toContain("30.000");
    expect(out).toContain("99,9% uptime");
    expect(out).toContain("Ciência da Computação");
  });

  it("métrica de CV sênior perto da pretensão não derruba o perfil", () => {
    for (const [line, education] of [
      ["Liderei equipe de 12 engenheiros", "Ciência da Computação"],
      ["Plataforma com 1.200 clientes", "Ciência da Computação"],
      ["Reduzi custos em US$ 2M", "Ciência da Computação"],
      ["API com 10000 req/s", "Ciência da Computação"],
      ["Receita de R$ 5 milhões", "Ciência da Computação"],
      ["Liderei equipe de 12 engenheiros", "MBA, 1.200 horas"],
    ]) {
      const cv = [
        "ANDREUS TIMM",
        "Senior AI Software Architect",
        "EXPERIÊNCIA",
        line,
        "2019-2021 Staff na Acme",
        "Arquitetura de agentes em produção",
        "PRETENSÃO SALARIAL",
        "R$ 30.000 mensais",
        "FORMAÇÃO",
        "Bacharelado",
        "Universidade de São Paulo",
        education,
      ].join("\n");
      const out = publicCvMarkdown(cv);
      expect(out, `${line} / ${education}`).not.toContain("30.000");
      expect(out, `${line} / ${education}`).toContain("Senior AI Software Architect");
      expect(out, `${line} / ${education}`).toContain(line);
      expect(out, `${line} / ${education}`).toContain(education);
    }
  });

  it("pretensão em Title Case ou como item não leva a experiência junto", () => {
    const experience = ["Staff Engineer na Acme (2019-2021)", "Liderei a migração para LangGraph", "Arquitetei a plataforma de agentes"];
    for (const [heading, piso, education] of [
      ["Experiência", "Pretensão Salarial\nR$ 30.000 mensais", "Formação"],
      ["Experiência", "Pretensão salarial: R$ 30.000", "Formação"],
      ["EXPERIÊNCIA", "ACME CORP\nPretensão Salarial\nR$ 30.000 mensais", "FORMAÇÃO"],
    ]) {
      const cv = ["Andreus Timm", heading, ...experience, piso, education, "Ciência da Computação"].join("\n");
      const out = publicCvMarkdown(cv);
      expect(out, piso).not.toContain("30.000");
      for (const line of experience) expect(out, piso).toContain(line);
      expect(out, piso).toContain("Ciência da Computação");
    }
  });

  it("limite declarado: valor a três linhas ou mais da seção do piso passa", () => {
    // Escrito em G23 e no topo de `src/core/public-cv.ts`. A borda é curta para
    // que a métrica da experiência não derrube o perfil; o preço é este.
    const cv = "EXPERIÊNCIA\nR$ 30.000 (CLT)\nou, se PJ,\nconforme escopo\nPRETENSÃO SALARIAL\nPJ R$ 40.000\nFORMAÇÃO\nCiência";
    const out = publicCvMarkdown(cv);
    expect(out).toContain("R$ 30.000 (CLT)");
    expect(out).not.toContain("40.000");
  });

  it("bloco com muitas linhas não estoura a pilha", () => {
    expect(() => publicCvMarkdown("x\n".repeat(200_000))).not.toThrow();
    expect(() => publicCvMarkdown(`${"x\n".repeat(200_000)}PRETENSÃO SALARIAL\nR$ 1`)).not.toThrow();
  });

  it("no bloco longo sem nome de seção depois do piso, sai tudo até o fim do bloco", () => {
    const out = publicCvText("Topo\nPretensão salarial:\nCLT: R$ 30.000\nPJ: R$ 40.000\nDepois\n\nFim");
    expect(out).toBe("\nFim");
  });

  it("rótulo sem valor no bloco longo leva o bloco e o parágrafo seguinte, como no bloco curto", () => {
    expect(publicCvText("Topo\nPretensão salarial:\n\nR$ 30.000 mensais\n\nFim")).toBe("\n\nFim");
  });

  it("o que sobra do bloco longo ainda com cara de piso sai inteiro", () => {
    // Palavra de remuneração e valor em linhas não vizinhas: nenhuma linha nem
    // par é piso, mas o bloco lido como texto corrido é.
    expect(publicCvText("Topo\n\nContratado com salário\nx\nde R$ 30.000\n\nFim")).toBe("Topo\n\n\nFim");
  });

  it("custo linear na entrada que a pessoa controla", () => {
    // `/p/[slug]` responde sem sessão e filtra o CV duas vezes por visita. Com
    // uma expressão quadrática, cada entrada destas leva dezenas de segundos.
    const started = performance.now();
    publicCvMarkdown("a".repeat(200_000));
    publicCvMarkdown(`a@${"b".repeat(200_000)}`);
    publicCvMarkdown("a.".repeat(100_000));
    publicCvMarkdown("a@x.co-".repeat(50_000));
    publicCvMarkdown("+1 ".repeat(100_000));
    publicCvMarkdown(`+1${" ".repeat(200_000)}`);
    publicCvMarkdown(`valor${" ".repeat(200_000)}`);
    publicCvMarkdown(`(11)${" ".repeat(200_000)}`);
    publicCvMarkdown(`salário ${"1 ".repeat(100_000)}`);
    publicCvMarkdown("Pretensão salarial:\nlinha\n".repeat(20_000));
    publicCvMarkdown("EXPERIÊNCIA\nPRETENSÃO SALARIAL\nR$ 1\n".repeat(20_000));
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("texto sem nada protegido sai idêntico", () => {
    const cv = "# Nome\n\nSenior AI Software Architect.\n\n- LangGraph\n- TypeScript";
    expect(publicCvText(cv)).toBe(cv);
  });
});
