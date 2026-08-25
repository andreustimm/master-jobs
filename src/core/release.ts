import {
  ChangelogDomainError,
  bodyHasUserContent,
  changelogSections,
  hasNoUserChangeMarker,
  parseUserChangelog,
  validateLocalizedChangelogs,
  type ChangelogIssueCode,
  type ChangelogLocale,
  type ChangelogParseResult,
  type ChangelogSection,
  type Publication,
} from "./changelog.ts";

/**
 * Versionamento semântico — o núcleo PURO.
 *
 * Decide, sem tocar em git, banco ou disco: qual é o próximo número, e como o
 * `## [Unreleased]` dos dois changelogs vira a versão publicada.
 *
 * ## Por que isto existe
 *
 * A tag `v1.0.0` ficou apontando para um commit do passado enquanto `main`
 * avançava com M-06 e a fila de repontuação — ninguém bumpeou na promoção, e o
 * `sincronizar-apos-main` leu `1.0.0`, viu a tag já existir e não fez nada.
 * Um histórico que mente sobre a própria versão orienta a próxima decisão para
 * o lugar errado.
 *
 * O bump é decidido pelo primeiro writer serializado: normalmente a promoção
 * `dev → staging`, ou a sincronização pós-`main` para hotfix direto. Uma
 * execução = uma versão, cobrindo todos os commits desde a última tag. A
 * classificação vem do tipo de commit: `fix:` → patch, `feat:` → minor,
 * `BREAKING CHANGE` → major. O maior vence entre os commits da leva.
 */

/** Direção do bump. `null` quando nenhum commit pede release. */
export type TipoBump = "patch" | "minor" | "major";

/**
 * Classifica uma leva de assuntos de commit (uma linha de `git log --format=%s`
 * por entrada) na direção do bump, pelo maior nível pedido.
 *
 * Convenção de Conventional Commits:
 * - `feat:` / `feat(escopo):` → minor;
 * - `fix:` / `fix(escopo):` → patch;
 * - `BREAKING CHANGE` no texto, ou `!` logo após o tipo (`feat!:`), → major;
 * - `chore:`, `docs:`, `refactor:`, `test:`, `ci:` → nada (manutenção interna).
 *
 * Mensagem **sem prefixo nenhum** cai no patch. É conservador na direção certa:
 * um commit que mudou o produto e não foi rotulado é, no pior caso, uma
 * correção — e ignorá-lo deixa a versão parada enquanto o código avança, que é
 * exatamente o defeito que este módulo existe para matar. Devolver `null` aí
 * faria o histórico mentir de novo.
 *
 * Devolve `null` só quando a leva é vazia ou composta inteiramente de commits
 * explicitamente marcados como manutenção.
 */
export function classificarBump(assuntos: string[]): TipoBump | null {
  let nivel: TipoBump | null = null;

  for (const assunto of assuntos) {
    const t = tipoDoAssunto(assunto);
    if (!t) continue;
    if (t === "major") return "major";
    if (t === "minor") nivel = "minor";
    else if (!nivel) nivel = "patch";
  }

  return nivel;
}

/** Prefixos que declaram manutenção — nunca pedem release. */
const MANUTENCAO = new Set(["chore", "docs", "refactor", "test", "ci"]);
const VERSAO_SEMANTICA = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function tipoDoAssunto(assunto: string): TipoBump | null {
  const linha = assunto.trim();
  if (linha === "") return null;

  // A PR de `staging` para `main` é squash-merged pelo GitHub. O título
  // gerado pelo workflow vira um commit comum (não um merge) e, sem este
  // reconhecimento, seria interpretado como uma mudança de produto e abriria
  // uma segunda versão durante o retorno de `main` para `dev`.
  if (/^Promover staging para produção\s+—\s+v\d+\.\d+\.\d+(?:\s+\(#\d+\))?$/i.test(linha)) {
    return null;
  }

  // Convenção antiga `BREAKING CHANGE` em qualquer ponto do texto.
  if (/BREAKING[ -]CHANGE/i.test(linha)) return "major";

  // `tipo!` — o `!` de breaking vem logo após o tipo, com ou sem escopo
  // (`feat!:`, `fix(scope)!:`). O `!` aqui é OBRIGATÓRIO: é ele que distingue
  // breaking de um release comum.
  const quebra = /^(\w+)(\([^)]*\))?![:]?/.exec(linha);
  if (quebra) {
    return quebra[1] === "feat" || quebra[1] === "fix" ? "major" : null;
  }

  // `tipo:` ou `tipo(escopo):`.
  const comum = /^(\w+)(\([^)]*\))?:/.exec(linha);
  if (comum) {
    const tipo = comum[1]!.toLowerCase();
    if (tipo === "feat") return "minor";
    if (tipo === "fix") return "patch";
    // Prefixo explícito de manutenção. Só ele devolve null: quem escreveu
    // `chore:` declarou que aquilo não muda o produto.
    if (MANUTENCAO.has(tipo)) return null;
    // Prefixo desconhecido (`Backlog:`, `M-06:`) cai no patch abaixo, junto
    // com a mensagem sem prefixo — não rotulou como manutenção, então conta.
  }

  // Sem prefixo convencional: mensagem livre. Trata como patch, não como nada.
  return "patch";
}

