import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { ProfileSchema, type Profile } from "./schema.ts";

let cached: Profile | undefined;

/**
 * Expands `${VAR}` references in the profile against the environment.
 *
 * Exists so personal contact details stay out of a versioned file. The profile
 * is the one config a user edits by hand, which makes it exactly the file that
 * ends up in a public repository — and Git keeps history, so deleting an
 * address after the fact does not delete it.
 *
 * A missing variable expands to empty rather than throwing. Refusing to load
 * the profile would break scoring, sourcing and the whole CLI over a contact
 * field that no ranking depends on; the cost of the mistake does not justify
 * that blast radius. `jho profile` reports what came out empty, and
 * `jho security check` is where the nagging belongs.
 */
export function expandEnv(
  text: string,
  env: Record<string, string | undefined> = process.env,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const expanded = text.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_m, name: string) => {
    const value = env[name];
    if (value === undefined || value === "") {
      if (!missing.includes(name)) missing.push(name);
      return "";
    }
    return value;
  });
  return { text: expanded, missing };
}

/** Env vars the profile asked for and did not get, from the last load. */
export let missingProfileEnv: string[] = [];

export function profilePath(): string {
  return process.env.JHO_PROFILE_PATH ?? resolve(process.cwd(), "profile/profile.yaml");
}

export async function loadProfile(force = false): Promise<Profile> {
  if (cached && !force) return cached;
  const raw = await readFile(profilePath(), "utf8");
  const { text, missing } = expandEnv(raw);
  missingProfileEnv = missing;
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
