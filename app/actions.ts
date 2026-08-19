"use server";

import { revalidatePath } from "next/cache";
import { guard } from "./auth";
import { setApplicationStatus } from "../src/core/db/repo.ts";
import { APPLICATION_STATUSES } from "../src/core/db/schema.ts";

/**
 * Move a job through the funnel.
 *
 * Routed through the same `setApplicationStatus` the CLI uses, so the
 * transition lands in `application_event` identically. There is deliberately
 * no second write path — the UI is an adapter, not a parallel implementation.
 */
export async function trackAction(formData: FormData) {
  // Before any effect, never after: an action that validates late has already
  // written by the time it decides it should not have.
  await guard("application:write");

  const jobId = Number(formData.get("jobId"));
  const status = String(formData.get("status"));
  const note = formData.get("note");

  if (!Number.isFinite(jobId)) throw new Error("jobId inválido");
  if (!(APPLICATION_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Status inválido: ${status}`);
  }

  await setApplicationStatus(jobId, status as never, typeof note === "string" ? note : undefined);

  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/pipeline");
}
