import "server-only";

import { cookies } from "next/headers";

export const MUTATION_FEEDBACK_COOKIE = "jho_mutation_feedback";

export type MutationFeedbackCookie = {
  id: string;
  kind: "success" | "error";
  message: "success" | "error";
};

export async function setMutationFeedbackCookie(
  kind: MutationFeedbackCookie["kind"],
  message: MutationFeedbackCookie["message"] = kind,
): Promise<void> {
  const jar = await cookies();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  jar.set(MUTATION_FEEDBACK_COOKIE, encodeURIComponent(JSON.stringify({ id, kind, message })), {
    httpOnly: false,
    maxAge: 10,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function readMutationFeedbackCookie(raw: string | undefined): MutationFeedbackCookie | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<MutationFeedbackCookie>;
    if (
      typeof parsed.id !== "string" ||
      parsed.id.length === 0 ||
      (parsed.kind !== "success" && parsed.kind !== "error") ||
      (parsed.message !== "success" && parsed.message !== "error")
    ) {
      return null;
    }
    return { id: parsed.id, kind: parsed.kind, message: parsed.message };
  } catch {
    return null;
  }
}
