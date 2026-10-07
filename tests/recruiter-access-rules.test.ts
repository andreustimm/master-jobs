/**
 * Suíte: regras puras do acesso de recrutador (#465, `_tests.md` UT-001 – UT-034).
 *
 * Fronteira DENTRO: `src/contexts/auth/domain/recruiter-access.ts` inteiro.
 * Fronteira FORA: nada — sem banco, rede nem relógio; o instante entra como
 * `now` (T0 = 2026-10-06T12:00:00Z). O DDL da 0036 só é lido como texto, para
 * as listas do domínio não divergirem dos CHECKs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCESS_ACTORS,
  ACCESS_EVENT_KINDS,
  CAP_WINDOW_MS,
  GRANT_STATUSES,
  INVITE_STATUSES,
  capDecision,
  grantDisplay,
  grantTarget,
  inviteCompletion,
  maskEmail,
  normalizeEmail,
  parseEndDate,
  type InviteStatus,
} from "../src/contexts/auth/domain/recruiter-access.ts";

const T0 = Date.parse("2026-10-06T12:00:00Z");
const SP = "America/Sao_Paulo";

describe("normalizeEmail", () => {
  it("UT-001 tira espaço das pontas e põe em minúsculas", () => {
    expect(normalizeEmail("  Ana@X.COM ")).toEqual({ ok: true, value: "ana@x.com" });
  });

  it.each(["", "   "])("UT-002 vazio (%j) é blank_email", (raw) => {
    expect(normalizeEmail(raw)).toEqual({ ok: false, error: "blank_email" });
  });

  it("UT-003 sem @ é invalid_email", () => {
    expect(normalizeEmail("ana.x.com")).toEqual({ ok: false, error: "invalid_email" });
  });

  it("UT-004 espaço no meio é invalid_email", () => {
    expect(normalizeEmail("ana silva@x.com")).toEqual({ ok: false, error: "invalid_email" });
  });

  it("UT-005 254 caracteres passa; 255 é invalid_email", () => {
    const at254 = "a".repeat(242) + "@example.com";
    expect(at254).toHaveLength(254);
    expect(normalizeEmail(at254)).toEqual({ ok: true, value: at254 });
    expect(normalizeEmail("a" + at254)).toEqual({ ok: false, error: "invalid_email" });
  });

  it("UT-006 não reescreve ponto nem + do provedor", () => {
    const plus = normalizeEmail("A.B+x@Gmail.com");
    expect(plus).toEqual({ ok: true, value: "a.b+x@gmail.com" });
    expect(normalizeEmail("ab@gmail.com")).not.toEqual(plus);
  });

  it("recusa domínio sem ponto e quebra de linha", () => {
    expect(normalizeEmail("ana@localhost")).toEqual({ ok: false, error: "invalid_email" });
    expect(normalizeEmail("ana@x.com\nBcc: y@z.com")).toEqual({ ok: false, error: "invalid_email" });
  });
});

describe("parseEndDate", () => {
  it("UT-007 vazio é sem fim, com o fuso guardado", () => {
    expect(parseEndDate({ date: "", tz: SP, now: T0 })).toEqual({ ok: true, value: { expiresAt: null, tz: SP } });
  });

  it("UT-008 fim do dia escolhido no fuso de São Paulo", () => {
    expect(parseEndDate({ date: "2026-10-20", tz: SP, now: T0 })).toEqual({
      ok: true,
      value: { expiresAt: "2026-10-21T02:59:59.999Z", tz: SP },
    });
  });

  it("UT-009 hoje é date_past", () => {
    expect(parseEndDate({ date: "2026-10-06", tz: SP, now: T0 })).toEqual({ ok: false, error: "date_past" });
  });

  it("UT-010 passado é date_past", () => {
    expect(parseEndDate({ date: "2026-10-01", tz: "UTC", now: T0 })).toEqual({ ok: false, error: "date_past" });
  });

  it("UT-011 'hoje' depende do fuso de quem escolhe", () => {
    const now = Date.parse("2026-10-07T01:30:00Z");
    const local = parseEndDate({ date: "2026-10-07", tz: SP, now });
    expect(local).toEqual({ ok: true, value: { expiresAt: "2026-10-08T02:59:59.999Z", tz: SP } });
    expect(parseEndDate({ date: "2026-10-07", tz: "UTC", now })).toEqual({ ok: false, error: "date_past" });
  });

  it("UT-012 até 5 anos de hoje; um dia depois é date_too_far", () => {
    expect(parseEndDate({ date: "2031-10-06", tz: SP, now: T0 }).ok).toBe(true);
    expect(parseEndDate({ date: "2031-10-07", tz: SP, now: T0 })).toEqual({ ok: false, error: "date_too_far" });
  });

  it.each(["2026-02-30", "20/10/2026", "abc"])("UT-013 %j é date_invalid", (date) => {
    expect(parseEndDate({ date, tz: SP, now: T0 })).toEqual({ ok: false, error: "date_invalid" });
  });

  it.each(["Mars/Base", ""])("UT-014 fuso %j cai para UTC", (tz) => {
    expect(parseEndDate({ date: "2026-10-20", tz, now: T0 })).toEqual({
      ok: true,
      value: { expiresAt: "2026-10-20T23:59:59.999Z", tz: "UTC" },
    });
  });

  it("fuso com horário de verão: o fim do dia cai na meia-noite local do dia seguinte", () => {
    // Nova York em 2026-11-01 sai do horário de verão: o dia tem 25 horas.
    const result = parseEndDate({ date: "2026-11-01", tz: "America/New_York", now: T0 });
    expect(result).toEqual({ ok: true, value: { expiresAt: "2026-11-02T04:59:59.999Z", tz: "America/New_York" } });
    const spring = parseEndDate({ date: "2027-03-14", tz: "America/New_York", now: T0 });
    expect(spring).toEqual({ ok: true, value: { expiresAt: "2027-03-15T03:59:59.999Z", tz: "America/New_York" } });
  });
});

describe("grantTarget", () => {
  const recruiter = { id: 2, roles: ["recruiter"], disabled: false, emailVerified: true };
  const base = { email: "rui@x.com", candidateEmails: ["ana@x.com"] };

  it("UT-015 recrutador habilitado e verificado recebe a concessão", () => {
    expect(grantTarget({ ...base, account: recruiter })).toBe("grant");
  });

  it("UT-016 conta desabilitada vira convite", () => {
    expect(grantTarget({ ...base, account: { ...recruiter, disabled: true } })).toBe("invite");
  });

  it("UT-017 conta sem papel de recrutador vira convite", () => {
    expect(grantTarget({ ...base, account: { ...recruiter, roles: ["candidate"] } })).toBe("invite");
  });

  it("UT-018 e-mail não verificado vira convite", () => {
    expect(grantTarget({ ...base, account: { ...recruiter, emailVerified: false } })).toBe("invite");
  });

  it("UT-019 sem conta vira convite", () => {
    expect(grantTarget({ ...base, account: null })).toBe("invite");
  });

  it("UT-020 o próprio e-mail do candidato é self, mesmo com papel de recrutador", () => {
    expect(grantTarget({ email: "ana@x.com", candidateEmails: [" Ana@X.com "], account: recruiter })).toBe("self");
  });
});

describe("capDecision", () => {
  const hoursAgo = (h: number) => new Date(T0 - h * 3_600_000).toISOString();

  it("UT-021 nove dentro da janela cabem no limite de dez", () => {
    const nine = Array.from({ length: 9 }, (_, i) => hoursAgo(i + 1));
    expect(capDecision(nine, T0, 10, CAP_WINDOW_MS)).toEqual({ ok: true });
  });

  it("UT-022 dez dentro da janela: volta quando o mais antigo sai", () => {
    const ten = ["2026-10-05T14:00:00Z", ...Array.from({ length: 9 }, (_, i) => hoursAgo(i + 1))];
    expect(capDecision(ten, T0, 10, CAP_WINDOW_MS)).toEqual({ ok: false, retryAt: "2026-10-06T14:00:00.000Z" });
  });

  it("UT-023 o registro exatamente 24 h atrás já saiu da janela", () => {
    const edge = [hoursAgo(24), ...Array.from({ length: 9 }, (_, i) => hoursAgo(i + 1))];
    expect(capDecision(edge, T0, 10, CAP_WINDOW_MS)).toEqual({ ok: true });
  });

  it("acima do limite, o retorno é quando a contagem volta a caber", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => hoursAgo(23 - i));
    // Doze dentro: precisa sair três; o terceiro mais antigo tem 21 h.
    expect(capDecision(twelve, T0, 10, CAP_WINDOW_MS)).toEqual({
      ok: false,
      retryAt: new Date(Date.parse(hoursAgo(21)) + CAP_WINDOW_MS).toISOString(),
    });
  });

  it("ignora instante ilegível e futuro", () => {
    expect(capDecision(["lixo", hoursAgo(-1)], T0, 1, CAP_WINDOW_MS)).toEqual({ ok: true });
  });
});

describe("inviteCompletion", () => {
  const invite = {
    status: "pending" as InviteStatus,
    email: "ana@x.com",
    expiresAt: "2026-10-13T12:00:00Z",
    accessExpiresAt: null as string | null,
  };
  const account = { email: "ana@x.com", roles: ["recruiter"], disabled: false, emailVerified: true };
  const input = { invite, candidateEnabled: true, account, now: T0 };

  it("UT-024 convite válido e conta certa completam", () => {
    expect(inviteCompletion(input)).toBe("completed");
  });

  it("UT-025 outro e-mail é mismatch", () => {
    expect(inviteCompletion({ ...input, account: { ...account, email: "bia@y.com" } })).toBe("mismatch");
  });

  it("UT-026 link vencido é invalid", () => {
    expect(inviteCompletion({ ...input, invite: { ...invite, expiresAt: "2026-10-06T12:00:00Z" } })).toBe("invalid");
  });

  it.each(["accepted", "cancelled", "superseded", "expired"] as InviteStatus[])("UT-027 status %s é invalid", (status) => {
    expect(inviteCompletion({ ...input, invite: { ...invite, status } })).toBe("invalid");
  });

  it("UT-028 token desconhecido (convite nulo) é invalid", () => {
    expect(inviteCompletion({ ...input, invite: null })).toBe("invalid");
  });

  it("UT-029 candidato desabilitado é invalid", () => {
    expect(inviteCompletion({ ...input, candidateEnabled: false })).toBe("invalid");
  });

  it("UT-030 prazo escolhido no convite já passou é period_over", () => {
    expect(inviteCompletion({ ...input, invite: { ...invite, accessExpiresAt: "2026-10-06T11:00:00Z" } })).toBe(
      "period_over",
    );
  });

  it("UT-031 mesmo e-mail sem papel de recrutador é not_recruiter", () => {
    expect(inviteCompletion({ ...input, account: { ...account, roles: ["candidate"] } })).toBe("not_recruiter");
  });

  it("UT-032 variação de Gmail é outro endereço", () => {
    expect(
      inviteCompletion({
        ...input,
        invite: { ...invite, email: "ab@gmail.com" },
        account: { ...account, email: "a.b+x@gmail.com" },
      }),
    ).toBe("mismatch");
  });

  it("caixa e espaço não mudam o endereço; e-mail não confirmado não prova nada", () => {
    expect(inviteCompletion({ ...input, account: { ...account, email: " ANA@x.com " } })).toBe("completed");
    expect(inviteCompletion({ ...input, account: { ...account, emailVerified: false } })).toBe("mismatch");
    expect(inviteCompletion({ ...input, account: { ...account, disabled: true } })).toBe("not_recruiter");
    expect(inviteCompletion({ ...input, invite: { ...invite, expiresAt: "lixo" } })).toBe("invalid");
  });
});

describe("exibição e máscara", () => {
  it("UT-033 grantDisplay marca conta desabilitada e papel removido", () => {
    expect(grantDisplay({ disabled: true, roles: ["recruiter"] })).toBe("account_disabled");
    expect(grantDisplay({ disabled: false, roles: ["candidate"] })).toBe("not_recruiter");
    expect(grantDisplay({ disabled: false, roles: ["recruiter"] })).toBe("active");
    expect(grantDisplay(null)).toBe("not_recruiter");
  });

  it("UT-034 maskEmail mostra só a primeira letra e o domínio", () => {
    expect(maskEmail("ana@x.com")).toBe("a•••@x.com");
    expect(maskEmail("a@x.com")).toBe("a•••@x.com");
    expect(maskEmail("sem-arroba")).toBe("•••");
  });
});

describe("listas do domínio repetem o CHECK do banco", () => {
  const ddl = readFileSync("drizzle/postgres/0036_recrutador_acesso.sql", "utf8");
  /** Os literais do `CHECK` nomeado, na ordem do DDL. */
  const checkValues = (name: string) => {
    const clause = new RegExp(`CONSTRAINT "${name}" CHECK \\(.* in \\(([^)]*)\\)\\)`).exec(ddl);
    return [...(clause?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };

  it.each([
    ["recruiter_grant_status_check", GRANT_STATUSES],
    ["recruiter_invite_status_check", INVITE_STATUSES],
    ["recruiter_access_event_kind_check", ACCESS_EVENT_KINDS],
    ["recruiter_access_event_actor_check", ACCESS_ACTORS],
  ] as const)("%s aceita exatamente a lista do domínio", (name, values) => {
    expect(checkValues(name)).toEqual([...values]);
  });
});
