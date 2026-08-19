/**
 * Qualitative reading of one job posting.
 *
 * Runs only over the slice the deterministic scorer already selected. It does
 * not rank, and it must not: ranking has to be reproducible across thousands of
 * postings and auditable line by line (ADR 0004). This reads what a word count
 * cannot — whether "senior" in the title survives contact with the scope, what
 * the ad omits, and which question to ask first.
 *
 * The system prompt is loaded from `docs/prompts/system/job-analysis.md` rather
 * than embedded here. That is deliberate: the prompt is the part a user will
 * want to adjust to their own judgement, and making them edit TypeScript to do
 * it would put it out of reach. The file is the interface.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Dossier } from "../apply/dossier.ts";
import type { LlmPort, LlmRequest } from "./port.ts";

export type Analysis = {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

/**
 * Reads the system prompt out of the documented markdown.
 *
 * The first fenced block is the prompt; the prose around it is rationale for
 * humans. Keeping both in one file is what stops the explanation and the
 * behaviour from drifting apart.
 */
export async function loadSystemPrompt(name: string, root = process.cwd()): Promise<string> {
  const path = resolve(root, "docs/prompts/system", `${name}.md`);
  const markdown = await readFile(path, "utf8");
  const fenced = /```(?:\w+)?\n([\s\S]*?)```/.exec(markdown);
  if (!fenced?.[1]) {
    throw new Error(`Nenhum bloco de prompt em ${path}. Esperado um trecho entre \`\`\`.`);
  }
  return fenced[1].trim();
}

/** What will be sent, assembled explicitly so the caller can show it first. */
export function buildAnalysisInput(dossier: Dossier, description: string): string {
  const parts = [
    `CARGO: ${dossier.job.title}`,
    `EMPRESA: ${dossier.job.companyName}`,
    dossier.job.locationRaw ? `LOCAL DECLARADO: ${dossier.job.locationRaw}` : null,
    dossier.job.ageDays === null ? null : `PUBLICADA HÁ: ${dossier.job.ageDays} dia(s)`,
    "",
    "ANÚNCIO:",
    description,
  ];

  if (dossier.requirements.length > 0) {
    parts.push("", "REQUISITOS EXTRAÍDOS:", ...dossier.requirements.map((r) => `- ${r}`));
  }
  return parts.filter((p) => p !== null).join("\n");
}

export async function analyzeJob(
  llm: LlmPort,
  dossier: Dossier,
  description: string,
  root = process.cwd(),
  options: { effort?: LlmRequest["effort"]; maxTokens?: number } = {},
): Promise<Analysis> {
  const system = await loadSystemPrompt("job-analysis", root);
  const input = buildAnalysisInput(dossier, description);

  const response = await llm.complete({
    system,
    messages: [{ role: "user", content: input }],
    maxTokens: options.maxTokens ?? 1600,
    effort: options.effort,
    // Low, because the job is to report what the ad says, not to be creative
    // about it. A confident invention here costs the user an application.
    temperature: 0.1,
  });

  return {
    text: response.text.trim(),
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}

/** Rough character count of what leaves the machine, for the confirmation. */
export function payloadSize(dossier: Dossier, description: string): number {
  return buildAnalysisInput(dossier, description).length;
}
