import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mobile regressions are invisible on a desktop, which is where this code is
 * written. These assert the two mistakes that break a phone silently.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const read = (f: string) => readFileSync(f, "utf8");

describe("viewport", () => {
  it("declares device-width", () => {
    // Without this a phone renders at an assumed 980px and scales down, so
    // every breakpoint below `lg` never fires and the responsive CSS is dead
    // code on the only device it was written for.
    const layout = read("app/layout.tsx");
    expect(layout).toContain("export const viewport");
    expect(layout).toContain('width: "device-width"');
  });

  it("does not cap zoom", () => {
    // Capping zoom is an accessibility failure, and this app is read squinting
    // at job descriptions on a phone.
    // Matches the assignment, not the word — the file explains in a comment
    // why the cap is absent, and a naive search would flag its own rationale.
    const layout = read("app/layout.tsx");
    expect(layout).not.toMatch(/maximumScale\s*:/);
    expect(layout).not.toMatch(/userScalable\s*:/);
  });
});

describe("layout", () => {
  const files = walk("app");

  it("gives every multi-column grid a single-column fallback", () => {
    // A three-column grid with fixed track widths does not fit 375px, and the
    // overflow is horizontal scroll on the whole page.
    const offenders: string[] = [];
    for (const file of files) {
      for (const match of read(file).matchAll(/grid-cols-\[[^\]]+_[^\]]+_[^\]]+\]/g)) {
        const line = match[0];
        // Acceptable when it is itself the `sm:` variant.
        const context = read(file).slice(Math.max(0, match.index - 60), match.index);
        if (!context.includes("sm:") && !line.startsWith("sm:")) {
          offenders.push(`${file}: ${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses no fixed width wider than the narrowest phone", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const match of read(file).matchAll(/(?<!max-)\bw-\[(\d+)px\]/g)) {
        if (Number(match[1]) > 360) offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses one deterministic shell: full width, capped, fixed gutters", () => {
    // The old shell was a tripod — 95vw on phone, 90vw after `sm`, and a CSS
    // class that zeroed padding on top. Three synchronized rules meant one
    // stale stylesheet in a build left the header with no gutter and no
    // height, which is exactly what production served. One rule now: 100%
    // width capped at 1760px, gutters from the DESIGN.md spacing scale.
    const layout = read("app/layout.tsx");
    const footer = read("app/footer.tsx");
    for (const source of [layout, footer]) {
      expect(source).toContain("max-w-[1760px]");
      expect(source).toContain("px-4");
      expect(source).toContain("sm:px-6");
      expect(source).toContain("lg:px-8");
      expect(source).not.toMatch(/\d+vw/);
    }
  });

  it("does not depend on a mobile-only shell class for its gutters", () => {
    const globals = read("app/globals.css");
    expect(globals).not.toContain("mobile-content-shell");
    // The installed shell keeps the physical notch reserved — replacing the
    // fixed gutter, never stacking on top of it.
    expect(globals).toContain(
      "padding-left: max(var(--spacing-md), var(--safe-area-left));",
    );
    expect(globals).toContain(
      "padding-right: max(var(--spacing-md), var(--safe-area-right));",
    );
  });

  it("keeps the market-demand rows shrinkable on a narrow screen", () => {
    const skills = read("app/candidate/skills/page.tsx");
    expect(skills).toContain('data-testid="skills-market-list"');
    expect(skills).toContain("flex min-w-0 flex-wrap items-center");
    expect(skills).toContain("order-4 h-1.5 basis-full");
    expect(skills).not.toContain("min-w-[180px]");
  });

  it("keeps version actions touchable on mobile and compact on desktop", () => {
    const versions = read("app/candidate/versions.tsx");
    expect(versions).toContain("inline-flex min-h-11");
    expect(versions).toContain("xl:h-7 xl:min-h-0");
  });

  it("keeps administrative row actions touchable on mobile", () => {
    const users = read("app/admin/users/page.tsx");
    expect(users.match(/min-h-11 xl:h-7 xl:min-h-0/g)?.length).toBeGreaterThanOrEqual(4);
    expect(users).toContain('data-testid="user-delete-open"');
    const skills = read("app/candidate/skills/page.tsx");
    expect(skills.match(/min-h-11 xl:h-7 xl:min-h-0/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps navigation responsive through tablet landscape", () => {
    const layout = read("app/layout.tsx");
    const mobileNav = read("app/mobile-nav.tsx");
    expect(layout).toContain("data-responsive-nav");
    expect(layout).toContain("data-responsive-nav-spacer");
    expect(mobileNav).toContain("ResizeObserver");
  });
});
