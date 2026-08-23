import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("ritmo vertical das superfícies principais", () => {
  it("mantém Cockpit e Vagas no mesmo início de conteúdo da comparação", async () => {
    const [cockpit, jobs, compare, globals] = await Promise.all([
      readFile("app/page.tsx", "utf8"),
      readFile("app/jobs/page.tsx", "utf8"),
      readFile("app/compare/page.tsx", "utf8"),
      readFile("app/globals.css", "utf8"),
    ]);

    for (const page of [cockpit, jobs, compare]) {
      expect(page).toContain('<main className="page-content-top');
    }
    expect(globals).toContain("padding-top: calc(var(--spacing-xl) + var(--spacing-md))");
    expect(cockpit).not.toMatch(/<header className="pt-/);
    expect(jobs).not.toMatch(/<header className="pt-/);
  });

  it("usa o padding interno de 24px do DESIGN.md nos cabeçalhos das modais", async () => {
    const [changelog, users, editUser] = await Promise.all([
      readFile("app/changelog-modal.tsx", "utf8"),
      readFile("app/admin/user-modal.tsx", "utf8"),
      readFile("app/admin/edit-user-form.tsx", "utf8"),
    ]);

    expect(changelog).toMatch(/<header className="[^"]*\bpy-6\b/);
    expect(users).toMatch(/<header className="[^"]*\bpy-6\b/);
    expect(editUser).toMatch(/<header className="[^"]*\bpy-6\b/);
  });

  it("mantém a notificação dentro das áreas seguras da tela", async () => {
    const editUser = await readFile("app/admin/edit-user-form.tsx", "utf8");

    expect(editUser).toContain('top: "max(var(--spacing-md), env(safe-area-inset-top))"');
    expect(editUser).toContain('right: "max(var(--spacing-md), env(safe-area-inset-right))"');
    expect(editUser).toContain(
      '"min(calc(100vw - max(var(--spacing-md), env(safe-area-inset-left)) - max(var(--spacing-md), env(safe-area-inset-right))), 24rem)"',
    );
  });

});
