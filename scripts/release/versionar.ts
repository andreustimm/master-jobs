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
  releasePrecisaRetomarTag,
  todosChangelogsTemVersao,
} from "../../src/core/release.ts";

// A ref que está sendo promovida (ex.: `origin/dev`), passada como argumento.
// Default `HEAD` cobre o uso local, sem remote.
const base = process.argv[2] ?? "HEAD";
const ARQUIVOS_CHANGELOG = ["CHANGELOG.md", "USER_CHANGELOG.md"] as const;

/** Assuntos dos commits desde a última tag `v*` até a ref base. */
function assuntosDesdeUltimaTag(): string[] {
  const ultimaTag = tagMaisRecente();
  const range = ultimaTag ? `${ultimaTag}..${base}` : base;
  try {
    return execFileSync("git", ["log", "--format=%s", range], { encoding: "utf8" })
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

function tagExiste(versao: string): boolean {
  try {
    return execFileSync("git", ["tag", "--list", `v${versao}`], { encoding: "utf8" }).trim() !== "";
  } catch {
    return false;
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
  const changelogs = ARQUIVOS_CHANGELOG.map((arquivo) => ({
    arquivo,
    conteudo: readFileSync(arquivo, "utf8"),
  }));

  // O commit do bump chega ao remoto antes da tag. Se a API da tag falhar,
  // o retry encontra package e changelogs já avançados, mas ainda sem vX.Y.Z.
  // Retomar esse mesmo release evita transformar a seção vazia recém-aberta
  // numa segunda versão sem notas.
  if (releasePrecisaRetomarTag(
    changelogs.map(({ conteudo }) => conteudo),
    atual,
    tagExiste(atual),
  )) {
    console.log("already-released");
    return;
  }

  const versao = proximaVersao(atual, tipo);

  if (todosChangelogsTemVersao(changelogs.map(({ conteudo }) => conteudo), versao)) {
    throw new Error(
      `changelogs já contêm [${versao}], mas package.json ainda declara ${atual}`,
    );
  }

  // Calcula os dois resultados antes da primeira escrita. Se um arquivo estiver
  // inválido, o processo falha sem deixar os changelogs em versões diferentes.
  const data = hoje();
  const carimbados = changelogs.map(({ arquivo, conteudo }) => ({
    arquivo,
    conteudo: carimbarUnreleased(conteudo, versao, data),
  }));
  for (const { arquivo, conteudo } of carimbados) {
    writeFileSync(arquivo, conteudo);
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
