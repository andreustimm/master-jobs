/**
 * Suíte: as regras puras da sugestão de vaga e da área do recrutador (#465,
 * task_04; `_tests.md` UT-050 – UT-059).
 *
 * Fronteira DENTRO: `src/contexts/pursuit/domain/recruiter-suggestion.ts` e
 * `recruiter-view.ts`, com o instante explícito. Fronteira FORA: nada — sem
 * banco, rede nem relógio.
 */
import { describe, expect, it } from "vitest";
import {
  NOTE_MAX,
  decideAccept,
  decideSuggest,
  digestDue,
  validateNote,
  type SuggestionStatus,
} from "../src/contexts/pursuit/domain/recruiter-suggestion.ts";
import { candidateLabel, cvFileName, pageWithin, parseCandidateSelector } from "../src/contexts/pursuit/domain/recruiter-view.ts";

const T0 = Date.parse("2026-10-06T12:00:00.000Z");
const OPEN = { closedAt: null, archivedAt: null };
const CAP_OK = { ok: true } as const;
const RETRY = "2026-10-07T09:00:00.000Z";

describe("nota da sugestão", () => {
  it("UT-050 vazia vira null, 500 caracteres ficam, 501 recusa, espaços nas pontas saem", () => {
    expect(validateNote("")).toEqual({ ok: true, value: null });
    expect(validateNote("   ")).toEqual({ ok: true, value: null });
    const limit = "a".repeat(NOTE_MAX);
    expect(validateNote(limit)).toEqual({ ok: true, value: limit });
    expect(validateNote(`${limit}a`)).toEqual({ ok: false, error: "note_too_long" });
    expect(validateNote("  hi  ")).toEqual({ ok: true, value: "hi" });
    // Por ponto de código, como o `char_length` do CHECK: 500 emojis cabem.
    expect(validateNote("🙂".repeat(NOTE_MAX)).ok).toBe(true);
  });

  it("UT-051 marcação e link passam intactos; a tela é que os mostra como texto", () => {
    const html = '<a href="x">job</a>';
    expect(validateNote(html)).toEqual({ ok: true, value: html });
  });
});

describe("decideSuggest", () => {
  const base = { job: OPEN, mine: null, pendingSuggestionId: null, cap: CAP_OK } as const;

  it.each([
    ["closedAt", { closedAt: "2026-10-01T00:00:00.000Z", archivedAt: null }],
    ["archivedAt", { closedAt: null, archivedAt: "2026-10-01T00:00:00.000Z" }],
  ])("UT-052 vaga com %s recusa com job_closed", (_label, job) => {
    expect(decideSuggest({ ...base, job })).toEqual({ kind: "refuse", error: "job_closed" });
  });

  it("UT-053 a minha ainda pendente recusa com already_suggested", () => {
    expect(decideSuggest({ ...base, mine: "pending" })).toEqual({ kind: "refuse", error: "already_suggested" });
  });

  it.each<SuggestionStatus>(["declined", "accepted"])("UT-054 a minha já %s recusa com already_decided_by_candidate", (mine) => {
    expect(decideSuggest({ ...base, mine })).toEqual({ kind: "refuse", error: "already_decided_by_candidate" });
  });

  it("UT-055 pendente de outro recrutador: junta-se a ela", () => {
    expect(decideSuggest({ ...base, pendingSuggestionId: 42 })).toEqual({ kind: "join", suggestionId: 42 });
  });

  it("UT-056 sem nada pendente e dentro do limite: cria", () => {
    expect(decideSuggest(base)).toEqual({ kind: "create" });
  });

  it("UT-057 limite cheio recusa com retryAt; com a vaga também fechada, job_closed vence", () => {
    const full = { ok: false, retryAt: RETRY } as const;
    expect(decideSuggest({ ...base, cap: full })).toEqual({ kind: "refuse", error: "cap_reached", retryAt: RETRY });
    expect(decideSuggest({ ...base, cap: full, job: { closedAt: "2026-10-01T00:00:00.000Z", archivedAt: null } })).toEqual({
      kind: "refuse",
      error: "job_closed",
    });
  });
});

describe("decideAccept", () => {
  it("UT-058 pendente sem candidatura insere; pendente com candidatura só marca; decidida não muda", () => {
    expect(decideAccept({ status: "pending", applicationExists: false })).toBe("insert_backlog");
    expect(decideAccept({ status: "pending", applicationExists: true })).toBe("mark_only");
    for (const status of ["accepted", "declined"] as const) {
      for (const applicationExists of [true, false]) {
        expect(decideAccept({ status, applicationExists })).toBe("already_decided");
      }
    }
  });
});

describe("digestDue", () => {
  it("UT-059 sem aviso anterior, sim; 59 min depois, não; 60 min depois, sim", () => {
    expect(digestDue(null, T0)).toBe(true);
    expect(digestDue(new Date(T0 - 59 * 60_000).toISOString(), T0)).toBe(false);
    expect(digestDue(new Date(T0 - 60 * 60_000).toISOString(), T0)).toBe(true);
    // Instante ilegível não trava o aviso para sempre.
    expect(digestDue("não é data", T0)).toBe(true);
  });
});

describe("área do recrutador", () => {
  it("página fora do intervalo cai na primeira ou na última (US-014.EC-2)", () => {
    expect(pageWithin("abc", 1000, 20)).toBe(1);
    expect(pageWithin(undefined, 1000, 20)).toBe(1);
    expect(pageWithin("0", 1000, 20)).toBe(1);
    expect(pageWithin("999", 1000, 20)).toBe(50);
    expect(pageWithin("3", 1000, 20)).toBe(3);
    expect(pageWithin(["2", "9"], 1000, 20)).toBe(2);
    expect(pageWithin("5", 0, 20)).toBe(1);
  });

  it("id de candidato só com dígitos; o resto é o mesmo 404 (US-016.EC-1)", () => {
    expect(parseCandidateSelector("7")).toBe(7);
    for (const raw of ["abc", "-1", "1.5", "1e3", "0", "", " 7", null, 7]) {
      expect(parseCandidateSelector(raw), String(raw)).toBeNull();
    }
  });

  it("rótulo de quem não tem nome usa a headline, e nunca outra coisa (US-013.EC-2)", () => {
    expect(candidateLabel("Ana", "Backend")).toEqual({ named: true, name: "Ana" });
    expect(candidateLabel("  ", "Backend")).toEqual({ named: false, headline: "Backend" });
    expect(candidateLabel("", null)).toEqual({ named: false, headline: null });
  });

  it("nome do arquivo do currículo com o nome da pessoa, sem acento e sem id (US-015.EC-6)", () => {
    expect(cvFileName("Ana Silva")).toBe("ana-silva-cv.md");
    expect(cvFileName("Ana E2E")).toBe("ana-e2e-cv.md");
    expect(cvFileName("José Ção")).toBe("jose-cao-cv.md");
    expect(cvFileName("<b>Zé</b>")).toBe("b-ze-b-cv.md");
    expect(cvFileName("   ")).toBe("cv.md");
  });
});
