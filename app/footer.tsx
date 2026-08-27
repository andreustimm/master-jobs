import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  changelogFile,
  formatChangelogDiagnostic,
  parseUserChangelog,
  type UserRelease,
} from "../src/core/changelog.ts";
import type { LocaleId, Translator } from "../src/core/i18n/index.ts";
import { ChangelogModal } from "./changelog-modal";

async function loadChangelog(locale: LocaleId): Promise<UserRelease[]> {
  const file = changelogFile(locale);
  if (!file) return [];

  try {
    const source = await readFile(join(process.cwd(), file), "utf8");
    const parsed = parseUserChangelog(source);
    for (const issue of parsed.issues) {
      console.warn(formatChangelogDiagnostic(issue, locale));
    }
    return parsed.releases;
  } catch {
    console.warn(`changelog:read_failed locale=${locale}`);
    return [];
  }
}

export async function Footer({
  versao,
  locale,
  t,
}: {
  versao: string;
  locale: LocaleId;
  t: Translator["t"];
}) {
  const releases = await loadChangelog(locale);

  return (
    <footer className="mt-auto border-t border-[var(--hairline)]">
      {/* Mesmo shell do cabeçalho e do conteúdo: uma regra só, calha fixa. */}
      <div className="mx-auto flex w-full max-w-[1760px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 sm:px-6 lg:px-8">
        <span className="type-meta font-mono text-muted-foreground">
          Master Jobs v{versao}
        </span>

        {releases.length > 0 ? (
          <ChangelogModal
            currentVersion={versao}
            locale={locale}
            releases={releases}
            labels={{
              open: t("changelog.link"),
              title: t("changelog.title"),
              lead: t("changelog.lead"),
              close: t("changelog.close"),
            }}
          />
        ) : null}
      </div>
    </footer>
  );
}
