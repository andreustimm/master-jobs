/**
 * Termos de Uso e Política de Privacidade, versionados (#464, ADR-012).
 *
 * Os textos são Markdown em `content/legal/{terms,privacy}.{pt-BR,en}.md`, com
 * front matter `title` e `version` (data `AAAA-MM-DD`, entre aspas). A versão é
 * o que o cadastro grava na conta (`auth_user.terms_version`,
 * `privacy_version`): quem aceitou a v1 continua com a v1 depois que o texto
 * muda, e o cadastro seguinte grava a v2 (US-021.EC-1).
 *
 * Lido do disco a cada chamada, sem cache: trocar o arquivo muda a versão na
 * próxima leitura, sem reiniciar nada. Num deployment o diretório precisa
 * estar no pacote da função que lê — `next.config.ts` inclui `content/legal/`
 * em `outputFileTracingIncludes`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { LocaleId } from "./i18n/locales.ts";

export const LEGAL_KINDS = ["terms", "privacy"] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];

export type LegalDocument = {
  kind: LegalKind;
  locale: LocaleId;
  title: string;
  version: string;
  /** Markdown, sem o front matter. */
  body: string;
};

/** Onde os textos moram, relativo à raiz do projeto. */
export const LEGAL_DIR = join(process.cwd(), "content", "legal");

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const VERSION = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lê um documento. Arquivo sem front matter, sem título ou com versão fora do
 * formato é erro que nomeia o arquivo: gravar versão errada no aceite de alguém
 * é pior do que não abrir a página.
 */
export function readLegal(kind: LegalKind, locale: LocaleId, dir: string = LEGAL_DIR): LegalDocument {
  const file = join(dir, `${kind}.${locale}.md`);
  const raw = readFileSync(file, "utf8");
  const match = FRONT_MATTER.exec(raw);
  if (!match) throw new Error(`${kind}.${locale}.md sem front matter`);
  const meta = parse(match[1]!) as Record<string, unknown> | null;
  const title = typeof meta?.title === "string" ? meta.title.trim() : "";
  const version = typeof meta?.version === "string" ? meta.version.trim() : "";
  if (!title) throw new Error(`${kind}.${locale}.md sem title no front matter`);
  if (!VERSION.test(version)) throw new Error(`${kind}.${locale}.md com version fora do formato AAAA-MM-DD`);
  return { kind, locale, title, version, body: match[2]!.trim() };
}

export type LegalVersions = Readonly<Record<LegalKind, string>>;

/**
 * As versões vigentes, que o cadastro grava.
 *
 * As traduções de um documento têm de ter a mesma versão: quem aceitou em
 * inglês aceitou o mesmo documento de quem aceitou em português. Divergência é
 * erro, para nenhum aceite ser gravado com versão ambígua.
 */
export function currentLegalVersions(dir: string = LEGAL_DIR): LegalVersions {
  const versionOf = (kind: LegalKind): string => {
    const pt = readLegal(kind, "pt-BR", dir).version;
    const en = readLegal(kind, "en", dir).version;
    if (pt !== en) throw new Error(`${kind}: versões diferentes entre pt-BR e en`);
    return pt;
  };
  return { terms: versionOf("terms"), privacy: versionOf("privacy") };
}