/**
 * `1.0.0` + minor → `1.1.0`; `1.0.0` + major → `2.0.0`; patch → `1.0.1`.
 *
 * Recusa versão que não é `MAJOR.MINOR.PATCH` em vez de inventar um número —
 * um `package.json` torto é exatamente o tipo de erro que este módulo existe
 * para tornar visível.
 */
export function proximaVersao(atual: string, tipo: TipoBump): string {
  const m = VERSAO_SEMANTICA.exec(atual.trim());
  if (!m) throw new Error(`versão inválida no package.json: "${atual}"`);

  const [major, minor, patch] = [BigInt(m[1]!), BigInt(m[2]!), BigInt(m[3]!)];
  if (tipo === "major") return `${major + 1n}.0.0`;
  if (tipo === "minor") return `${major}.${minor + 1n}.0`;
  return `${major}.${minor}.${patch + 1n}`;
}

export function versaoSemanticaValida(value: string): boolean {
  return VERSAO_SEMANTICA.test(value.trim());
}

/**
 * Carimba a seção `## [Unreleased]` de um changelog com a versão e a data, e
 * cria um `## [Unreleased]` vazio no lugar — o changelog se sustenta sozinho.
 *
 * Sem recriar o vazio, a promoção seguinte sempre falharia por ausência de
 * `[Unreleased]`: a versão anterior foi carimbada, ninguém lembrou de abrir uma
 * seção nova, e o fluxo para. O carimbo é o momento em que a nova seção nasce.
 *
 * Só aceita uma ocorrência — zero é "ninguém escreveu a entrada" e mais de uma
 * é "alguém duplicou o cabeçalho"; ambos são estado que deve falhar a promoção,
 * não passar em silêncio. O texto da seção fica intacto: o que muda é o
 * cabeçalho, de `## [Unreleased]` para `## [1.1.0] - 2026-08-21`, e um novo
 * `## [Unreleased]` vazio aparece imediatamente antes.
 */
export function carimbarUnreleased(
  markdown: string,
  versao: string,
  data: string,
): string {
  const estruturais = changelogSections(markdown).filter(
    (section) => section.token === "Unreleased",
  );
  const secoes = estruturais.filter(isCanonicalUnreleased);

  if (estruturais.length === 0 || secoes.length === 0) {
    throw new Error("changelog sem seção ## [Unreleased] — escreva a entrada antes de promover");
  }
  if (estruturais.length > 1) {
    throw new Error("changelog com mais de uma seção ## [Unreleased]");
  }
  if (changelogTemVersao(markdown, versao)) {
    throw new Error(`changelog já contém a versão [${versao}]`);
  }

  // O novo vazio abre antes da entrada recém-carimbada. `[Unreleased]` não
  // leva data: é a seção em construção, e a ausência é o que o parser entende.
  const secao = secoes[0]!;
  const cabecalho = `## [Unreleased]\n\n## [${versao}] - ${data}`;
  return `${markdown.slice(0, secao.index)}${cabecalho}${markdown.slice(secao.bodyStart)}`;
}

/**
 * Garante que um changelog tem a entrada da versão publicada.
 *
 * É o gate de coerência do `package.json` com o changelog: bump sem entrada é
 * release mudo, e entrada sem bump é texto que ninguém vê. A consulta usa as
 * mesmas fronteiras Markdown do parser e ignora exemplos dentro de código.
 */
export function changelogTemVersao(markdown: string, versao: string): boolean {
  return contarVersaoNoChangelog(markdown, versao) > 0;
}

