// Suite: lifecycle de atualização da PWA
// Invariant: uma geração nova assume o controle e substitui o documento antigo sem loop de recarga
// Boundary IN: eventos públicos de ServiceWorkerContainer e visibilidade do documento
// Boundary OUT: navegador real, coberto pelo gate PWA em Chromium
import { describe, expect, it, vi } from "vitest";
import {
  startServiceWorkerUpdateLifecycle,
  type VisibilityPort,
  type WorkerContainerPort,
  type WorkerRegistrationPort,
} from "../src/core/pwa/service-worker-update.ts";

function eventSource<T extends string>() {
  const listeners = new Map<T, Set<() => void>>();
  return {
    add(type: T, listener: () => void) {
      const current = listeners.get(type) ?? new Set();
      current.add(listener);
      listeners.set(type, current);
    },
    remove(type: T, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    emit(type: T) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
}

function fixture(controlled: boolean) {
  const workerEvents = eventSource<"controllerchange">();
  const visibilityEvents = eventSource<"visibilitychange">();
  const update = vi.fn<WorkerRegistrationPort["update"]>().mockResolvedValue(undefined);
  const registration: WorkerRegistrationPort = { update };
  const register = vi.fn<WorkerContainerPort["register"]>().mockResolvedValue(registration);
  const container: WorkerContainerPort = {
    controller: controlled ? {} : null,
    register,
    addEventListener: workerEvents.add,
    removeEventListener: workerEvents.remove,
  };
  const visibility: VisibilityPort = {
    visibilityState: "visible",
    addEventListener: visibilityEvents.add,
    removeEventListener: visibilityEvents.remove,
  };
  return { container, register, update, visibility, visibilityEvents, workerEvents };
}

describe("service worker update lifecycle", () => {
  it("recarrega uma única vez quando uma geração nova controla um cliente antigo", async () => {
    const current = fixture(true);
    const reload = vi.fn();
    const report = vi.fn();

    const stop = startServiceWorkerUpdateLifecycle({
      container: current.container,
      visibility: current.visibility,
      reload,
      report,
    });
    await Promise.resolve();

    expect(current.register).toHaveBeenCalledWith("/sw.js", { updateViaCache: "none" });
    expect(current.update).toHaveBeenCalledTimes(1);

    current.workerEvents.emit("controllerchange");
    current.workerEvents.emit("controllerchange");
    expect(reload).toHaveBeenCalledTimes(1);

    current.visibility.visibilityState = "hidden";
    current.visibilityEvents.emit("visibilitychange");
    expect(current.update).toHaveBeenCalledTimes(1);
    current.visibility.visibilityState = "visible";
    current.visibilityEvents.emit("visibilitychange");
    expect(current.update).toHaveBeenCalledTimes(2);

    stop();
    current.visibilityEvents.emit("visibilitychange");
    current.workerEvents.emit("controllerchange");
    expect(current.update).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  it("não recarrega durante a primeira instalação em uma página ainda não controlada", async () => {
    const firstInstall = fixture(false);
    const reload = vi.fn();

    startServiceWorkerUpdateLifecycle({
      container: firstInstall.container,
      visibility: firstInstall.visibility,
      reload,
      report: vi.fn(),
    });
    await Promise.resolve();
    firstInstall.workerEvents.emit("controllerchange");

    expect(reload).not.toHaveBeenCalled();
  });
});
