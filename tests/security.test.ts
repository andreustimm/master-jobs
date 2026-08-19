import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkBinding,
  checkDbPermissions,
  checkIgnored,
  checkPii,
} from "../src/core/security.ts";

/**
 * These lock in fixes for problems that were live in this repository, not
 * hypotheticals. The binding one especially: the dashboard was reachable at
 * http://192.168.50.170:3000/candidate and served the CV, with no auth.
 */

describe("checkBinding", () => {
  it("is critical when a script does not pin the host", () => {
    const pkg = JSON.stringify({ scripts: { dev: "next dev --turbopack", start: "next start" } });
    const f = checkBinding(pkg);
    expect(f.level).toBe("critical");
    expect(f.detail).toContain("autenticação");
  });

  it("passes when both scripts pin loopback", () => {
    const pkg = JSON.stringify({
      scripts: { dev: "next dev --turbopack --hostname 127.0.0.1", start: "next start --hostname 127.0.0.1" },
    });
    expect(checkBinding(pkg).level).toBe("ok");
  });

  it("accepts localhost as well as the literal address", () => {
    const pkg = JSON.stringify({ scripts: { dev: "next dev --hostname localhost" } });
    expect(checkBinding(pkg).level).toBe("ok");
  });

  it("catches a partial fix", () => {
    // Fixing `dev` and forgetting `start` is the likely mistake.
    const pkg = JSON.stringify({
      scripts: { dev: "next dev --hostname 127.0.0.1", start: "next start" },
    });
    expect(checkBinding(pkg).level).toBe("critical");
  });

  it("does not crash on unparseable input", () => {
    expect(checkBinding("not json").level).toBe("warning");
  });
});

describe("the real package.json", () => {
  it("still pins the server to loopback", () => {
    // The regression guard. Someone removing --hostname turns this red.
    expect(checkBinding(readFileSync("package.json", "utf8")).level).toBe("ok");
  });

  it("still ignores the database and secrets", () => {
    expect(checkIgnored(readFileSync(".gitignore", "utf8")).level).toBe("ok");
  });
});

describe("checkPii", () => {
  it("finds a phone number", () => {
    const f = checkPii([{ path: "profile.yaml", content: "WhatsApp: +55 (14) 98827-1204" }]);
    expect(f.level).toBe("warning");
    expect(f.detail).toContain("telefone");
  });

  it("finds a personal mailbox", () => {
    const f = checkPii([{ path: "p.yaml", content: "email: alguem@gmail.com" }]);
    expect(f.detail).toContain("e-mail pessoal");
  });

  it("does not fire on a corporate address", () => {
    // Flagging every work e-mail would train the user to ignore the warning.
    expect(checkPii([{ path: "p.yaml", content: "contato@empresa.com.br" }]).level).toBe("ok");
  });

  it("is quiet when there is nothing to say", () => {
    expect(checkPii([]).level).toBe("ok");
  });
});

describe("checkIgnored", () => {
  it("is critical when the database is not ignored", () => {
    const f = checkIgnored(".env\nout/\n");
    expect(f.level).toBe("critical");
    expect(f.detail).toContain("data/");
  });
});

describe("checkDbPermissions", () => {
  it("warns when the database is readable by others", () => {
    expect(checkDbPermissions(0o100644).level).toBe("warning");
  });

  it("passes at 600", () => {
    expect(checkDbPermissions(0o100600).level).toBe("ok");
  });

  it("says nothing before the database exists", () => {
    expect(checkDbPermissions(null).level).toBe("ok");
  });
});
