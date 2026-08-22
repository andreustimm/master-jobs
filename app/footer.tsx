import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatChangelogDiagnostic, parseUserChangelog } from "../src/core/changelog.ts";
import type { LocaleId, Translator } from "../src/core/i18n/index.ts";

/**
 * Rodapé com a versão no ar e o histórico de novidades.
 *
 * ## Por que ler o markdown aqui, e não gerar um JSON no build
 *
 * Server Component: dá para ler o arquivo direto. Um JSON gerado seria um
 * terceiro lugar onde a mesma verdade mora, com a chance habitual de ficar
 * atrás do arquivo que ele descreve — e o modo de falhar seria silencioso, com
 * o rodapé mostrando a versão anterior sem ninguém reparar.
 *
 * ## Por que popover, e não uma página
 *
 * O mesmo motivo do modal de vaga: zero JavaScript enviado. O navegador cuida
 * de abrir, fechar no Escape, dispensar por clique fora e camada de topo. Uma
 * rota `/novidades` custaria uma navegação inteira para ler cinco linhas.
 */

/** Rótulos de seção que o markdown usa, e a cor de cada um. */
const COR_SECAO: Record<string, string> = {
  Novidade: "text-[var(--ok)]",
  Correção: "text-[var(--warn)]",
};

type LegacyRelease = {
  versao: string;
  data: string;
  secoes: { titulo: string; itens: string[] }[];
};

const CHANGELOG_FILE: Record<LocaleId, string> = {
  "pt-BR": "USER_CHANGELOG.pt-BR.md",
  en: "USER_CHANGELOG.en.md",
};

function secoesDoMarkdown(markdown: string): LegacyRelease["secoes"] {
  const secoes: LegacyRelease["secoes"] = [];
  let atual: LegacyRelease["secoes"][number] | undefined;
  for (const linha of markdown.split("\n")) {
    const cabecalho = /^###\s+(.+?)\s*$/.exec(linha);
    if (cabecalho) {
      atual = { titulo: cabecalho[1]!, itens: [] };
      secoes.push(atual);
      continue;
    }
    const item = /^[-*]\s+(.+?)\s*$/.exec(linha);
    if (item && atual) atual.itens.push(item[1]!);
  }
  return secoes.filter((secao) => secao.itens.length > 0);
}

async function lerChangelog(locale: LocaleId): Promise<LegacyRelease[]> {
  try {
    const bruto = await readFile(join(process.cwd(), CHANGELOG_FILE[locale]), "utf8");
    const parsed = parseUserChangelog(bruto);
    for (const issue of parsed.issues) {
      console.warn(formatChangelogDiagnostic(issue, locale));
    }
    return parsed.releases.map((release) => ({
      versao: release.version,
      data: release.publication.value,
      secoes: secoesDoMarkdown(release.markdown),
    }));
  } catch {
    // Arquivo ausente ou ilegível não pode derrubar toda página do sistema —
    // o rodapé é global. Sem changelog, o rodapé mostra só a versão.
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
  const versoes = await lerChangelog(locale);
  const id = "changelog-modal";

  return (
    <footer className="mt-auto border-t border-[var(--color-hairline)]">
      <div className="mx-auto flex w-full max-w-[min(90vw,1760px)] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 sm:px-6">
        <span className="type-meta font-mono text-muted-foreground">
          Master Jobs v{versao}
        </span>

        {versoes.length > 0 && (
          <button
            type="button"
            popoverTarget={id}
            popoverTargetAction="show"
            className="type-meta cursor-pointer text-[var(--primary-text)] underline-offset-2 hover:underline"
          >
            {t("changelog.link")}
          </button>
        )}
      </div>

      {versoes.length > 0 && (
        <div
          id={id}
          popover="auto"
          className="m-auto max-h-[85dvh] w-[min(92vw,640px)] overflow-y-auto rounded-xl bg-card p-0 text-card-foreground ring-1 ring-foreground/10 backdrop:bg-black/40"
        >
          <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--color-hairline)] bg-card px-5 py-4">
            <div>
              <h2 className="type-display-xs leading-tight">{t("changelog.title")}</h2>
              <p className="type-body-sm mt-0.5 text-muted-foreground">{t("changelog.lead")}</p>
            </div>
            <button
              type="button"
              popoverTarget={id}
              popoverTargetAction="hide"
              aria-label={t("changelog.close")}
              className="shrink-0 rounded-md px-2 py-1 text-lg leading-none text-muted-foreground hover:bg-muted"
            >
              ×
            </button>
          </header>

          <div className="grid gap-6 px-5 py-4">
            {versoes.map((v) => (
              <section key={v.versao}>
                <h3 className="type-body-lg flex items-baseline gap-2 font-medium">
                  v{v.versao}
                  <span className="type-meta font-mono text-muted-foreground">{v.data}</span>
                </h3>

                {v.secoes.map((s) => (
                  <div key={s.titulo} className="mt-3">
                    <p className={`type-micro mb-1 ${COR_SECAO[s.titulo] ?? "text-muted-foreground"}`}>
                      {s.titulo}
                    </p>
                    <ul className="grid gap-1.5">
                      {s.itens.map((item) => (
                        // O texto vem do markdown, escrito à mão, e é
                        // renderizado como TEXTO — nunca como HTML. Marcação no
                        // arquivo aparece literal, e é o preço certo a pagar:
                        // interpretar HTML aqui abriria injeção por um arquivo
                        // que qualquer PR pode editar.
                        <li key={item} className="type-body-sm flex gap-2 text-muted-foreground">
                          <span aria-hidden="true" className="select-none">·</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </footer>
  );
}
