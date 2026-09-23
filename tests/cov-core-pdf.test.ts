import { describe, expect, it } from "vitest";
import { CV_PDF_MAX_BYTES, extractPdfText, readCvPdf } from "../src/core/pdf.ts";
import { pdfComTexto } from "./support/synthetic-pdf.ts";

const CV_LINHAS = Array.from(
  { length: 6 },
  (_, i) => `Experiencia ${i}: arquitetura de plataformas de dados e observabilidade em nuvem`,
);

function arquivo(bytes: Uint8Array<ArrayBuffer> | string, nome = "Maria CV.pdf"): File {
  return new File([bytes], nome, { type: "application/pdf" });
}

describe("readCvPdf: o caminho único do currículo enviado em PDF", () => {
  it("extrai o texto e usa o nome do arquivo como rótulo", async () => {
    const r = await readCvPdf(arquivo(pdfComTexto([CV_LINHAS])));
    expect(r).toMatchObject({ ok: true, label: "Maria CV" });
    if (r.ok) expect(r.text).toContain("arquitetura de plataformas de dados");
  });

  it("recusa ausência, arquivo vazio e o que não é File", async () => {
    expect(await readCvPdf(null)).toEqual({ ok: false, code: "pdfMissing" });
    expect(await readCvPdf("texto")).toEqual({ ok: false, code: "pdfMissing" });
    expect(await readCvPdf(arquivo(new Uint8Array()))).toEqual({ ok: false, code: "pdfMissing" });
  });

  it("recusa acima do teto sem ler o conteúdo", async () => {
    const grande = new Uint8Array(CV_PDF_MAX_BYTES + 1);
    grande.set(new TextEncoder().encode("%PDF-1.4"));
    expect(await readCvPdf(arquivo(grande))).toEqual({ ok: false, code: "pdfTooLarge" });
  });

  it("decide o tipo pelos bytes, não pelo nome nem pelo MIME declarado", async () => {
    // Nome e `type` dizem PDF; o conteúdo é texto. É o que o navegador manda
    // quando alguém renomeia um .txt.
    expect(await readCvPdf(arquivo("só texto, sem cabeçalho de PDF"))).toEqual({ ok: false, code: "pdfNotPdf" });
    // Cabeçalho certo, corpo que o leitor não entende.
    expect(await readCvPdf(arquivo("%PDF-1.4\nlixo sem objeto nenhum"))).toEqual({ ok: false, code: "pdfNotPdf" });
  });

  it("aceita lixo antes do cabeçalho, como os leitores de PDF aceitam", async () => {
    const pdf = pdfComTexto([CV_LINHAS]);
    const prefixado = new Uint8Array(16 + pdf.length);
    prefixado.set(pdf, 16);
    expect((await readCvPdf(arquivo(prefixado))).ok).toBe(true);
  });

  it("recusa PDF sem texto suficiente para ser currículo", async () => {
    expect(await readCvPdf(arquivo(pdfComTexto([["Maria"]])))).toEqual({ ok: false, code: "pdfNoText" });
  });
});

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
