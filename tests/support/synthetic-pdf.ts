/**
 * PDFs sintéticos, montados byte a byte.
 *
 * Um currículo real não pode entrar no repositório (é material pessoal) e um
 * arquivo binário de fixture não deixa ninguém ver o que está sendo testado.
 * Montar o PDF aqui torna explícito qual característica do documento dispara
 * cada comportamento — que é justamente o que se quer conferir.
 *
 * `MediaBox` é deliberadamente larguíssimo: o extrator quebra linha onde o
 * renderizador quebrou, então uma página estreita transformaria o caso de
 * "linha longa" em várias linhas curtas e o teste passaria a medir a página
 * em vez de medir o aviso.
 */
export function pdfComTexto(paginas: string[][], larguraPt = 9_000): Uint8Array<ArrayBuffer> {
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
      // `/Length` conta bytes; `fluxo.length` contaria unidades UTF-16.
      `${idConteudo} 0 obj<</Length ${new TextEncoder().encode(fluxo).length}>>stream\n${fluxo}\nendstream endobj`,
    );
  });

  return new TextEncoder().encode(`%PDF-1.4\n${objetos.join("\n")}\ntrailer<</Root 1 0 R>>`);
}
