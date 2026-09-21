import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStageTimer,
  shouldLogTiming,
  timingLogLine,
  type TimingReport,
} from "../src/core/observability.ts";
import { registrarTempo } from "../app/timeout-watch.ts";

/** Um relógio que só anda quando o teste manda. */
function clock() {
  let at = 1_000;
  return { now: () => at, advance: (ms: number) => { at += ms; } };
}

describe("cronômetro de estágios", () => {
  it("mede cada estágio e o total, e devolve o resultado do trabalho", async () => {
    const time = clock();
    const timer = createStageTimer(time.now);

    const value = await timer.time("prelude", async () => { time.advance(40); return "ok"; });
    await timer.time("board", async () => { time.advance(120.44); });

    expect(value).toBe("ok");
    expect(timer.report("/jobs")).toEqual({
      route: "/jobs",
      totalMs: 160.4,
      stages: [{ stage: "prelude", ms: 40 }, { stage: "board", ms: 120.4 }],
    });
  });

  it("um estágio que falha ainda é medido — é o que interessa — e o erro segue adiante", async () => {
    const time = clock();
    const timer = createStageTimer(time.now);

    await expect(timer.time("facets", async () => { time.advance(900); throw new Error("banco caiu"); }))
      .rejects.toThrow("banco caiu");

    expect(timer.report("/jobs").stages).toEqual([{ stage: "facets", ms: 900 }]);
  });

  it("nunca leva a query string da rota para o relatório", () => {
    const timer = createStageTimer(clock().now);
    expect(timer.report("/jobs?term=java&pay=9000#x").route).toBe("/jobs");
  });
});

describe("linha de log de tempo", () => {
  const report: TimingReport = { route: "/jobs", totalMs: 812.3, stages: [{ stage: "prelude", ms: 34 }, { stage: "board", ms: 120.5 }] };

  it("é uma linha JSON só com número, nome de estágio e região", () => {
    const line = timingLogLine(report, "gru1");
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({ perf: "/jobs", totalMs: 812.3, region: "gru1", stages: { prelude: 34, board: 120.5 } });
  });

  it("omite a região quando ela não é conhecida (desenvolvimento local)", () => {
    expect(JSON.parse(timingLogLine(report))).not.toHaveProperty("region");
  });

  it("só sai quando é lenta ou quando pedida", () => {
    expect(shouldLogTiming(report, { slowMs: 1000, always: false })).toBe(false);
    expect(shouldLogTiming({ ...report, totalMs: 1000 }, { slowMs: 1000, always: false })).toBe(true);
    expect(shouldLogTiming(report, { slowMs: 1000, always: true })).toBe(true);
  });
});

describe("registrarTempo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const slow: TimingReport = { route: "/jobs", totalMs: 1500, stages: [{ stage: "board", ms: 1400 }] };

  it("registra a leitura lenta com a região da função", () => {
    vi.stubEnv("VERCEL_REGION", "gru1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    registrarTempo(slow);

    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0]![0]))).toMatchObject({ perf: "/jobs", region: "gru1" });
  });

  it("fica quieta quando a leitura é rápida", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    registrarTempo({ ...slow, totalMs: 200 });
    expect(info).not.toHaveBeenCalled();
  });

  it("JHO_PERF_LOG=1 registra até a leitura rápida", () => {
    vi.stubEnv("JHO_PERF_LOG", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    registrarTempo({ ...slow, totalMs: 200 });
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("se o log estoura, a tela não percebe", () => {
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("stdout fechado"); });
    expect(() => registrarTempo(slow)).not.toThrow();
  });
});
