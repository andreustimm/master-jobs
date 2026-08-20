// Suite: leitura de config/sources.yaml (src/core/sources/config.ts)
// Invariante: este arquivo é o único ponto onde texto escrito à mão vira
// configuração de sync. Um erro que passe daqui não aparece como erro — aparece
// como fonte que parou de trazer vaga, semanas depois, sem ninguém notar.
// Fronteira DENTRO: validação, filtro de `enabled`, resolução do caminho, leitura.
// Fronteira FORA: os adapters em si e o executor da sync.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSources, parseSourcesConfig, sourcesPath } from "../src/core/sources/config.ts";

afterEach(() => {
  delete process.env.JHO_SOURCES_PATH;
});

describe("sourcesPath", () => {
  it("aponta para config/sources.yaml do projeto por padrão", () => {
    delete process.env.JHO_SOURCES_PATH;
    expect(sourcesPath()).toBe(resolve(process.cwd(), "config/sources.yaml"));
  });

  it("aceita a substituição por ambiente, que é o que torna o teste possível", () => {
    process.env.JHO_SOURCES_PATH = "/tmp/qualquer/sources.yaml";
    expect(sourcesPath()).toBe("/tmp/qualquer/sources.yaml");
  });
});

describe("parseSourcesConfig", () => {
  it("mantém a ordem e o racional escrito pelo usuário", () => {
    // `rationale` é o que faz o arquivo se explicar sozinho meses depois; perdê-lo
    // no parse transformaria a lista de fontes num amontoado sem justificativa.
    const configs = parseSourcesConfig(
      [
        "sources:",
        "  - kind: greenhouse",
        "    handle: acme",
        "    label: Acme",
        "    rationale: infra de agentes, contrata remoto",
        "  - kind: lever",
        "    handle: globex",
        "    label: Globex",
      ].join("\n"),
    );

    expect(configs).toEqual([
      { kind: "greenhouse", handle: "acme", label: "Acme", rationale: "infra de agentes, contrata remoto" },
      { kind: "lever", handle: "globex", label: "Globex", rationale: undefined },
    ]);
  });

  it("respeita enabled: false sem exigir que a linha seja apagada", () => {
    // Desligar uma fonte tem de ser reversível: apagar a entrada perderia o
    // handle e o racional junto.
    const configs = parseSourcesConfig(
      [
        "sources:",
        "  - kind: greenhouse",
        "    handle: acme",
        "    label: Acme",
        "    enabled: false",
        "  - kind: lever",
        "    handle: globex",
        "    label: Globex",
      ].join("\n"),
    );
    expect(configs.map((c) => c.kind)).toEqual(["lever"]);
  });

  it("aceita fonte sem handle, porque agregador não tem board token", () => {
    // RemoteOK e Arbeitnow não recebem handle nenhum; exigi-lo obrigaria a
    // escrever um valor falso no arquivo.
    const configs = parseSourcesConfig("sources:\n  - kind: remoteok\n    label: RemoteOK");
    expect(configs[0]).toEqual({ kind: "remoteok", handle: "", label: "RemoteOK", rationale: undefined });
  });

  it("aponta o campo e a linha do problema em vez de só recusar o arquivo", () => {
    // Mensagem genérica em arquivo de configuração custa uma tarde. O caminho do
    // campo é a diferença entre corrigir e adivinhar.
    expect(() =>
      parseSourcesConfig("sources:\n  - kind: greenhouse\n    handle: acme\n    label: ''"),
    ).toThrow(/sources\.0\.label/);
  });

  it("recusa uma lista vazia, que passaria como sync silenciosamente sem fonte", () => {
    expect(() => parseSourcesConfig("sources: []")).toThrow("sources.yaml is invalid");
  });

  it("recusa um arquivo sem a chave sources", () => {
    expect(() => parseSourcesConfig("outra_coisa: 1")).toThrow("sources.yaml is invalid");
  });
});

describe("loadSources", () => {
  it("lê o arquivo apontado pelo ambiente e o valida no mesmo passo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jho-sources-"));
    const file = join(dir, "sources.yaml");
    writeFileSync(
      file,
      "sources:\n  - kind: ashby\n    handle: acme\n    label: Acme\n  - kind: adzuna\n    handle: 'br:ai'\n    label: Adzuna\n    enabled: false\n",
    );
    process.env.JHO_SOURCES_PATH = file;

    await expect(loadSources()).resolves.toEqual([
      { kind: "ashby", handle: "acme", label: "Acme", rationale: undefined },
    ]);
  });

  it("propaga a falha de leitura em vez de fingir que não há fonte", async () => {
    // Devolver [] num arquivo ausente faria a sync reportar "0 vagas" como se
    // fosse resultado, e não como configuração quebrada.
    process.env.JHO_SOURCES_PATH = join(tmpdir(), "jho-sources-inexistente", "sources.yaml");
    await expect(loadSources()).rejects.toThrow();
  });
});
