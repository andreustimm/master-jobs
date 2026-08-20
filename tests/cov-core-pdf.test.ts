import { describe, expect, it } from "vitest";
import { extractPdfText } from "../src/core/pdf.ts";

/**
 * PDFs sintéticos, montados byte a byte.
 *
 * Um currículo real não pode entrar no repositório (é material pessoal) e um
 * arquivo binário de fixture não deixa ninguém ver o que está sendo testado.
 * Montar o PDF aqui torna explícito qual característica do documento dispara
 * cada aviso — que é justamente o que se quer conferir.
 *
 * `MediaBox` é deliberadamente larguíssimo: o extrator quebra linha onde o
 * renderizador quebrou, então uma página estreita transformaria o caso de
 * "linha longa" em várias linhas curtas e o teste passaria a medir a página
 * em vez de medir o aviso.
 */
function pdfComTexto(paginas: string[][], larguraPt = 9_000): Uint8Array {
  const objetos: string[] = [];
  const idsDePagina = paginas.map((_, i) => 4 + i * 2);
  objetos.push("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj");
  objetos.push(
    `2 0 obj<</Type/Pages/Kids[${idsDePagina
      .map((id) => `${id} 0 R`)
      .join(" ")}]/Count ${paginas.length}>>endobj`,
  );
  objetos.push("3 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj");

  paginas.forEach((linhas, i) => {
    const idPagina = idsDePagina[i]!;
    const idConteudo = idPagina + 1;
    const fluxo = linhas
      .map((linha, n) => {
        const escapada = linha.replace(/([\\()])/g, "\\$1");
        return `BT /F1 10 Tf 20 ${740 - n * 14} Td (${escapada}) Tj ET`;
      })
      .join("\n");
    objetos.push(
      `${idPagina} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${larguraPt} 792]` +
        `/Resources<</Font<</F1 3 0 R>>>>/Contents ${idConteudo} 0 R>>endobj`,
    );
    objetos.push(
      `${idConteudo} 0 obj<</Length ${fluxo.length}>>stream\n${fluxo}\nendstream endobj`,
    );
  });

  return new TextEncoder().encode(`%PDF-1.4\n${objetos.join("\n")}\ntrailer<</Root 1 0 R>>`);
}

describe("extractPdfText: avisos que impedem lixo de virar análise", () => {
  it("não avisa nada quando a extração sai limpa", async () => {
    // A linha de base. Sem ela, um aviso disparando sempre passaria por
    // "detecção funcionando".
    const linhas = Array.from(
      { length: 8 },
      (_, i) => `Linha ${i}: arquitetura distribuida, observabilidade e entrega continua em nuvem`,
    );
    const r = await extractPdfText(pdfComTexto([linhas]));
    expect(r.pages).toBe(1);
    expect(r.text.length).toBeGreaterThan(200);
    expect(r.warnings).toEqual([]);
  });

  it("avisa quando o texto extraído tem pouca letra", async () => {
    // Proporção baixa de letras é o sintoma de formatação perdida: tabela que
    // virou sopa de números, ou fonte sem mapa de caracteres. O texto até
    // "existe", e é por isso que só o comprimento não detecta o problema —
    // ele seguiria em silêncio para a detecção de skills e não casaria nada.
    const linhas = Array.from(
      { length: 6 },
      (_, i) => `${i} 1234567890 9876543210 5555 4444 3333 2222 1111 0000 9999 8888 7777`,
    );
    const r = await extractPdfText(pdfComTexto([linhas]));
    expect(r.text.length).toBeGreaterThan(200);
    expect(r.warnings.join(" ")).toContain("proporção de letras");
  });

  it("avisa quando o documento sai como uma linha gigante", async () => {
    // Layout em duas colunas costuma extrair intercalado: a frase da coluna
    // esquerda encosta na da direita e a ordem de leitura fica trocada. A
    // evidência em nível de frase ("usei X para entregar Y") é o que a
    // estratégia `applied` mais pesa, e ela morre nesse cenário.
    const umaLinhaEnorme = Array.from({ length: 12 }, (_, i) =>
      `bloco${i}`.padEnd(60, "x"),
    ).join(" ");
    const r = await extractPdfText(pdfComTexto([[umaLinhaEnorme]]));
    expect(r.text.split("\n")).toHaveLength(1);
    expect(r.text.length).toBeGreaterThan(400);
    expect(r.warnings.join(" ")).toContain("Linhas muito longas");
  });

  it("avisa sobre currículo longo, e só para currículo", async () => {
    // Sete páginas diluem o vocabulário na análise de lacuna: a contagem de
    // termos cresce com o documento e a cobertura relativa cai. Já uma
    // DESCRIÇÃO DE VAGA de sete páginas é normal (jurídico, benefícios), e
    // avisar ali treinaria o usuário a ignorar o aviso.
    const seteFolhas = Array.from({ length: 7 }, (_, i) => [`Pagina ${i + 1}`]);
    const comoCurriculo = await extractPdfText(pdfComTexto(seteFolhas));
    expect(comoCurriculo.pages).toBe(7);
    expect(comoCurriculo.warnings.join(" ")).toContain("7 páginas");

    const comoVaga = await extractPdfText(pdfComTexto(seteFolhas), { documentKind: "job" });
    expect(comoVaga.warnings.join(" ")).not.toContain("páginas");
  });

  it("aceita ArrayBuffer além de Uint8Array", async () => {
    // O upload do dashboard chega como ArrayBuffer e a CLI lê como Buffer.
    // As duas pontas precisam produzir exatamente o mesmo texto.
    const bytes = pdfComTexto([["Arquitetura de sistemas distribuidos e plataformas de IA"]]);
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const [deBytes, deBuffer] = await Promise.all([
      extractPdfText(bytes),
      extractPdfText(buffer),
    ]);
    expect(deBuffer.text).toBe(deBytes.text);
    expect(deBuffer.text).toContain("Arquitetura de sistemas distribuidos");
  });
});
