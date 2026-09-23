/**
 * Publicação dos mapas de origem no build.
 *
 * O contrato tem duas metades: sem credencial o build segue igual (e diz
 * isso), e com credencial uma falha do Sentry também não barra o deploy. O
 * `sentry-cli` entra injetado — o teste nunca fala com a rede.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { publishServerSourceMaps } from "../scripts/sentry-source-maps.ts";

const TOKEN = "sntrys_token-que-nao-pode-aparecer";

function registro() {
  const linhas: string[] = [];
  const chamadas: string[][] = [];
  return {
    linhas,
    chamadas,
    log: (linha: string) => linhas.push(linha),
    run: async (args: string[]) => {
      chamadas.push(args);
    },
  };
}

describe("publishServerSourceMaps", () => {
  it("sem SENTRY_AUTH_TOKEN, não chama o sentry-cli e diz por quê", async () => {
    const r = registro();
    await publishServerSourceMaps({ distDir: "/build/.next" }, { env: {}, log: r.log, run: r.run });
    expect(r.chamadas).toEqual([]);
    expect(r.linhas).toEqual([expect.stringContaining("SENTRY_AUTH_TOKEN ausente")]);
  });

  it("com token, injeta e envia só o diretório do servidor, com o SHA como release", async () => {
    const r = registro();
    await publishServerSourceMaps(
      { distDir: "/build/.next" },
      { env: { SENTRY_AUTH_TOKEN: TOKEN, VERCEL_GIT_COMMIT_SHA: "abc123" }, log: r.log, run: r.run },
    );
    const servidor = path.join("/build/.next", "server");
    expect(r.chamadas).toEqual([
      ["sourcemaps", "inject", servidor],
      ["sourcemaps", "upload", "--org", "master-timm", "--project", "master-jobs", "--release", "abc123", servidor],
    ]);
    // O token nunca vai em argumento: o sentry-cli o lê do ambiente, e
    // argumento aparece em lista de processos e em log de build.
    expect(JSON.stringify(r.chamadas)).not.toContain(TOKEN);
    expect(r.linhas.join("\n")).toContain("publicados em master-timm/master-jobs");
  });

  it("sem SHA, envia sem --release", async () => {
    const r = registro();
    await publishServerSourceMaps({ distDir: "/b" }, { env: { SENTRY_AUTH_TOKEN: TOKEN }, log: r.log, run: r.run });
    expect(r.chamadas[1]).not.toContain("--release");
  });

  it("falha do Sentry não derruba o build e não vaza o token no log", async () => {
    const linhas: string[] = [];
    await expect(
      publishServerSourceMaps(
        { distDir: "/b" },
        {
          env: { SENTRY_AUTH_TOKEN: TOKEN },
          log: (l) => linhas.push(l),
          run: async () => {
            throw new Error(`401 Unauthorized: token=${TOKEN}`);
          },
        },
      ),
    ).resolves.toBeUndefined();
    expect(linhas.join("\n")).toContain("o build segue sem eles");
    expect(linhas.join("\n")).not.toContain(TOKEN);
  });

  it("falha que não é Error também é registrada sem derrubar", async () => {
    const linhas: string[] = [];
    await publishServerSourceMaps(
      { distDir: "/b" },
      {
        env: { SENTRY_AUTH_TOKEN: TOKEN },
        log: (l) => linhas.push(l),
        run: async () => {
          throw "binário do sentry-cli ausente";
        },
      },
    );
    expect(linhas.join("\n")).toContain("binário do sentry-cli ausente");
  });
});

describe("next.config.ts", () => {
  const config = readFileSync("next.config.ts", "utf8");

  it("liga o gancho pós-compilação e nunca gera mapa de cliente", () => {
    expect(config).toContain("runAfterProductionCompile");
    expect(config).toContain("publishServerSourceMaps");
    expect(config).toContain("productionBrowserSourceMaps: false");
  });

  it("não usa withSentryConfig, que injeta código no cliente e embrulha as rotas", () => {
    expect(config).not.toContain("withSentryConfig");
  });
});
