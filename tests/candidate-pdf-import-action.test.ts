import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ save: vi.fn(), after: vi.fn(), guard: vi.fn() }));
vi.mock("../app/auth", () => ({ guardOwnCandidate: state.guard }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: state.after }));
vi.mock("../src/core/candidate.ts", async (original) => ({
  ...await original<typeof import("../src/core/candidate.ts")>(),
  saveDocument: state.save,
}));

const { importPdfAction } = await import("../app/candidate/actions.ts");

beforeEach(() => {
  vi.clearAllMocks();
  state.guard.mockResolvedValue({ candidateId: 42 });
});

describe("importação de PDF no perfil existente (#388)", () => {
  it("devolve recusa nomeada para texto renomeado e não grava nem agenda pontuação", async () => {
    const form = new FormData();
    form.set("file", new File(["currículo em texto, apenas renomeado"], "curriculo.pdf", { type: "application/pdf" }));
    await expect(importPdfAction(form)).resolves.toEqual({ ok: false, code: "pdfNotPdf" });
    expect(state.save).not.toHaveBeenCalled();
    expect(state.after).not.toHaveBeenCalled();
  });

  it("nomeia a ausência de arquivo sem gravar uma versão", async () => {
    await expect(importPdfAction(new FormData())).resolves.toEqual({ ok: false, code: "pdfMissing" });
    expect(state.save).not.toHaveBeenCalled();
  });
});
