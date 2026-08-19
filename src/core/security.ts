/**
 * Self-checks for the risks that actually apply to this system.
 *
 * Not a scanner. Four specific mistakes, each of which has either already
 * happened here or is one careless commit away:
 *
 *  1. Serving the dashboard to the local network. It has no authentication and
 *     serves the CV and the funnel; `next dev` binds to every interface unless
 *     told otherwise. This was live until it was found.
 *  2. Publishing personal contact details. `profile.yaml` is versioned and
 *     holds a phone number — harmless while the repo is private, permanent the
 *     moment it is not, because Git keeps history.
 *  3. Committing a secret or the database.
 *  4. A world-readable database file.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export type Finding = {
  level: "critical" | "warning" | "ok";
  title: string;
  detail: string;
  fix?: string;
};

const PII_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "telefone", re: /\+\d{2}\s*\(?\d{2}\)?\s*\d{4,5}-?\d{4}/ },
  { label: "e-mail pessoal", re: /[\w.+-]+@(?:gmail|hotmail|outlook|yahoo|icloud)\.com/i },
];

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** Does the dev/start script pin the server to loopback? */
export function checkBinding(packageJson: string): Finding {
  let scripts: Record<string, string> = {};
  try {
    scripts = (JSON.parse(packageJson).scripts ?? {}) as Record<string, string>;
  } catch {
    return { level: "warning", title: "Bind do servidor", detail: "package.json ilegível." };
  }

  const offenders = (["dev", "start"] as const).filter(
    (name) => scripts[name] && !/--hostname\s+(127\.0\.0\.1|localhost)/.test(scripts[name]!),
  );

  if (offenders.length > 0) {
    return {
      level: "critical",
      title: "Dashboard exposto na rede",
      detail:
        `O script ${offenders.map((o) => `\`${o}\``).join(" e ")} não fixa o host. ` +
        `Next faz bind em 0.0.0.0, e o dashboard não tem autenticação: qualquer ` +
        `pessoa na mesma rede lê o CV e altera o funil.`,
      fix: "Acrescente --hostname 127.0.0.1 ao script.",
    };
  }
  return { level: "ok", title: "Bind do servidor", detail: "dev e start presos a 127.0.0.1." };
}

/** Personal contact details inside a versioned file. */
export function checkPii(files: Array<{ path: string; content: string }>): Finding {
  const hits: string[] = [];
  for (const file of files) {
    for (const { label, re } of PII_PATTERNS) {
      if (re.test(file.content)) hits.push(`${file.path} (${label})`);
    }
  }
  if (hits.length === 0) {
    return { level: "ok", title: "Dado pessoal versionado", detail: "Nada encontrado." };
  }
  return {
    level: "warning",
    title: "Dado pessoal versionado",
    detail:
      `Contato pessoal em arquivo sob versionamento: ${hits.join(", ")}. ` +
      `Inofensivo enquanto o repositório for privado — permanente se deixar de ser, ` +
      `porque o Git guarda o histórico.`,
    fix: "Antes de criar repositório remoto: mova o contato para .env, ou garanta o repositório privado.",
  };
}

export function checkIgnored(gitignore: string): Finding {
  const required = ["data/", ".env", "out/"];
  const missing = required.filter((entry) => !gitignore.includes(entry));
  if (missing.length > 0) {
    return {
      level: "critical",
      title: ".gitignore incompleto",
      detail: `Sem entrada para: ${missing.join(", ")}. O banco guarda todo o histórico de candidaturas.`,
      fix: `Acrescente ${missing.join(", ")} ao .gitignore.`,
    };
  }
  return { level: "ok", title: ".gitignore", detail: "Banco, segredos e kits gerados ignorados." };
}

export function checkDbPermissions(mode: number | null): Finding {
  if (mode === null) {
    return { level: "ok", title: "Permissões do banco", detail: "Banco ainda não criado." };
  }
  // Anything readable by group or other exposes the whole application history
  // to every account on the machine.
  if ((mode & 0o077) !== 0) {
    return {
      level: "warning",
      title: "Permissões do banco",
      detail: `data/jobs.db está ${(mode & 0o777).toString(8)} — legível além do seu usuário.`,
      fix: "chmod 600 data/jobs.db",
    };
  }
  return { level: "ok", title: "Permissões do banco", detail: "Só o seu usuário lê o banco." };
}

export async function runSecurityCheck(root = process.cwd()): Promise<Finding[]> {
  const [pkg, gitignore, profile] = await Promise.all([
    readIfPresent(join(root, "package.json")),
    readIfPresent(join(root, ".gitignore")),
    readIfPresent(join(root, "profile/profile.yaml")),
  ]);

  let mode: number | null = null;
  try {
    mode = (await stat(join(root, "data/jobs.db"))).mode;
  } catch {
    mode = null;
  }

  const versioned = profile === null ? [] : [{ path: "profile/profile.yaml", content: profile }];

  return [
    checkBinding(pkg ?? "{}"),
    checkIgnored(gitignore ?? ""),
    checkPii(versioned),
    checkDbPermissions(mode),
  ];
}
