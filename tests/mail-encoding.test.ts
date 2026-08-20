import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEml } from "../src/core/mail/eml.ts";
import { classify } from "../src/core/mail/classify.ts";

/**
 * Acentos sobrevivendo do arquivo até o classificador.
 *
 * Um `.eml` é formato de BYTES cujo charset é declarado dentro dele. Lê-lo como
 * texto perde a informação antes de o parser existir, e o estrago é silencioso:
 * "não" vira "n�o", nada falha, e a mensagem entra no banco.
 *
 * O custo real não é estético. As regras de rejeição em português dependem
 * desses acentos — "infelizmente", "não seguiremos" —, e uma rejeição não
 * reconhecida deixa a candidatura aberta no funil por semanas. É o tipo de
 * defeito que só aparece quando alguém pergunta por que aquela vaga nunca
 * fechou.
 *
 * Passava despercebido porque os ATS mandam quoted-printable ou base64, que
 * percorrem outro caminho. Só o e-mail entregue em 8bit puro estragava.
 */

const CORPO = "Infelizmente não seguiremos com a sua candidatura. Obrigado pela atenção.";

async function escreverEml(charset: string, bytes: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eml-charset-"));
  const cabecalho = Buffer.from(
    [
      "From: rh@empresa.com",
      "Subject: Retorno do processo",
      `Content-Type: text/plain; charset=${charset}`,
      "Content-Transfer-Encoding: 8bit",
      "",
      "",
    ].join("\r\n"),
    "ascii",
  );
  const path = join(dir, "mensagem.eml");
  await writeFile(path, Buffer.concat([cabecalho, bytes]));
  return path;
}

/** Exatamente como `importMail` lê o arquivo. */
async function lerComoOImport(path: string): Promise<string> {
  return readFile(path, "latin1");
}

describe("corpo 8bit preserva acento", () => {
  it("UTF-8 declarado chega íntegro ao texto", async () => {
    const path = await escreverEml("UTF-8", Buffer.from(CORPO, "utf8"));
    const mail = parseEml(await lerComoOImport(path));

    expect(mail.text).toContain("não seguiremos");
    expect(mail.text).toContain("atenção");
    // O caractere de substituição é a assinatura do defeito: aparecia no lugar
    // de todo acento e nada sinalizava erro.
    expect(mail.text).not.toContain("�");
  });

  it("ISO-8859-1 declarado também chega íntegro", async () => {
    // Ler o arquivo como utf8 destruiria este caso antes do parser: os bytes
    // latin1 não formam UTF-8 válido e viram substituição irreversível.
    const path = await escreverEml("ISO-8859-1", Buffer.from(CORPO, "latin1"));
    const mail = parseEml(await lerComoOImport(path));

    expect(mail.text).toContain("não seguiremos");
    expect(mail.text).not.toContain("�");
  });

  it("a rejeição em português continua sendo reconhecida", async () => {
    // A consequência que importa. Sem acento, a regra não casa, a candidatura
    // fica aberta no funil e ninguém descobre até estranhar o silêncio.
    const path = await escreverEml("UTF-8", Buffer.from(CORPO, "utf8"));
    const mail = parseEml(await lerComoOImport(path));

    expect(classify(mail, mail.text ?? "").kind).toBe("ats_rejection");
  });

  it("quoted-printable e base64 seguem corretos", async () => {
    // Os dois caminhos que os ATS usam de verdade. Eles já funcionavam, e é por
    // isso que o defeito do 8bit sobreviveu tanto tempo — nunca aparecia no uso
    // real, só num e-mail entregue cru.
    for (const [encoding, payload] of [
      ["quoted-printable", "Infelizmente n=C3=A3o seguiremos"],
      ["base64", Buffer.from("Infelizmente não seguiremos", "utf8").toString("base64")],
    ] as const) {
      const raw = [
        "From: rh@empresa.com",
        "Subject: Retorno",
        "Content-Type: text/plain; charset=UTF-8",
        `Content-Transfer-Encoding: ${encoding}`,
        "",
        payload,
      ].join("\r\n");

      expect(parseEml(raw).text).toContain("não seguiremos");
    }
  });
});
