/**
 * Suíte: Termos de Uso e Política de Privacidade versionados (#464, ADR-012).
 *
 * Fronteira DENTRO: `src/core/legal.ts` lendo do disco — os textos publicados
 * em `content/legal/` e um diretório temporário onde a versão muda.
 * Fronteira FORA: as páginas `/terms` e `/privacy` e o cadastro que grava a
 * versão aceita.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { currentLegalVersions, LEGAL_DIR, LEGAL_KINDS, readLegal } from "../src/core/legal.ts";
import { LOCALES } from "../src/core/i18n/locales.ts";

const temporary: string[] = [];

function copyOfLegal(): string {
  const dir = mkdtempSync(join(tmpdir(), "jho-legal-"));
  temporary.push(dir);
  cpSync(LEGAL_DIR, dir, { recursive: true });
  return dir;
}

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("documentos legais", () => {
  it("UT-100 lê título, corpo e versão do front matter", () => {
    const terms = readLegal("terms", "pt-BR");
    expect(terms).toMatchObject({ kind: "terms", locale: "pt-BR", title: "Termos de Uso" });
    expect(terms.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(terms.body.startsWith("---")).toBe(false);
    expect(terms.body).toContain("contato@mastertimm.com.br");
    expect(readLegal("privacy", "en").title).toBe("Privacy Policy");
  });

  it("UT-100 todo documento publicado existe nos dois idiomas, com a mesma versão e o contato", () => {
    for (const kind of LEGAL_KINDS) {
      const versions = LOCALES.map(({ id }) => {
        const document = readLegal(kind, id);
        expect(document.body, `${kind}.${id}`).toContain("contato@mastertimm.com.br");
        return document.version;
      });
      expect(new Set(versions).size, kind).toBe(1);
    }
    // A política cita o que o login social guarda (ADR-003).
    expect(readLegal("privacy", "pt-BR").body).toContain("identificador");
    expect(readLegal("privacy", "en").body).toContain("identifier");
  });

  it("UT-100 front matter quebrado é erro que nomeia o arquivo, nunca versão inventada", () => {
    const dir = copyOfLegal();
    writeFileSync(join(dir, "terms.en.md"), "---\ntitle: Terms\nversion: ontem\n---\nTexto");
    expect(() => readLegal("terms", "en", dir)).toThrow("terms.en.md com version fora do formato AAAA-MM-DD");
    writeFileSync(join(dir, "terms.en.md"), "# sem front matter");
    expect(() => readLegal("terms", "en", dir)).toThrow("terms.en.md sem front matter");
  });

  it("UT-101 as versões vigentes acompanham o front matter depois de uma mudança", () => {
    const dir = copyOfLegal();
    const before = currentLegalVersions(dir);
    expect(before).toEqual({
      terms: readLegal("terms", "pt-BR").version,
      privacy: readLegal("privacy", "pt-BR").version,
    });

    for (const locale of ["pt-BR", "en"]) {
      const file = join(dir, `terms.${locale}.md`);
      writeFileSync(file, readFileSync(file, "utf8").replace(/version: "[^"]+"/, 'version: "2099-01-31"'));
    }
    expect(currentLegalVersions(dir)).toEqual({ terms: "2099-01-31", privacy: before.privacy });

    // Tradução esquecida com a versão antiga: erro, não aceite ambíguo.
    const en = join(dir, "privacy.en.md");
    writeFileSync(en, readFileSync(en, "utf8").replace(/version: "[^"]+"/, 'version: "2099-02-01"'));
    expect(() => currentLegalVersions(dir)).toThrow("privacy: versões diferentes entre pt-BR e en");
  });
});