function contarVersaoNoChangelog(markdown: string, versao: string): number {
  return changelogSections(markdown).filter(
    (section) => section.versionSyntaxValid && section.token === versao,
  ).length;
}

/**
 * Confere uma versão como estado único dos changelogs que formam o release.
 *
 * Presente em todos é um release já gravado; ausente em todos permite o bump.
 * Presente em apenas parte deles é uma gravação interrompida ou manualmente
 * corrompida, e continuar criaria duas histórias diferentes para a mesma tag.
 */
export function todosChangelogsTemVersao(
  changelogs: string[],
  versao: string,
): boolean {
  if (changelogs.length === 0) {
    throw new Error("nenhum changelog informado para validar o release");
  }

  const contagens = changelogs.map((markdown) => contarVersaoNoChangelog(markdown, versao));
  if (contagens.some((total) => total > 1)) {
    throw new Error(`versão [${versao}] duplicada em um changelog`);
  }

  const presencas = contagens.map((total) => total === 1);
  if (presencas.some(Boolean) && !presencas.every(Boolean)) {
    throw new Error(`versão [${versao}] presente em apenas parte dos changelogs`);
  }
  return presencas.every(Boolean);
}

/**
 * Reconhece o intervalo recuperável entre persistir o bump e criar sua tag.
 *
 * A tag é o último efeito remoto do release. Sem ela, package e changelogs já
 * alinhados significam que o retry deve concluir a versão atual, não calcular
 * a próxima sobre os mesmos commits.
 */
export function releasePrecisaRetomarTag(
  changelogs: string[],
  versaoAtual: string,
  tagAtualExiste: boolean,
): boolean {
  const persistida = todosChangelogsTemVersao(changelogs, versaoAtual);
  return !tagAtualExiste && persistida;
}

/**
 * Resolve o único commit cujo assunto carimba a versão pedida.
 *
 * O log vem como `SHA<TAB>assunto`, para a comparação não aceitar a frase no
 * corpo de outro commit. Zero ou dois candidatos são estados ambíguos: escolher
 * qualquer um poderia criar uma tag válida apontando para o código errado.
 */
export function commitDaVersao(log: string, versao: string): string {
  const assuntoEsperado = `chore(release): ${versao}`;
  const candidatos = log
    .split("\n")
    .map((linha) => {
      const separador = linha.indexOf("\t");
      if (separador < 1) return null;
      return {
        sha: linha.slice(0, separador),
        assunto: linha.slice(separador + 1),
      };
    })
    .filter((item): item is { sha: string; assunto: string } => item?.assunto === assuntoEsperado);

  if (candidatos.length !== 1) {
    throw new Error(
      `esperado um commit "${assuntoEsperado}", encontrados ${candidatos.length}`,
    );
  }
  return candidatos[0]!.sha;
}

/** Valida se uma tag ausente ou existente é coerente com o commit do release. */
export function estadoDaTag(
  releaseSha: string,
  tagSha: string | null,
  obrigatoria: boolean,
): "missing" | "current" {
  if (!tagSha) {
    if (obrigatoria) {
      throw new Error(`tag obrigatória ausente para o commit ${releaseSha}`);
    }
    return "missing";
  }
  if (tagSha !== releaseSha) {
    throw new Error(`tag aponta para ${tagSha}, mas o bump está em ${releaseSha}`);
  }
  return "current";
}

/** Uma versão nova só pode nascer se sua ref remota ainda não existir. */
export function exigirTagAlvoAusente(tagSha: string | null): "missing" {
  if (tagSha) {
    throw new Error(`tag da nova versão já existe e aponta para ${tagSha}`);
  }
  return "missing";
}

/** Extrai somente a ref exata do retorno prefixado de `matching-refs`. */
export function shaDaTagRemota(payload: unknown, versao: string): string | null {
  if (!Array.isArray(payload)) {
    throw new Error("resposta de matching-refs não é uma lista");
  }

  const refEsperada = `refs/tags/v${versao}`;
  const candidatas = payload.filter((item): item is { ref: string; object: { sha: string } } => {
    if (!item || typeof item !== "object") return false;
    const ref = Reflect.get(item, "ref");
    const objeto = Reflect.get(item, "object");
    return ref === refEsperada && Boolean(objeto) && typeof Reflect.get(objeto, "sha") === "string";
  });

  if (candidatas.length > 1) {
    throw new Error(`matching-refs devolveu ${candidatas.length} ocorrências para ${refEsperada}`);
  }
  return candidatas[0]?.object.sha ?? null;
}

