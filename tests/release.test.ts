import { describe, expect, it } from "vitest";
import {
  carimbarUnreleased,
  changelogTemVersao,
  classificarBump,
  proximaVersao,
} from "../src/core/release.ts";

describe("classificarBump", () => {
  it("fix puro pede patch", () => {
    expect(classificarBump(["fix: corrige o KDF"])).toBe("patch");
  });

  it("feat puro pede minor", () => {
    expect(classificarBump(["feat: score por candidato"])).toBe("minor");
  });

  it("com escopo continua valendo", () => {
    expect(classificarBump(["fix(auth): corrige o KDF"])).toBe("patch");
    expect(classificarBump(["feat(matching): deriva perfil do currículo"])).toBe("minor");
  });

  it("BREAKING CHANGE pede major, mesmo com feat e fix juntos", () => {
    const leva = [
      "fix: uma correção",
      "feat: uma funcionalidade",
      "feat!: removo a API antiga",
    ];
    expect(classificarBump(leva)).toBe("major");
  });

  it("`tipo!` sem escopo pede major", () => {
    expect(classificarBump(["feat!: quebra a interface"])).toBe("major");
    expect(classificarBump(["fix(auth)!: muda o formato da senha"])).toBe("major");
  });

  it("o maior nível vence: feat + fix → minor", () => {
    expect(classificarBump(["fix: a", "feat: b"])).toBe("minor");
  });

  it("chore, docs e mensagem livre não pedem release", () => {
    expect(classificarBump(["chore: bump de dependência"])).toBeNull();
    expect(classificarBump(["docs: atualiza o README"])).toBeNull();
    expect(classificarBump(["Backlog: M-06 marcado como entregue"])).toBeNull();
    expect(classificarBump([])).toBeNull();
  });
});

describe("proximaVersao", () => {
  it("patch, minor e major andam uma casa cada um", () => {
    expect(proximaVersao("1.0.0", "patch")).toBe("1.0.1");
    expect(proximaVersao("1.0.0", "minor")).toBe("1.1.0");
    expect(proximaVersao("1.0.0", "major")).toBe("2.0.0");
  });

  it("minor zera o patch e major zera tudo", () => {
    expect(proximaVersao("1.2.3", "minor")).toBe("1.3.0");
    expect(proximaVersao("1.2.3", "major")).toBe("2.0.0");
  });

  it("recusa versão que não é MAJOR.MINOR.PATCH", () => {
    for (const torta of ["", "1.0", "v1.0.0", "um.dois.três", "1.0.0.0"]) {
      expect(() => proximaVersao(torta, "patch")).toThrow();
    }
  });
});

describe("carimbarUnreleased", () => {
  const entrada = `## [Unreleased]

### Adicionado

- Algo novo.

## [1.0.0] - 2026-08-21
`;

  it("troca o cabeçalho, preserva o texto e reabre um Unreleased vazio", () => {
    const carimbado = carimbarUnreleased(entrada, "1.1.0", "2026-08-22");
    expect(carimbado).toContain("## [1.1.0] - 2026-08-22");
    expect(carimbado).toContain("### Adicionado");
    expect(carimbado).toContain("- Algo novo.");
    // A seção em construção reabre no topo: sem isto, a promoção seguinte
    // falharia por ausência de `[Unreleased]`.
    expect(carimbado).toMatch(/^## \[Unreleased\]\s*$/m);
    // A versão carimbada vem logo depois do novo vazio.
    const posicaoVazio = carimbado.indexOf("## [Unreleased]");
    const posicaoVersao = carimbado.indexOf("## [1.1.0] - 2026-08-22");
    expect(posicaoVazio).toBeLessThan(posicaoVersao);
  });

  it("sem Unreleased falha em vez de passar mudo", () => {
    expect(() => carimbarUnreleased("## [1.0.0] - 2026-08-21\n", "1.1.0", "2026-08-22")).toThrow();
  });

  it("duas seções Unreleased falham", () => {
    const duplicado = `## [Unreleased]\n\n- a\n\n## [Unreleased]\n\n- b\n`;
    expect(() => carimbarUnreleased(duplicado, "1.1.0", "2026-08-22")).toThrow();
  });
});

describe("changelogTemVersao", () => {
  it("aceita com e sem data", () => {
    expect(changelogTemVersao("## [1.1.0]\n", "1.1.0")).toBe(true);
    expect(changelogTemVersao("## [1.1.0] - 2026-08-22\n", "1.1.0")).toBe(true);
  });

  it("não confunde 1.1.0 com 1.1.1", () => {
    expect(changelogTemVersao("## [1.1.1]\n", "1.1.0")).toBe(false);
  });
});
