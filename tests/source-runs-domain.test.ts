/**
 * Domínio das execuções de captura e verificação (#223, tarefa 02).
 *
 * UT-005 idempotência e recusa · UT-006 transições e contagem desconhecida ·
 * UT-007 lease · UT-008 limitador · UT-012 redação. Puro: sem banco, sem rede,
 * sem relógio — o instante entra como argumento.
 */
import { describe, expect, it } from "vitest";
import {
  catalogRevision,
  composeParentStatus,
  createRunLimiter,
  ERROR_DETAIL_MAX,
  EVIDENCE_MAX,
  isRetryable,
  isStale,
  isTerminal,
  nextRunStatus,
  redactDetail,
  refuseRun,
  RUN_STATUSES,
  runKey,
  shouldRedispatch,
  sumCounts,
  UNKNOWN_COUNTS,
  type RunEvent,
  type RunStatus,
} from "../src/contexts/operations/domain/runs.ts";

const fonte = { id: "greenhouse:acme", enabled: true, retiredAt: null, revision: 3 };

describe("UT-005 chave de idempotência e recusa", () => {
  it("é estável para o mesmo escopo e revisão, e muda com a revisão", () => {
    const scope = { kind: "source" as const, sourceId: "greenhouse:acme" };
    expect(runKey(scope, 3)).toBe(runKey({ ...scope }, 3));
    expect(runKey(scope, 3)).not.toBe(runKey(scope, 4));
    expect(runKey(scope, 3)).not.toBe(runKey({ kind: "source", sourceId: "lever:acme" }, 3));
  });

  it("separa escopos: fonte, filha de todas, todas e verificação", () => {
    const keys = [
      runKey({ kind: "source", sourceId: "greenhouse:acme" }, 1),
      runKey({ kind: "source", sourceId: "greenhouse:acme", parentId: 9 }, 1),
      runKey({ kind: "all" }, 1),
      runKey({ kind: "verify", sourceId: "greenhouse:acme" }, 1),
      runKey({ kind: "verify", sourceId: null }, 1),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a revisão do catálogo é o conjunto (fonte, revisão), estável à ordem", () => {
    const a = catalogRevision([{ id: "a", revision: 1 }, { id: "b", revision: 5 }]);
    expect(catalogRevision([{ id: "b", revision: 5 }, { id: "a", revision: 1 }])).toBe(a);
    // Editar a fonte de revisão MENOR também muda o pedido — a maior revisão sozinha não mudaria.
    expect(catalogRevision([{ id: "a", revision: 2 }, { id: "b", revision: 5 }])).not.toBe(a);
    expect(catalogRevision([{ id: "a", revision: 1 }])).not.toBe(a);
  });

  it("fonte desabilitada, aposentada ou fora do catálogo não gera execução", () => {
    expect(refuseRun(fonte)).toBeNull();
    expect(refuseRun({ ...fonte, enabled: false })).toBe("source_disabled");
    expect(refuseRun({ ...fonte, retiredAt: "2026-09-23T00:00:00.000Z" })).toBe("source_retired");
    // Aposentada também está desabilitada; o motivo mais forte vence.
    expect(refuseRun({ ...fonte, enabled: false, retiredAt: "2026-09-23T00:00:00.000Z" })).toBe("source_retired");
    expect(refuseRun(null)).toBe("source_not_found");
  });
});

describe("UT-006 transições, composição e contagem desconhecida", () => {
  const eventos: RunEvent[] = [
    { type: "start" },
    { type: "succeed" },
    { type: "partial" },
    { type: "fail" },
    { type: "cancel" },
    { type: "interrupt" },
  ];

  it("recusa sair de qualquer estado terminal, com qualquer evento", () => {
    for (const status of RUN_STATUSES.filter(isTerminal)) {
      for (const evento of eventos) expect(nextRunStatus(status, evento), `${status}/${evento.type}`).toBeNull();
    }
  });

  it("segue o ciclo queued → running → terminal", () => {
    expect(nextRunStatus("queued", { type: "start" })).toBe("running");
    expect(nextRunStatus("running", { type: "start" })).toBeNull();
    expect(nextRunStatus("running", { type: "succeed" })).toBe("succeeded");
    expect(nextRunStatus("running", { type: "partial" })).toBe("partial");
    expect(nextRunStatus("queued", { type: "succeed" })).toBeNull();
    // Despacho recusado falha sem ter começado; cancelar vale nos dois ativos.
    expect(nextRunStatus("queued", { type: "fail" })).toBe("failed");
    expect(nextRunStatus("queued", { type: "cancel" })).toBe("cancelled");
    expect(nextRunStatus("running", { type: "interrupt" })).toBe("interrupted");
    expect(nextRunStatus("queued", { type: "interrupt" })).toBeNull();
  });

  it("uma filha falha → pai partial, sem esconder as que deram certo", () => {
    expect(composeParentStatus(["succeeded", "failed", "succeeded"])).toBe("partial");
    expect(composeParentStatus(["succeeded", "succeeded"])).toBe("succeeded");
    expect(composeParentStatus(["failed", "failed"])).toBe("failed");
    expect(composeParentStatus(["failed", "interrupted"])).toBe("partial");
    expect(composeParentStatus(["succeeded", "running"])).toBe("running");
    expect(composeParentStatus([])).toBe("succeeded");
  });

  it("contagem nula continua desconhecida no pai, nunca vira zero", () => {
    const conhecida = { ...UNKNOWN_COUNTS, fetched: 10, inserted: 2, closed: 0 };
    expect(sumCounts([conhecida, { ...conhecida, fetched: 5 }])).toMatchObject({ fetched: 15, inserted: 4, closed: 0, alive: null });
    expect(sumCounts([conhecida, UNKNOWN_COUNTS])).toEqual(UNKNOWN_COUNTS);
    expect(sumCounts([])).toEqual(UNKNOWN_COUNTS);
  });

  it("só o que terminou sem sucesso aceita nova tentativa", () => {
    const aceita = RUN_STATUSES.filter((s: RunStatus) => isRetryable(s));
    expect(aceita.sort()).toEqual(["cancelled", "failed", "interrupted", "partial"]);
  });
});

describe("UT-007 lease e interrupção", () => {
  const agora = "2026-09-23T12:00:00.000Z";
  const lease = 15 * 60_000;

  it("marca running sem batimento além do lease", () => {
    expect(isStale({ status: "running", heartbeatAt: "2026-09-23T11:40:00.000Z" }, agora, lease)).toBe(true);
    expect(isStale({ status: "running", heartbeatAt: "2026-09-23T11:50:00.000Z" }, agora, lease)).toBe(false);
    // Batimento ausente (lido como vazio) é sem prova de vida.
    expect(isStale({ status: "running", heartbeatAt: "" }, agora, lease)).toBe(true);
  });

  it("nunca marca execução terminal nem queued", () => {
    for (const status of RUN_STATUSES.filter((s) => s !== "running")) {
      expect(isStale({ status, heartbeatAt: "2000-01-01T00:00:00.000Z" }, agora, lease), status).toBe(false);
    }
  });
});

describe("UT-008 limitador com reserva síncrona", () => {
  it("N pedidos simultâneos respeitam o teto; os excedentes esperam", async () => {
    const limiter = createRunLimiter(2);
    let emVoo = 0;
    let pico = 0;
    const esperaram: number[] = [];

    await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        // Reserva no mesmo tique da conferência: nenhum `await` entre as duas.
        while (!limiter.tryAcquire()) {
          esperaram.push(i);
          await new Promise((r) => setTimeout(r, 1));
        }
        emVoo++;
        pico = Math.max(pico, emVoo);
        await new Promise((r) => setTimeout(r, 5));
        emVoo--;
        limiter.release();
      }),
    );

    expect(pico).toBe(2);
    expect(new Set(esperaram).size).toBe(4);
    expect(limiter.inUse()).toBe(0);
  });

  it("soltar sem ter reservado não cria vaga fantasma", () => {
    const limiter = createRunLimiter(1);
    limiter.release();
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });
});

