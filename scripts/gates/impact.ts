// Classes de impacto → gates locais (G57, #320). O mapa mora em
// `config/validation-impact.json`; aqui só a validação (que falha fechado) e o
// plano. Funções puras: recebem o JSON já lido e a lista de caminhos do diff,
// devolvem os gates, na ordem declarada, com os caminhos que exigiram cada um.
//
// Um caminho casa com TODAS as classes cujos padrões o aceitam, e o plano é a
// união dos gates: um arquivo de `app/p/` é tela e é perfil público, e precisa
// dos gates dos dois. Caminho que nenhuma classe reconhece recebe o pacote
// completo — o mapa nunca decide "nada a validar" por não conhecer o arquivo.

/** Na lista de gates de uma classe, pede o pacote completo. */
export const FULL = "full";

export type GateSpec = {
  description: string;
  command: string[];
  /** Recebe no fim do comando os arquivos alterados que pediram o gate. */
  appendFiles?: boolean;
  /** Gates que este cobre por inteiro: presentes os dois, o coberto sai do plano. */
  satisfies?: string[];
};

export type ImpactClass = {
  id: string;
  description: string;
  patterns: string[];
  exclude?: string[];
  /** Palavra no caminho que classifica mesmo sem padrão (`session-store.ts`). */
  pathWords?: string[];
  gates: string[];
};

export type ImpactMap = {
  schemaVersion: 1;
  mapVersion: string;
  unknownPaths: "full";
  fullPackage: string[];
  classes: ImpactClass[];
  gates: Record<string, GateSpec>;
};

export type PathImpact = { path: string; classes: string[] };

export type PlannedGate = {
  id: string;
  description: string;
  command: string[];
  appendFiles: boolean;
  /** Classes (ou `desconhecido`) que exigiram o gate. */
  reasons: string[];
  /** Caminhos do diff que exigiram o gate. */
  files: string[];
};

export type Plan = {
  mapVersion: string;
  paths: PathImpact[];
  /** Caminhos sem classe: cada um puxou o pacote completo. */
  unknown: string[];
  gates: PlannedGate[];
};

export const UNKNOWN_REASON = "desconhecido";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lista não vazia de strings não vazias. */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item !== "");
}

/**
 * O mesmo tradutor de glob de `.claude/skills/deep-review/scripts/_common.py`:
 * `**` atravessa diretórios, `*` e `?` não. As duas tabelas de caminho do
 * repositório (nível de revisão e gates) precisam ler o mesmo padrão do mesmo
 * jeito, ou a coerência entre elas vira coincidência.
 */
