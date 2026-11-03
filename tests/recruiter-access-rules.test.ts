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
  candidateDisplayName,
  INVITE_STATUSES,
  capDecision,
  endDateEventDetail,
  grantDisplay,
  grantTarget,
  inviteCompletion,
  maskEmail,
  normalizeEmail,
  parseEndDate,
  readEndDateEventDetail,
  inviteCookieMaxAge,
  inviteLanding,
  inviteNoticeOf,
  invitePageState,
  inviteTokenOf,
  type InviteLookup,
  type InviteStatus,
} from "../src/contexts/auth/domain/recruiter-access.ts";
import { formatDate } from "../src/core/i18n/index.ts";

const T0 = Date.parse("2026-10-06T12:00:00Z");
const SP = "America/Sao_Paulo";

describe("chegada pelo convite (task_03, ADR-018)", () => {
  const live: InviteLookup = {
    id: 1,
    candidateId: 7,
    candidateName: "Ana",
    email: "bia@y.com",
    status: "pending",
    expiresAt: "2026-10-13T12:00:00.000Z",
    accessExpiresAt: null,
    acceptedUserId: null,
    candidateEnabled: true,
  };
  const bia = { userId: 30, email: "bia@y.com", roles: ["recruiter"] };

  it("token: só texto de 1 a 128 caracteres vai ao banco", () => {
    expect(inviteTokenOf(" abc ")).toBe("abc");
    expect(inviteTokenOf("")).toBeNull();
    expect(inviteTokenOf("x".repeat(129))).toBeNull();
    expect(inviteTokenOf(["a"])).toBeNull();
    expect(inviteTokenOf(undefined)).toBeNull();
  });

  it("o cookie vive o que falta do link, nunca mais; link vencido dá zero", () => {
    expect(inviteCookieMaxAge("2026-10-13T12:00:00.000Z", T0)).toBe(7 * 86_400);
    expect(inviteCookieMaxAge("2026-10-06T12:00:00.500Z", T0)).toBe(0);
    expect(inviteCookieMaxAge("2026-10-06T11:00:00.000Z", T0)).toBe(0);
    expect(inviteCookieMaxAge("ontem", T0)).toBe(0);
  });

  it.each([
    ["desconhecido", null, null, "neutral"],
    ["aceito", { ...live, status: "accepted" as InviteStatus }, null, "neutral"],
    ["substituído", { ...live, status: "superseded" as InviteStatus }, null, "neutral"],
    ["cancelado", { ...live, status: "cancelled" as InviteStatus }, null, "neutral"],
    ["vencido", { ...live, expiresAt: "2026-10-06T12:00:00.000Z" }, null, "neutral"],
    ["de candidato desabilitado", { ...live, candidateEnabled: false }, null, "neutral"],
    ["válido sem sessão", live, null, "anonymous"],
    ["válido com o e-mail e o papel", live, bia, "accept"],
    ["válido com outro e-mail", live, { ...bia, email: "carla@z.com" }, "other_email"],
    ["válido com o e-mail sem o papel", live, { ...bia, roles: ["candidate"] }, "needs_recruiter"],
    ["aceito por esta conta", { ...live, status: "accepted" as InviteStatus, acceptedUserId: 30 }, bia, "open"],
    ["aceito por outra conta", { ...live, status: "accepted" as InviteStatus, acceptedUserId: 31 }, bia, "neutral"],
  ])("página do convite %s → %s", (_label, invite, session, kind) => {
    expect(invitePageState({ invite, session, now: T0 }).kind).toBe(kind);
  });

  it("a página mascara o endereço; com outro e-mail, nada do candidato", () => {
    expect(invitePageState({ invite: live, session: null, now: T0 })).toEqual({
      kind: "anonymous",
      candidateName: "Ana",
      maskedEmail: "b•••@y.com",
    });
    expect(invitePageState({ invite: live, session: { ...bia, email: "carla@z.com" }, now: T0 })).toEqual({
      kind: "other_email",
      maskedEmail: "b•••@y.com",
    });
    expect(invitePageState({ invite: live, session: { ...bia, email: " Bia@Y.com " }, now: T0 }).kind).toBe("accept");
  });

  it("destino: candidato quando concluiu, aviso nos outros desfechos, o de sempre sem cookie", () => {
    expect(inviteLanding("completed", 7, "/recruiter")).toBe("/recruiter/7");
    expect(inviteLanding("mismatch", null, "/recruiter")).toBe("/recruiter?invite=mismatch");
    expect(inviteLanding("not_recruiter", null, "/jobs")).toBe("/recruiter?invite=not_recruiter");
    expect(inviteLanding("period_over", null, "/")).toBe("/recruiter?invite=period_over");
    expect(inviteLanding("invalid", null, "/")).toBe("/recruiter?invite=invalid");
    expect(inviteLanding("completed", null, "/")).toBe("/recruiter?invite=invalid");
    expect(inviteLanding(null, null, "/jobs/3")).toBe("/jobs/3");
  });

  it("o aviso da URL só vale da lista", () => {
    expect(inviteNoticeOf("mismatch")).toBe("mismatch");
    expect(inviteNoticeOf("period_over")).toBe("period_over");
    expect(inviteNoticeOf("completed")).toBeNull();
    expect(inviteNoticeOf(["mismatch"])).toBeNull();
    expect(inviteNoticeOf(undefined)).toBeNull();
  });
});

