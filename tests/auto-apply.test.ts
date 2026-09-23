import { describe, expect, it } from "vitest";
import {
  AUTO_APPLY_CONTROL_MS,
  AUTO_APPLY_MIN_CHARS,
  AUTO_APPLY_TEXT_MS,
  createAutoSubmitter,
  sameDestination,
  textReady,
} from "../app/auto-apply.ts";

describe("textReady", () => {
  it("pede a lista a partir de três caracteres", () => {
    expect(AUTO_APPLY_MIN_CHARS).toBe(3);
    expect(textReady("re", "")).toBe(false);
    expect(textReady("rea", "")).toBe(true);
    expect(textReady("  re  ", "")).toBe(false);
  });

  it("não pede o que a URL já aplica, nem com espaço em volta", () => {
    expect(textReady("react", "react")).toBe(false);
    expect(textReady(" react ", "react")).toBe(false);
  });

  it("apagar tudo tira o filtro; apagar o que já está vazio não pede nada", () => {
    expect(textReady("", "react")).toBe(true);
    expect(textReady("   ", "react")).toBe(true);
    expect(textReady("", "")).toBe(false);
  });

  it("encurtar para menos de três espera, e o mínimo é configurável", () => {
    expect(textReady("re", "react")).toBe(false);
    expect(textReady("hp", "", 2)).toBe(true);
  });

  it("dá mais tempo ao texto que ao gesto", () => {
    expect(AUTO_APPLY_TEXT_MS).toBeGreaterThan(AUTO_APPLY_CONTROL_MS);
  });
});

describe("sameDestination", () => {
  const base = "http://127.0.0.1:3000";

  it("ignora a ordem dos parâmetros", () => {
    expect(sameDestination(`${base}/jobs?q=react&fit=60`, `${base}/jobs?fit=60&q=react`)).toBe(true);
  });

  it("distingue valor, rota, origem e parâmetro repetido", () => {
    expect(sameDestination(`${base}/jobs?fit=60`, `${base}/jobs?fit=61`)).toBe(false);
    expect(sameDestination(`${base}/jobs?fit=60`, `${base}/?fit=60`)).toBe(false);
    expect(sameDestination(`${base}/jobs`, "http://localhost:3000/jobs")).toBe(false);
    expect(sameDestination(`${base}/jobs?source=a`, `${base}/jobs?source=a&source=b`)).toBe(false);
    expect(sameDestination(`${base}/jobs?fit=`, `${base}/jobs`)).toBe(false);
  });

  it("URL inválida nunca é a mesma", () => {
    expect(sameDestination("não é url", `${base}/jobs`)).toBe(false);
  });
});

function harness() {
  let now = 0;
  const timers: { at: number; callback: () => void; id: number }[] = [];
  let nextId = 0;
  let busy = false;
  const listeners = new Set<() => void>();
  const submits: number[] = [];
  const submitter = createAutoSubmitter({
    setTimer: (callback, delay) => {
      const id = nextId++;
      timers.push({ at: now + delay, callback, id });
      return id;
    },
    clearTimer: (id) => {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    busy: () => busy,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    submit: () => submits.push(now),
  });
  return {
    submitter,
    submits,
    listeners,
    advance(ms: number) {
      now += ms;
      for (const timer of timers.filter((t) => t.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      }
    },
    setBusy(value: boolean) {
      busy = value;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe("createAutoSubmitter", () => {
  it("junta pedidos seguidos em um envio, no fim do último intervalo", () => {
    const h = harness();
    h.submitter.schedule(300);
    h.advance(200);
    h.submitter.schedule(300);
    h.advance(200);
    expect(h.submits).toEqual([]);
    expect(h.submitter.pending()).toBe(true);
    h.advance(100);
    expect(h.submits).toEqual([500]);
    expect(h.submitter.pending()).toBe(false);
  });

  it("cancelar esquece o pedido: o envio manual já levou o valor", () => {
    const h = harness();
    h.submitter.schedule(300);
    h.submitter.cancel();
    h.advance(1000);
    expect(h.submits).toEqual([]);
    expect(h.submitter.pending()).toBe(false);
  });

  it("espera a navegação anterior confirmar a URL antes de enviar", () => {
    const h = harness();
    h.setBusy(true);
    h.submitter.schedule(300);
    h.advance(300);
    expect(h.submits).toEqual([]);
    expect(h.submitter.pending()).toBe(true);
    h.advance(500);
    h.setBusy(true);
    expect(h.submits).toEqual([]);
    h.setBusy(false);
    // O envio sai depois do commit que liberou a espera, não dentro dele.
    expect(h.submits).toEqual([]);
    expect(h.submitter.pending()).toBe(true);
    expect(h.listeners.size).toBe(0);
    h.advance(0);
    expect(h.submits).toEqual([800]);
    h.setBusy(false);
    h.advance(0);
    expect(h.submits).toEqual([800]);
  });

  it("se outra navegação começa no intervalo zero, volta a esperar", () => {
    const h = harness();
    h.setBusy(true);
    h.submitter.schedule(300);
    h.advance(300);
    h.setBusy(false);
    h.setBusy(true);
    h.advance(0);
    expect(h.submits).toEqual([]);
    expect(h.listeners.size).toBe(1);
    h.setBusy(false);
    h.advance(0);
    expect(h.submits).toEqual([300]);
  });

  it("pedido novo durante a espera substitui o antigo: o último vence, uma vez", () => {
    const h = harness();
    h.setBusy(true);
    h.submitter.schedule(300);
    h.advance(300);
    h.submitter.schedule(400);
    expect(h.listeners.size).toBe(0);
    h.advance(400);
    expect(h.listeners.size).toBe(1);
    h.setBusy(false);
    h.advance(0);
    expect(h.submits).toEqual([700]);
  });

  it("descartar a ilha não deixa envio órfão", () => {
    const h = harness();
    h.setBusy(true);
    h.submitter.schedule(300);
    h.advance(300);
    h.submitter.dispose();
    h.setBusy(false);
    h.advance(1000);
    expect(h.submits).toEqual([]);
  });
});