export function globToRegex(pattern: string): RegExp {
  let out = "";
  for (let index = 0; index < pattern.length; ) {
    const char = pattern[index]!;
    if (char === "*") {
      if (pattern.startsWith("**/", index)) {
        out += "(?:.*/)?";
        index += 3;
      } else if (pattern.startsWith("**", index)) {
        out += ".*";
        index += 2;
      } else {
        out += "[^/]*";
        index += 1;
      }
    } else if (char === "?") {
      out += "[^/]";
      index += 1;
    } else {
      out += char.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
      index += 1;
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Palavra delimitada por `/`, `_`, `.`, `-` ou borda — a mesma expressão de
 * `L2_WORDS` em `review_level.py`. `impersonat*` vira prefixo (`\w*`).
 */
export function pathWordsSource(words: readonly string[]): string {
  const alternatives = words.map((word) => (word.endsWith("*") ? `${word.slice(0, -1)}\\w*` : word));
  return `(?:^|[/_.-])(${alternatives.join("|")})(?:$|[/_.-])`;
}

/**
 * Valida o mapa inteiro e devolve a versão tipada. Qualquer lacuna — gate sem
 * comando, classe que pede gate inexistente, pacote completo vazio, política
 * de caminho desconhecido diferente de `full` — lança: mapa inválido não pode
 * virar "nenhum gate".
 */
export function validateImpactMap(raw: unknown): ImpactMap {
  if (!isRecord(raw)) throw new Error("validation-impact: o mapa precisa ser um objeto");
  if (raw.schemaVersion !== 1) throw new Error("validation-impact: schemaVersion precisa ser 1");
  if (typeof raw.mapVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(raw.mapVersion)) {
    throw new Error("validation-impact: mapVersion precisa ser SemVer (x.y.z)");
  }
  if (raw.unknownPaths !== "full") {
    throw new Error("validation-impact: unknownPaths precisa ser \"full\" — caminho desconhecido recebe o pacote completo");
  }
  if (!isRecord(raw.gates) || Object.keys(raw.gates).length === 0) throw new Error("validation-impact: gates ausentes");
  const gates: Record<string, GateSpec> = {};
  for (const [id, spec] of Object.entries(raw.gates)) {
    if (id === FULL) throw new Error(`validation-impact: "${FULL}" é reservado e não pode nomear um gate`);
    if (!isRecord(spec)) throw new Error(`validation-impact: gate ${id} inválido`);
    if (typeof spec.description !== "string" || spec.description === "") throw new Error(`validation-impact: gate ${id} sem descrição`);
    if (!isStringList(spec.command)) throw new Error(`validation-impact: gate ${id} sem comando`);
    if (spec.appendFiles !== undefined && typeof spec.appendFiles !== "boolean") {
      throw new Error(`validation-impact: appendFiles do gate ${id} precisa ser booleano`);
    }
    if (spec.satisfies !== undefined && !isStringList(spec.satisfies)) {
      throw new Error(`validation-impact: satisfies do gate ${id} inválido`);
    }
    gates[id] = {
      description: spec.description,
      command: [...spec.command],
      ...(spec.appendFiles === undefined ? {} : { appendFiles: spec.appendFiles }),
      ...(spec.satisfies === undefined ? {} : { satisfies: [...spec.satisfies] }),
    };
  }
  for (const [id, spec] of Object.entries(gates)) {
    for (const covered of spec.satisfies ?? []) {
      if (!(covered in gates)) throw new Error(`validation-impact: gate ${id} satisfaz gate inexistente ${covered}`);
      if (covered === id) throw new Error(`validation-impact: gate ${id} não pode satisfazer a si mesmo`);
    }
  }
  if (!isStringList(raw.fullPackage)) throw new Error("validation-impact: fullPackage ausente ou vazio");
  for (const gate of raw.fullPackage) {
    if (!(gate in gates)) throw new Error(`validation-impact: fullPackage cita gate inexistente ${gate}`);
  }
  if (!Array.isArray(raw.classes) || raw.classes.length === 0) throw new Error("validation-impact: classes ausentes");
  const ids = new Set<string>();
  const classes = raw.classes.map((item: unknown): ImpactClass => {
    if (!isRecord(item) || typeof item.id !== "string" || item.id === "") throw new Error("validation-impact: classe sem id");
    const id = item.id;
    if (ids.has(id)) throw new Error(`validation-impact: classe duplicada ${id}`);
    ids.add(id);
    if (typeof item.description !== "string" || item.description === "") throw new Error(`validation-impact: classe ${id} sem descrição`);
    if (!isStringList(item.patterns)) throw new Error(`validation-impact: classe ${id} sem padrões`);
    if (item.exclude !== undefined && !isStringList(item.exclude)) throw new Error(`validation-impact: exclude da classe ${id} inválido`);
    if (item.pathWords !== undefined) {
      if (!isStringList(item.pathWords) || !item.pathWords.every((word) => /^[a-z]+\*?$/i.test(word))) {
        throw new Error(`validation-impact: pathWords da classe ${id} inválido`);
      }
    }
    if (!isStringList(item.gates)) throw new Error(`validation-impact: classe ${id} sem gates`);
    for (const gate of item.gates) {
      if (gate !== FULL && !(gate in gates)) throw new Error(`validation-impact: classe ${id} cita gate inexistente ${gate}`);
    }
    return {
      id,
      description: item.description,
      patterns: [...item.patterns],
      ...(item.exclude === undefined ? {} : { exclude: [...item.exclude] }),
      ...(item.pathWords === undefined ? {} : { pathWords: [...item.pathWords] }),
      gates: [...item.gates],
    };
  });
  return {
    schemaVersion: 1,
    mapVersion: raw.mapVersion,
    unknownPaths: "full",
    fullPackage: [...raw.fullPackage],
    classes,
    gates,
  };
}

/** Caminho relativo à raiz, com `/`. Absoluto ou com `..` não é caminho do diff. */
export function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (normalized === "" || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`validation-impact: caminho fora do repositório: ${path}`);
  }
  return normalized;
}

function classMatches(klass: ImpactClass, path: string): boolean {
  if ((klass.exclude ?? []).some((pattern) => globToRegex(pattern).test(path))) return false;
  if (klass.patterns.some((pattern) => globToRegex(pattern).test(path))) return true;
  return klass.pathWords !== undefined && new RegExp(pathWordsSource(klass.pathWords), "i").test(path);
}

/** Classes que reconhecem o caminho, na ordem do mapa. Vazio = desconhecido. */
export function classifyPath(map: ImpactMap, path: string): string[] {
  const normalized = normalizePath(path);
  return map.classes.filter((klass) => classMatches(klass, normalized)).map((klass) => klass.id);
}

/**
 * O plano de gates para um conjunto de caminhos. Diff vazio não pede gate
 * nenhum; qualquer caminho desconhecido pede o pacote completo inteiro.
 */
export function planGates(map: ImpactMap, paths: readonly string[]): Plan {
  const unique = [...new Set(paths.map(normalizePath))].sort();
  const byGate = new Map<string, { reasons: Set<string>; files: Set<string> }>();
  const need = (gate: string, reason: string, file: string) => {
    const entry = byGate.get(gate) ?? { reasons: new Set<string>(), files: new Set<string>() };
    entry.reasons.add(reason);
    entry.files.add(file);
    byGate.set(gate, entry);
  };
  const impacts: PathImpact[] = [];
  const unknown: string[] = [];
  for (const path of unique) {
    const classes = classifyPath(map, path);
    impacts.push({ path, classes });
    if (classes.length === 0) {
      unknown.push(path);
      for (const gate of map.fullPackage) need(gate, UNKNOWN_REASON, path);
      continue;
    }
    for (const id of classes) {
      const klass = map.classes.find((item) => item.id === id)!;
      for (const gate of klass.gates) {
        for (const expanded of gate === FULL ? map.fullPackage : [gate]) need(expanded, id, path);
      }
    }
  }
  const satisfied = new Set<string>();
  for (const gate of byGate.keys()) for (const covered of map.gates[gate]!.satisfies ?? []) satisfied.add(covered);
  const gates = Object.keys(map.gates)
    .filter((gate) => byGate.has(gate) && !satisfied.has(gate))
    .map((gate): PlannedGate => {
      const spec = map.gates[gate]!;
      const entry = byGate.get(gate)!;
      return {
        id: gate,
        description: spec.description,
        command: [...spec.command],
        appendFiles: spec.appendFiles === true,
        reasons: [...entry.reasons].sort(),
        files: [...entry.files].sort(),
      };
    });
  return { mapVersion: map.mapVersion, paths: impacts, unknown, gates };
}

/**
 * Testes que citam literalmente um dos caminhos alterados. `vitest related`
 * segue só o grafo de import, e boa parte dos testes de ferramenta executa o
 * script por caminho (`spawnSync("node", ["scripts/…"])`) sem importá-lo.
 */
export function testsMentioning(sources: Readonly<Record<string, string>>, files: readonly string[]): string[] {
  return Object.entries(sources)
    .filter(([test, source]) => files.some((file) => file !== test && source.includes(file)))
    .map(([test]) => test)
    .sort();
}

/** Resumo legível do plano, uma linha por gate. */
export function renderPlan(plan: Plan): string {
  if (plan.gates.length === 0) return "gates: nenhum caminho alterado — nada a validar.";
  const lines = [`gates (mapa ${plan.mapVersion}, ${plan.paths.length} caminho(s)):`];
  for (const gate of plan.gates) lines.push(`  ${gate.id} — ${gate.description} [${gate.reasons.join(", ")}]`);
  if (plan.unknown.length > 0) {
    lines.push(`caminho(s) sem classe em config/validation-impact.json → pacote completo:`);
    for (const path of plan.unknown) lines.push(`  ${path}`);
  }
  return lines.join("\n");
}