describe("detalhe da data de fim no histórico", () => {
  it("grava instante e fuso; lê os dois de volta", () => {
    const end = parseEndDate({ date: "2026-10-20", tz: SP, now: T0 });
    if (!end.ok) throw new Error("data recusada");
    const detail = endDateEventDetail(end.value.expiresAt, end.value.tz);
    expect(detail).toBe("2026-10-21T02:59:59.999Z America/Sao_Paulo");
    expect(readEndDateEventDetail(detail)).toEqual({ expiresAt: "2026-10-21T02:59:59.999Z", tz: SP });
  });

  it("o dia lido no fuso gravado é o escolhido (20), não o do servidor em UTC (21)", () => {
    const read = readEndDateEventDetail("2026-11-21T02:59:59.999Z America/Sao_Paulo")!;
    expect(formatDate(read.expiresAt, "pt-BR", read.tz)).toBe(formatDate("2026-11-20T12:00:00Z", "pt-BR", "UTC"));
    expect(formatDate(read.expiresAt, "pt-BR", "UTC")).toBe(formatDate("2026-11-21T12:00:00Z", "pt-BR", "UTC"));
  });

  it("sem data é `none`; linha antiga sem fuso e fuso desconhecido caem em UTC", () => {
    expect(endDateEventDetail(null, null)).toBe("none");
    expect(endDateEventDetail("2026-10-21T02:59:59.999Z", null)).toBe("2026-10-21T02:59:59.999Z");
    expect(readEndDateEventDetail("none")).toBeNull();
    expect(readEndDateEventDetail(null)).toBeNull();
    expect(readEndDateEventDetail("")).toBeNull();
    expect(readEndDateEventDetail("2026-10-21T02:59:59.999Z")).toEqual({ expiresAt: "2026-10-21T02:59:59.999Z", tz: "UTC" });
    expect(readEndDateEventDetail("2026-10-21T02:59:59.999Z Marte/Olimpo")).toEqual({
      expiresAt: "2026-10-21T02:59:59.999Z",
      tz: "UTC",
    });
  });
});

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

  it("candidateDisplayName: nome escolhido ou, vazio, o rótulo neutro de quem chama (M-1, G22)", () => {
    expect(candidateDisplayName("Ana", "Candidato")).toBe("Ana");
    expect(candidateDisplayName("  Ana  ", "Candidato")).toBe("Ana");
    expect(candidateDisplayName("", "Candidato")).toBe("Candidato");
    expect(candidateDisplayName("   ", "Candidate")).toBe("Candidate");
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