export type ReleaseDocuments = {
  technical: string;
  ptBR: string;
  en: string;
};

export type PrepareReleaseResult =
  | { status: "prepared"; documents: ReleaseDocuments }
  | { status: "already-released"; documents: ReleaseDocuments };

export type ReleaseDomainErrorCode =
  | ChangelogIssueCode
  | "invalid_release_version"
  | "invalid_published_at"
  | "missing_unreleased"
  | "duplicate_unreleased"
  | "partial_existing_release";

export class ReleaseDomainError extends Error {
  readonly code: ReleaseDomainErrorCode;
  readonly locale?: ChangelogLocale;
  readonly version?: string;

  constructor(
    code: ReleaseDomainErrorCode,
    details: { locale?: ChangelogLocale; version?: string } = {},
  ) {
    const fields: string[] = [code];
    if (details.locale) fields.push(`locale=${details.locale}`);
    const version = details.version
      ?.replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, "?")
      .replace(/[^A-Za-z0-9._+-]/g, "?")
      .slice(0, 64);
    if (version) fields.push(`version=${version}`);
    super(fields.join(" "));
    this.name = "ReleaseDomainError";
    this.code = code;
    this.locale = details.locale;
    this.version = version;
  }
}

type UnreleasedSection = {
  body: string;
  bodyEnd: number;
  headerStart: number;
};

function isCanonicalUnreleased(section: ChangelogSection): boolean {
  return (
    section.token === "Unreleased" &&
    section.publication === undefined &&
    section.publicationSyntaxValid &&
    section.versionSyntaxValid
  );
}

function findUnreleased(markdown: string): UnreleasedSection {
  const structural = changelogSections(markdown).filter(
    (section) => section.token === "Unreleased",
  );
  const matches = structural.filter(isCanonicalUnreleased);
  if (structural.length === 0 || matches.length === 0) {
    throw new ReleaseDomainError("missing_unreleased");
  }
  if (structural.length > 1) throw new ReleaseDomainError("duplicate_unreleased");

  const match = matches[0]!;
  return {
    body: markdown.slice(match.bodyStart, match.bodyEnd),
    bodyEnd: match.bodyEnd,
    headerStart: match.index,
  };
}

function assertParseable(result: ChangelogParseResult, locale?: ChangelogLocale): void {
  const issue = result.issues[0];
  if (issue) {
    throw new ReleaseDomainError(issue.code, { locale, version: issue.version });
  }
}

function hasTarget(result: ChangelogParseResult, version: string): boolean {
  return (
    result.releases.some((release) => release.version === version) ||
    result.omitted.some((release) => release.version === version)
  );
}

function technicalPublication(markdown: string, version: string): string | null {
  const match = changelogSections(markdown).find(
    (section) =>
      section.versionSyntaxValid &&
      section.publicationSyntaxValid &&
      section.token === version,
  );
  return match?.publication ?? null;
}

function existingLocalizedPublication(
  result: ChangelogParseResult,
  version: string,
): Publication | null {
  const entry =
    result.releases.find((release) => release.version === version) ??
    result.omitted.find((release) => release.version === version);
  return entry?.publication ?? null;
}

function assertExistingRelease(
  documents: ReleaseDocuments,
  version: string,
  ptBR: ChangelogParseResult,
  en: ChangelogParseResult,
): void {
  assertParseable(ptBR, "pt-BR");
  assertParseable(en, "en");
  validateLocalizedChangelogs(ptBR, en);
  const technicalDate = technicalPublication(documents.technical, version);
  const ptPublication = existingLocalizedPublication(ptBR, version);
  const enPublication = existingLocalizedPublication(en, version);
  const localizedDate = ptPublication?.kind === "instant"
    ? ptPublication.value.slice(0, 10)
    : ptPublication?.value;
  if (
    !technicalDate ||
    !ptPublication ||
    !enPublication ||
    ptPublication.kind !== enPublication.kind ||
    ptPublication.value !== enPublication.value ||
    technicalDate !== localizedDate
  ) {
    throw new ChangelogDomainError("localized_publication_mismatch", { version });
  }
}

