import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { ProfileSchema, type Profile } from "./schema.ts";

let cached: Profile | undefined;

export function profilePath(): string {
  return process.env.JHO_PROFILE_PATH ?? resolve(process.cwd(), "profile/profile.yaml");
}

export async function loadProfile(force = false): Promise<Profile> {
  if (cached && !force) return cached;
  const text = await readFile(profilePath(), "utf8");
  const parsed = ProfileSchema.safeParse(parse(text));
  if (!parsed.success) {
    throw new Error(
      `profile.yaml is invalid:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
  }
  cached = parsed.data;
  return cached;
}
