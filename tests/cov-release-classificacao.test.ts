/**
 * Qual versão a leva pede, e quando ela recusa abrir versão.
 *
 * `src/core/release.ts` estava em 88,4% de branches, e o que faltava era a metade
 * que decide **não** publicar: prefixo de manutenção, o título gerado pela própria
 * PR de promoção, `fix(ci)` e a convenção antiga `BREAKING CHANGE`.
 *
 * Errar aqui não quebra teste nenhum e publica a versão errada: um `chore:` lido
 * como produto abre uma versão que ninguém pediu, e um `feat!:` lido como patch
 * esconde uma quebra atrás de um número que promete compatibilidade.
 */
import { describe, expect, it } from "vitest";
import {
  classificarBump,
  proximaVersao,
  versaoSemanticaValida,
} from "../src/core/release.ts";

describe("o nível que a leva pede", () => {
  it("UT-220 `feat` é minor, `fix` é patch, e o maior de todos ganha", () => {
    expect(classificarBump(["feat: algo"])).toBe("minor");
    expect(classificarBump(["fix: algo"])).toBe("patch");
    // A ordem não importa: a leva vale pelo maior.
    expect(classificarBump(["fix: a", "feat: b"])).toBe("minor");
    expect(classificarBump(["feat: b", "fix: a"])).toBe("minor");
  });

  it("UT-221 prefixo de manutenção não pede versão, sozinho ou acompanhado", () => {
    for (const tipo of ["chore", "docs", "refactor", "test", "ci"]) {
      expect(classificarBump([`${tipo}: algo`]), tipo).toBeNull();
      expect(classificarBump([`${tipo}(escopo): algo`]), tipo).toBeNull();
    }
    // Acompanhado, quem manda é o commit de produto.
    expect(classificarBump(["chore: a", "fix: b"])).toBe("patch");
  });

  it("UT-222 mensagem sem prefixo, ou com prefixo desconhecido, conta como patch", () => {
    // Quem não rotulou como manutenção não declarou que nada muda — e o silêncio
    // não pode virar "não publique".
    expect(classificarBump(["arrumei o filtro"])).toBe("patch");
    expect(classificarBump(["Backlog: revisar"])).toBe("patch");
    expect(classificarBump(["M-06: ajuste"])).toBe("patch");
  });

  it("UT-223 assunto vazio ou só espaço é ignorado, e leva vazia não pede nada", () => {
    expect(classificarBump([])).toBeNull();
    expect(classificarBump(["", "   ", "\t"])).toBeNull();
    // Vazio no meio não apaga o resto.
    expect(classificarBump(["", "fix: algo", "  "])).toBe("patch");
  });

  it("UT-224 `!` depois do tipo é major, e só em `feat` e `fix`", () => {
    expect(classificarBump(["feat!: quebra"])).toBe("major");
    expect(classificarBump(["fix(escopo)!: quebra"])).toBe("major");
    // `chore!` não é quebra de produto: nada de produto mudou.
    expect(classificarBump(["chore!: mexi no CI"])).toBeNull();
    expect(classificarBump(["docs!: reescrevi"])).toBeNull();
  });

  it("UT-225 a convenção antiga `BREAKING CHANGE` no texto é major", () => {
    expect(classificarBump(["feat: algo BREAKING CHANGE no contrato"])).toBe("major");
    expect(classificarBump(["fix: algo BREAKING-CHANGE"])).toBe("major");
    // Sem hífen nem espaço não é a convenção.
    expect(classificarBump(["fix: algo BREAKINGCHANGE"])).toBe("patch");
  });

  it("UT-226 o título da PR de promoção não abre uma segunda versão", () => {
    // Ele é squash-merged pelo GitHub e vira commit comum. Sem este
    // reconhecimento, o retorno de `main` para `dev` abriria outra versão.
    expect(classificarBump(["Promover staging para produção — v1.20.1"])).toBeNull();
    expect(classificarBump(["Promover staging para produção — v1.20.1 (#160)"])).toBeNull();
    // Mas um commit de produto na mesma leva continua contando.
    expect(
      classificarBump(["Promover staging para produção — v1.20.1", "fix: algo"]),
    ).toBe("patch");
  });

  it("UT-227 `fix(ci)` não publica: o produto não mudou", () => {
    expect(classificarBump(["fix(ci): ler a versão de um atributo"])).toBeNull();
    expect(classificarBump(["fix(ci)!: mudei o workflow"])).toBeNull();
    // O escopo explícito preserva `fix:` em qualquer outra área.
    expect(classificarBump(["fix(db): corrigi a consulta"])).toBe("patch");
  });
});

describe("a versão seguinte", () => {
  it("UT-228 cada nível move o seu número e zera os de baixo", () => {
    expect(proximaVersao("1.20.1", "patch")).toBe("1.20.2");
    expect(proximaVersao("1.20.1", "minor")).toBe("1.21.0");
    expect(proximaVersao("1.20.1", "major")).toBe("2.0.0");
  });

  it("UT-229 só três números sem zero à esquerda são versão válida", () => {
    expect(versaoSemanticaValida("1.20.1")).toBe(true);
    expect(versaoSemanticaValida("0.0.0")).toBe(true);
    expect(versaoSemanticaValida("1.20")).toBe(false);
    expect(versaoSemanticaValida("v1.20.1")).toBe(false);
    // Zero à esquerda é ambíguo e o SemVer recusa.
    expect(versaoSemanticaValida("01.2.3")).toBe(false);
    expect(versaoSemanticaValida("1.02.3")).toBe(false);
    expect(versaoSemanticaValida("1.2.3-rc1")).toBe(false);
  });
});
