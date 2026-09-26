import type { BuiltUserRelease } from "../src/core/changelog.ts";
import type { LocaleId, Translator } from "../src/core/i18n/index.ts";
import { changelogs } from "../src/generated/changelog.ts";
import { ChangelogModal } from "./changelog-modal";

export function Footer({
  versao,
  locale,
  t,
  signedIn,
  loadReleases = (locale) => changelogs[locale],
}: {
  versao: string;
  locale: LocaleId;
  t: Translator["t"];
  signedIn: boolean;
  loadReleases?: (locale: LocaleId) => BuiltUserRelease[];
}) {
  // O changelog é conteúdo interno do produto. Além de não renderizar o
  // gatilho no login, enviamos os dados pré-compilados somente com sessão válida.
  const releases = signedIn ? loadReleases(locale) : [];

  return (
    <footer className="mt-auto border-t border-[var(--hairline)]">
      {/* Mesmo shell do conteúdo: 95% úteis no celular, calha fixa acima. */}
      <div className="app-shell-content mx-auto flex w-full max-w-[1760px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 sm:px-6 lg:px-8">
        {/* `data-app-version` é contrato com a fumaça pós-deploy: ela precisa
            saber QUAL versão está servindo, e procurar "número com dois pontos"
            no HTML achava hash de asset — foi assim que a conferência da 1.17.1
            reprovou lendo `022.617.46`. */}
        <span data-app-version={versao} className="type-meta font-mono text-muted-foreground">
          Master Jobs v{versao}
        </span>

        {signedIn && releases.length > 0 ? (
          <ChangelogModal
            currentVersion={versao}
            locale={locale}
            releases={releases}
            labels={{
              open: t("changelog.link"),
              title: t("changelog.title"),
              lead: t("changelog.lead"),
              close: t("changelog.close"),
              internal: t("changelog.internal"),
            }}
          />
        ) : null}
      </div>
    </footer>
  );
}
