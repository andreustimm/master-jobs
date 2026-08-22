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
 * O bump é decidido no `dev → staging` — o único ponto do fluxo que é
 * serializado (concurrency do workflow de promoção). Uma promoção = uma versão,
 * cobrindo todos os commits desde a última tag. A classificação vem do tipo de
 * commit: `fix:` → patch, `feat:` → minor, `BREAKING CHANGE` → major. O maior
 * vence entre os commits da leva.
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

function tipoDoAssunto(assunto: string): TipoBump | null {
  const linha = assunto.trim();
  if (linha === "") return null;

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
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(atual.trim());
  if (!m) throw new Error(`versão inválida no package.json: "${atual}"`);

  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (tipo === "major") return `${major + 1}.0.0`;
  if (tipo === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Carimba a seção `## [Unreleased]` de um changelog com a versão e a data.
 *
 * Só aceita uma ocorrência — zero é "ninguém escreveu a entrada" e mais de uma
 * é "alguém duplicou o cabeçalho"; ambos são estado que deve falhar a promoção,
 * não passar em silêncio. O texto da seção fica intacto: o que muda é o
 * cabeçalho, de `## [Unreleased]` para `## [1.1.0] - 2026-08-21`.
 */
export function carimbarUnreleased(
  markdown: string,
  versao: string,
  data: string,
): string {
  const cabecalho = /^##\s*\[Unreleased\]\s*$/gm;
  const ocorrencias = markdown.match(cabecalho)?.length ?? 0;

  if (ocorrencias === 0) {
    throw new Error("changelog sem seção ## [Unreleased] — escreva a entrada antes de promover");
  }
  if (ocorrencias > 1) {
    throw new Error("changelog com mais de uma seção ## [Unreleased]");
  }

  return markdown.replace(cabecalho, `## [${versao}] - ${data}`);
}

/**
 * Garante que um changelog tem a entrada da versão publicada.
 *
 * É o gate de coerência do `package.json` com o changelog: bump sem entrada é
 * release mudo, e entrada sem bump é texto que ninguém vê. O regex aceita
 * `## [1.1.0]` e `## [1.1.0] - 2026-08-21`.
 */
export function changelogTemVersao(markdown: string, versao: string): boolean {
  const re = new RegExp(`^##\\s*\\[${versao.replace(/\./g, "\\.")}\\]`, "m");
  return re.test(markdown);
}
