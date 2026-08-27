export type WorkerRegistrationPort = {
  update(): Promise<unknown>;
};

export type WorkerContainerPort = {
  controller: object | null;
  register(
    scriptURL: string,
    options: { updateViaCache: "none" },
  ): Promise<WorkerRegistrationPort>;
  addEventListener(type: "controllerchange", listener: () => void): void;
  removeEventListener(type: "controllerchange", listener: () => void): void;
};

export type VisibilityPort = {
  visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

export function startServiceWorkerUpdateLifecycle(input: {
  container: WorkerContainerPort;
  visibility: VisibilityPort;
  reload(): void;
  report(error: unknown): void;
}): () => void {
  const controlledAtStart = input.container.controller !== null;
  let registration: WorkerRegistrationPort | null = null;
  let stopped = false;
  let reloading = false;

  const report = (error: unknown) => {
    if (!stopped) input.report(error);
  };
  const update = () => {
    if (stopped || !registration) return;
    void registration.update().catch(report);
  };
  const onVisibilityChange = () => {
    if (input.visibility.visibilityState === "visible") update();
  };
  const onControllerChange = () => {
    if (stopped || !controlledAtStart || reloading) return;
    reloading = true;
    input.reload();
  };

  input.container.addEventListener("controllerchange", onControllerChange);
  input.visibility.addEventListener("visibilitychange", onVisibilityChange);
  void input.container.register("/sw.js", { updateViaCache: "none" })
    .then((current) => {
      if (stopped) return;
      registration = current;
      update();
    })
    .catch(report);

  return () => {
    stopped = true;
    input.container.removeEventListener("controllerchange", onControllerChange);
    input.visibility.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
