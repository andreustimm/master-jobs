/**
 * robots.txt, honoured.
 *
 * This is the line the project does not cross. The rule inherited from ADR 0001
 * is that absence of a prohibition is not permission — so where a site states a
 * rule, it is obeyed, and a fetch is skipped rather than attempted. A `blocked`
 * task is a correct outcome, not a failure to retry.
 *
 * Deliberately small: group selection, Allow/Disallow with longest-match wins,
 * and Crawl-delay. Not implemented: sitemaps, wildcards beyond `*` and `$`,
 * host directives. A parser that guesses at exotic syntax would be more
 * dangerous than one that is clear about its limits.
 */

import { http } from "../sources/http-port.ts";
import "../sources/http.ts";

export type RobotsRules = {
  /** Longest match wins, which is what the spec says. */
  rules: Array<{ allow: boolean; path: string }>;
  crawlDelayMs: number | null;
};

const OUR_AGENT = "jho";

export function parseRobots(text: string): RobotsRules {
  const lines = text.split(/\r?\n/);
  const groups: Array<{ agents: string[]; rules: RobotsRules["rules"]; delay: number | null }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const index = line.indexOf(":");
    if (index === -1) continue;

    const field = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();

    if (field === "user-agent") {
      // Consecutive User-agent lines share one group of rules.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], delay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;
    if (!current) continue;

    if (field === "disallow") current.rules.push({ allow: false, path: value });
    else if (field === "allow") current.rules.push({ allow: true, path: value });
    else if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.delay = seconds * 1000;
    }
  }

  // A group naming us specifically overrides the wildcard group.
  const specific = groups.find((g) => g.agents.some((a) => a.includes(OUR_AGENT)));
  const wildcard = groups.find((g) => g.agents.includes("*"));
  const chosen = specific ?? wildcard;

  return { rules: chosen?.rules ?? [], crawlDelayMs: chosen?.delay ?? null };
}

function matches(pattern: string, path: string): boolean {
  if (pattern === "") return false;
  // Translate the two wildcards robots.txt actually defines.
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\$$/, "$");
  return new RegExp(`^${escaped}`).test(path);
}

export function isAllowed(rules: RobotsRules, path: string): boolean {
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of rules.rules) {
    if (!matches(rule.path, path)) continue;
    if (best === null || rule.path.length > best.length) {
      best = { allow: rule.allow, length: rule.path.length };
    }
  }
  // No rule mentions this path: permitted. That is what robots.txt means.
  return best === null ? true : best.allow;
}

const cache = new Map<string, RobotsRules>();

export function clearRobotsCache(): void {
  cache.clear();
}

/**
 * Goes through the HTTP port, not `fetch`.
 *
 * robots.txt is a network call like any other, and routing it through the port
 * is what lets a test assert that a forbidden page was never even requested —
 * which is the only way to verify the invariant rather than trust it.
 */
export async function robotsFor(origin: string): Promise<RobotsRules> {
  const cached = cache.get(origin);
  if (cached) return cached;

  let rules: RobotsRules = { rules: [], crawlDelayMs: null };
  // 404 means no rules, which means everything is permitted. An unreachable or
  // erroring robots.txt is not a statement about permission either, so it is
  // treated the same way rather than blocking the whole host on a transient
  // failure. `text()` already returns null for both.
  const body = await http().text(`${origin}/robots.txt`, {
    timeoutMs: 8000,
    headers: { "user-agent": OUR_AGENT },
  });
  if (body !== null) rules = parseRobots(body);

  cache.set(origin, rules);
  return rules;
}

export async function mayFetch(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const rules = await robotsFor(parsed.origin);
  return isAllowed(rules, parsed.pathname + parsed.search);
}