function stampVisible(
  markdown: string,
  section: UnreleasedSection,
  version: string,
  publication: string,
): string {
  const replacement = `## [Unreleased]\n\n## [${version}] - ${publication}${section.body}`;
  return `${markdown.slice(0, section.headerStart)}${replacement}${markdown.slice(section.bodyEnd)}`;
}

function stampOmitted(
  markdown: string,
  section: UnreleasedSection,
  version: string,
  publication: string,
): string {
  const replacement = `<!-- sem-nota-usuario: ${version} - ${publication} -->\n\n## [Unreleased]\n\n`;
  return `${markdown.slice(0, section.headerStart)}${replacement}${markdown.slice(section.bodyEnd)}`;
}

/**
 * Prepare all release artifacts as one pure value. The caller writes only a
 * successful result, so rejected input cannot expose a partial locale.
 */
export function prepareRelease(input: {
  documents: ReleaseDocuments;
  version: string;
  publishedAt: Date;
}): PrepareReleaseResult {
  if (!versaoSemanticaValida(input.version)) {
    throw new ReleaseDomainError("invalid_release_version", { version: input.version });
  }
  if (Number.isNaN(input.publishedAt.getTime())) {
    throw new ReleaseDomainError("invalid_published_at", { version: input.version });
  }

  const technicalBefore = parseUserChangelog(input.documents.technical);
  const ptBefore = parseUserChangelog(input.documents.ptBR);
  const enBefore = parseUserChangelog(input.documents.en);
  assertParseable(technicalBefore);
  assertParseable(ptBefore, "pt-BR");
  assertParseable(enBefore, "en");
  const targetPresence = [
    changelogTemVersao(input.documents.technical, input.version),
    hasTarget(ptBefore, input.version),
    hasTarget(enBefore, input.version),
  ];
  const presentCount = targetPresence.filter(Boolean).length;
  if (presentCount > 0 && presentCount < targetPresence.length) {
    throw new ReleaseDomainError("partial_existing_release", { version: input.version });
  }
  if (presentCount === targetPresence.length) {
    assertExistingRelease(input.documents, input.version, ptBefore, enBefore);
    return { status: "already-released", documents: input.documents };
  }

  validateLocalizedChangelogs(ptBefore, enBefore);

  const technicalSection = findUnreleased(input.documents.technical);
  const ptSection = findUnreleased(input.documents.ptBR);
  const enSection = findUnreleased(input.documents.en);
  const ptNoUserChange =
    hasNoUserChangeMarker(ptSection.body) && !bodyHasUserContent(ptSection.body);
  const enNoUserChange =
    hasNoUserChangeMarker(enSection.body) && !bodyHasUserContent(enSection.body);
  if (ptNoUserChange !== enNoUserChange) {
    throw new ChangelogDomainError("localized_visibility_mismatch", { version: input.version });
  }
  if (!ptNoUserChange && !bodyHasUserContent(ptSection.body)) {
    throw new ChangelogDomainError("localized_content_missing", {
      locale: "pt-BR",
      version: input.version,
    });
  }
  if (!enNoUserChange && !bodyHasUserContent(enSection.body)) {
    throw new ChangelogDomainError("localized_content_missing", {
      locale: "en",
      version: input.version,
    });
  }

  const instant = input.publishedAt.toISOString();
  const date = instant.slice(0, 10);
  const technical = stampVisible(
    input.documents.technical,
    technicalSection,
    input.version,
    date,
  );
  const ptBR = ptNoUserChange
    ? stampOmitted(input.documents.ptBR, ptSection, input.version, instant)
    : stampVisible(input.documents.ptBR, ptSection, input.version, instant);
  const en = enNoUserChange
    ? stampOmitted(input.documents.en, enSection, input.version, instant)
    : stampVisible(input.documents.en, enSection, input.version, instant);
  const candidate = { technical, ptBR, en };
  const technicalAfter = parseUserChangelog(technical);
  const ptAfter = parseUserChangelog(ptBR);
  const enAfter = parseUserChangelog(en);
  assertParseable(technicalAfter);
  assertParseable(ptAfter, "pt-BR");
  assertParseable(enAfter, "en");
  validateLocalizedChangelogs(ptAfter, enAfter);
  if (
    !changelogTemVersao(technical, input.version) ||
    !hasTarget(ptAfter, input.version) ||
    !hasTarget(enAfter, input.version)
  ) {
    throw new ReleaseDomainError("partial_existing_release", { version: input.version });
  }

  return { status: "prepared", documents: candidate };
}
