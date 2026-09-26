import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "../app/candidate/markdown-preview.tsx";
import { cvSections, cvTextToMarkdown } from "../src/core/cv-markdown.ts";
import { cleanPdfText } from "../src/core/pdf.ts";
import { publicCvText } from "../src/core/public-cv.ts";

/**
 * Forma do texto que o PDF do dono produz depois de `cleanPdfText` na versão
 * anterior a #325: títulos em caixa alta sem `#`, itens com `●` (que a
 * limpeza não conhecia) e com `•` (que ela já convertia). Sintética nos
 * dados, fiel na estrutura.
 */
const PDF_CV_TEXT = [
  "ANDREUS EXEMPLO",
  "Senior AI Software Architect",
  "São Paulo, Brazil",
  "SUMMARY",
  "Senior architect with 20+ years designing distributed platforms and AI products for regulated industries.",
  "Led teams of 12 engineers across three countries.",
  "CORE EXPERTISE",
  "● Software architecture ● Event-driven systems",
  "● LLM applications and evaluation",
  "- Cloud platforms (AWS, GCP)",
  "PROFESSIONAL EXPERIENCE",
  "Principal Architect | Example Corp | 2020–2026",
  "● Designed the ingestion platform processing 4M events per day.",
  "● Cut infrastructure cost by 30% through workload consolidation.",
  "Tech Lead | Other Corp | 2015–2020",
  "■ Built the first recommendation service.",
  "EDUCATION",
  "B.Sc. Computer Science — Example University",
].join("\n");

function render(source: string): string {
  return renderToStaticMarkup(createElement(MarkdownPreview, { source, emptyLabel: "" }));
}

describe("cvTextToMarkdown", () => {
  it("título em caixa alta vira `##` e glifo de item vira `- `", () => {
    const md = cvTextToMarkdown(PDF_CV_TEXT);
    expect(md).toContain("## SUMMARY");
    expect(md).toContain("## CORE EXPERTISE");
    expect(md).toContain("## PROFESSIONAL EXPERIENCE");
    expect(md).toContain("## EDUCATION");
    expect(md).toContain("- Designed the ingestion platform processing 4M events per day.");
    expect(md).toContain("- Built the first recommendation service.");
    expect(md).not.toMatch(/[●■]/);
  });

  it("dois itens colados na mesma linha viram dois itens", () => {
    expect(cvTextToMarkdown("● Software architecture ● Event-driven systems")).toBe(
      "- Software architecture\n- Event-driven systems",
    );
  });

  it("não inventa título: sigla, cargo com ano, endereço e frase ficam como estão", () => {
    for (const line of ["AWS", "CTO 2020", "SÃO PAULO, BRAZIL", "Senior architect with 20 years.", "Go · Rust · Kafka"]) {
      expect(cvTextToMarkdown(line), line).toBe(line);
    }
  });

  it("nome de seção conhecido vira título também fora da caixa alta", () => {
    expect(cvTextToMarkdown("Experience\n- Built a platform")).toBe("## Experience\n- Built a platform");
    expect(cvTextToMarkdown("Formação:")).toBe("## Formação");
  });

  it("é idempotente", () => {
    const once = cvTextToMarkdown(PDF_CV_TEXT);
    expect(cvTextToMarkdown(once)).toBe(once);
  });

  it("Markdown passa intacto, inclusive bloco de código", () => {
    const markdown = [
      "# Andreus",
      "",
      "## Experiência",
      "",
      "- **Arquiteto** na Example — [site](https://example.com)",
      "1. primeiro",
      "> citação",
      "",
      "```",
      "SUMMARY",
      "● não é item",
      "```",
      "",
      "Parágrafo comum.",
    ].join("\n");
    expect(cvTextToMarkdown(markdown)).toBe(markdown);
  });

  it("a importação agora reconhece `●` e `■`", () => {
    expect(cleanPdfText("● um\n■ dois\n✓ três")).toBe("- um\n- dois\n- três");
  });
});

describe("cvSections", () => {
  it("expõe resumo, experiência e formação do texto normalizado, cada uma até o próximo título", () => {
    const sections = cvSections(cvTextToMarkdown(PDF_CV_TEXT));
    expect(sections.map((s) => s.kind)).toEqual(["summary", "experience", "education"]);
    expect(sections[0]!.body).toContain("Led teams of 12 engineers");
    expect(sections[0]!.body).not.toContain("Software architecture");
    expect(sections[1]!.body).toContain("Principal Architect");
    expect(sections[2]!.body).toBe("B.Sc. Computer Science — Example University");
  });

  it("seção sem corpo não aparece, e subtítulo fica dentro da seção", () => {
    const md = "## Resumo\n\n## Experiência\n### Example Corp\n- fez X\n## Skills\n- Go";
    const sections = cvSections(md);
    expect(sections.map((s) => s.kind)).toEqual(["experience"]);
    expect(sections[0]!.body).toBe("### Example Corp\n- fez X");
  });

  it("título dentro de bloco de código não abre seção", () => {
    expect(cvSections("```\n## Summary\ntexto\n```")).toEqual([]);
  });
});

describe("o que a normalização não pode abrir no filtro público", () => {
  it("rótulo de pretensão em caixa alta continua saindo com o valor", () => {
    const text = "SUMMARY\nArquiteto.\n\nPRETENSÃO SALARIAL\nUSD 15,000/month\n\nEDUCATION\nB.Sc.";
    const out = publicCvText(cvTextToMarkdown(publicCvText(text)));
    expect(out).not.toContain("15,000");
    expect(out).not.toMatch(/pretens/i);
    expect(out).toContain("## EDUCATION");
  });

  it("`RATE:` sozinho na linha sai no primeiro passe, antes de virar título", () => {
    const text = "Arquiteto.\n\nRATE:\n\nUSD 60/h\n\nEDUCATION\nB.Sc.";
    const out = publicCvText(cvTextToMarkdown(publicCvText(text)));
    expect(out).not.toContain("60/h");
  });
});

describe("MarkdownPreview", () => {
  it("renderiza a fixture do PDF como títulos e listas, sem parágrafo gigante", () => {
    const html = render(PDF_CV_TEXT);
    // O nome em caixa alta no topo também vira título; o `h1` do perfil é outro.
    expect(html.match(/<h2/g)?.length).toBe(5);
    expect(html.match(/<li/g)?.length).toBe(7);
    const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
    expect(Math.max(...paragraphs.map((p) => p.length))).toBeLessThan(600);
  });

  it("quebra simples dentro do parágrafo vira quebra, não espaço", () => {
    expect(render("Principal Architect\nExample Corp")).toContain("Principal Architect<br/>Example Corp");
  });

  it("não interpreta HTML: tag vira texto", () => {
    const html = render('<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("link só vira âncora com http(s); javascript:, data: e mailto: viram texto", () => {
    const html = render(
      "[a](javascript:alert`1`) [b](data:text/html,x) [c](mailto:a@b.co) [d](JaVaScRiPt:void0) [ok](https://example.com)",
    );
    expect(html).not.toMatch(/href="(?:javascript|data|mailto)/i);
    expect(html.match(/<a /g)?.length).toBe(1);
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain("a b c d");
  });
});