describe("UT-012 redação e limite de erro e evidência", () => {
  it("tira query string, fragmento, e-mail e telefone", () => {
    const texto =
      "GET https://boards.example.com/api/jobs?token=abc123&q=segredo#frag falhou; " +
      "contato ana.souza@empresa.com.br ou +55 (11) 98765-4321";
    const limpo = redactDetail(texto, ERROR_DETAIL_MAX);
    expect(limpo).toContain("https://boards.example.com/api/jobs");
    expect(limpo).not.toMatch(/token|abc123|segredo|frag/);
    expect(limpo).not.toContain("ana.souza");
    expect(limpo).not.toContain("98765");
  });

  it("mantém data, porta e código HTTP, que não são telefone", () => {
    const limpo = redactDetail("HTTP 503 em 2026-09-23 na porta 8443", ERROR_DETAIL_MAX);
    expect(limpo).toBe("HTTP 503 em 2026-09-23 na porta 8443");
  });

  it("limita o tamanho do detalhe e da evidência", () => {
    const longo = "x ".repeat(2_000);
    expect(redactDetail(longo, ERROR_DETAIL_MAX).length).toBeLessThanOrEqual(ERROR_DETAIL_MAX);
    expect(redactDetail(longo, EVIDENCE_MAX).length).toBeLessThanOrEqual(EVIDENCE_MAX);
    expect(ERROR_DETAIL_MAX).toBe(500);
    expect(EVIDENCE_MAX).toBe(280);
  });

  it("credencial reconhecível também sai", () => {
    expect(redactDetail("Authorization: Bearer ghp_abcdefghijklmnop", ERROR_DETAIL_MAX)).not.toContain("ghp_abcdefghijklmnop");
  });
});

describe("UT-005 execução enfileirada sem executor é despachada de novo", () => {
  const agora = "2026-09-23T12:00:00.000Z";
  it("sem credencial ou despacho que falhou: sempre", () => {
    expect(shouldRedispatch({ status: "queued", errorCode: "no_token", queuedAt: agora }, agora)).toBe(true);
    expect(shouldRedispatch({ status: "queued", errorCode: "dispatch_failed", queuedAt: agora }, agora)).toBe(true);
  });

  it("pendente há mais de 30 min, ou com instante ilegível: sim; recente: não", () => {
    expect(shouldRedispatch({ status: "queued", errorCode: null, queuedAt: "2026-09-23T11:20:00.000Z" }, agora)).toBe(true);
    expect(shouldRedispatch({ status: "queued", errorCode: null, queuedAt: "2026-09-23T11:50:00.000Z" }, agora)).toBe(false);
    expect(shouldRedispatch({ status: "queued", errorCode: null, queuedAt: "ontem" }, agora)).toBe(true);
  });

  it("execução rodando ou terminada nunca é despachada de novo", () => {
    for (const status of RUN_STATUSES.filter((s) => s !== "queued")) {
      expect(shouldRedispatch({ status, errorCode: "no_token", queuedAt: "2000-01-01T00:00:00.000Z" }, agora), status).toBe(false);
    }
  });
});
