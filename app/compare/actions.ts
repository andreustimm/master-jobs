"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ComparisonInputError,
  createManualComparison,
} from "../../src/contexts/matching/index.ts";
import { guard, guardOwnCandidate } from "../auth";
import {
  type CompareActionState,
} from "./form-state";
import { setMutationFeedbackCookie } from "../mutation-feedback-server";

/** Create, score and open a manually supplied posting. */
export async function compareJobAction(
  _previousState: CompareActionState,
  formData: FormData,
): Promise<CompareActionState> {
  await guard("job:write");
  const { candidateId } = await guardOwnCandidate("candidate:read");

  const input = {
    title: String(formData.get("title") ?? ""),
    companyName: String(formData.get("companyName") ?? ""),
    location: String(formData.get("location") ?? ""),
    url: String(formData.get("url") ?? ""),
    description: String(formData.get("description") ?? ""),
  };

  const supplied = formData.get("file");
  // Browsers submit a zero-byte File when no file was chosen. The client-side
  // marker distinguishes that placeholder from a genuinely selected empty
  // file, while the server still accepts a non-empty file without trusting the
  // marker (important for non-browser clients).
  const fileSelected = formData.get("fileSelected") === "1";
  if (fileSelected && (!(supplied instanceof File) || supplied.size === 0)) {
    return { status: "error", fieldErrors: { file: ["file-empty"] } };
  }
  const file = supplied instanceof File && supplied.size > 0 ? supplied : null;
  let jobId: number;
  try {
    const result = await createManualComparison(candidateId, {
      ...input,
      document: file ? {
        name: file.name,
        type: file.type,
        data: await file.arrayBuffer(),
      } : undefined,
    });
    jobId = result.jobId;
  } catch (error) {
    if (error instanceof ComparisonInputError) {
      return error.field
        ? { status: "error", fieldErrors: { [error.field]: [error.code] } }
        : { status: "error", formError: error.code };
    }
    return { status: "error", formError: "unexpected" };
  }

  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/compare");
  await setMutationFeedbackCookie("success");
  redirect(`/compare?job=${jobId}#comparison-result`);
}
