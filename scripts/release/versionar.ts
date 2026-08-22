/**
 * Orquestração do versionamento — o shell que decide o bump e grava os arquivos.
 *
 * O NÚCLEO puro fica em `src/core/release.ts`, testável sem disco nem git. Aqui
 * mora só a fiação: ler os commits desde a última tag, ler/gravar `package.json`
 * e os dois changelogs, e imprimir a versão nova para quem chamou.
 *
 * Rodado pelo workflow de promoção (`promover-para-staging.yml`) — o ponto
 * serializado do fluxo — e pelo `sincronizar-apos-main.yml` quando um hotfix
 * nasce direto em `main` sem passar pelo caminho normal.
 *
 * ## Por que um script e não um passo inline no YAML
 *
 * A regra que mais quebra (classificar o commit e carimbar o changelog) precisa
 * de teste. YAML não tem teste; uma função pura tem. O workflow chama isto aqui,
 * e os casos vivem em `tests/release.test.ts`.
 *
 * ## Saída
 *
 * Imprime a versão nova (ex.: `1.1.0`) quando houve bump, ou `no-release` quando
 * a leva de commits não pede número novo. Sai com código 0 nos dois casos; só
 * falha (código 1) quando encontra estado que não deveria promover — changelog
 * sem `[Unreleased]`, `package.json` com versão torta.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  carimbarUnreleased,
  changelogTemVersao,
  classificarBump,
  proximaVersao,
} from "../../src/core/release.ts";

// A ref que está sendo promovida (ex.: `origin/dev`), passada como argumento.
// Default `HEAD` cobre o uso local, sem remote.
const base = process.argv[2] ?? "HEAD";

/** Assuntos dos commits desde a última tag `v*` até a ref base. */
function assuntosDesdeUltimaTag(): string[] {
  const ultimaTag = tagMaisRecente();
  const range = ultimaTag ? `${ultimaTag}..${base}` : base;
  try {
    // `--no-merges` é obrigatório: o commit de merge ("Merge pull request
    // #N") não tem prefixo convencional e cairia no fallback de patch — cada
    // promoção staging→main bumpearia uma versão fantasma, em loop. Merge é
    // invólucro, não mudança; o que muda são os commits que ele reúne, e esses
    // já estão no range por si sós.
    return execFileSync("git", ["log", "--format=%s", "--no-merges", range], {
      encoding: "utf8",
    })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function tagMaisRecente(): string | null {
  try {
    const saida = execFileSync(
      "git",
      ["tag", "--list", "v*", "--sort=-version:refname"],
      { encoding: "utf8" },
    ).trim();
    return saida.split("\n").filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
}

function lerPkg(): { version: string } {
  return JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
}

function gravarPkg(versao: string): void {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    version: string;
  };
  pkg.version = versao;
  writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
}

/** `2026-08-21`, em UTC — a mesma fonte que o `carimbarUnreleased` imprime. */
function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

function main(): void {
  const tipo = classificarBump(assuntosDesdeUltimaTag());
  if (!tipo) {
    console.log("no-release");
    return;
  }

  const atual = lerPkg().version;
  const versao = proximaVersao(atual, tipo);

  // Idempotência: se a versão já foi publicada (re-run do workflow), não
  // carimbar de novo — o `[Unreleased]` já virou `[x.y.z]` e não há mais
  // cabeçalho para substituir. Bump já feito = nada a fazer.
  if (changelogTemVersao(readFileSync("CHANGELOG.md", "utf8"), versao)) {
    console.log("already-released");
    return;
  }

  for (const arquivo of ["CHANGELOG.md", "USER_CHANGELOG.md"]) {
    const conteudo = readFileSync(arquivo, "utf8");
    writeFileSync(arquivo, carimbarUnreleased(conteudo, versao, hoje()));
  }

  gravarPkg(versao);

  // Coerência final: depois de gravar, a versão tem de estar no changelog
  // técnico — o gate que impede release mudo.
  const tecnico = readFileSync("CHANGELOG.md", "utf8");
  if (!changelogTemVersao(tecnico, versao)) {
    throw new Error(`CHANGELOG.md não tem a entrada [${versao}] após o bump`);
  }

  console.log(versao);
}

main();
