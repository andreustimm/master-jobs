import { beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { carregarCli, rodar } from "./cov-cli-harness.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

describe("smoke", () => {
  let boot: Awaited<ReturnType<typeof carregarCli>>;
  beforeAll(async () => {
    boot = await carregarCli();
  });

  it("boot", () => {
    expect(boot.code).toBe(1);
  });

  it("status invalido", async () => {
    const r = await rodar("track", "1", "nao-existe");
    console.info(JSON.stringify(r, null, 2));
    expect(r.code).toBe(1);
  });
});
