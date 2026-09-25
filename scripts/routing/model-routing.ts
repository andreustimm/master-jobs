// Roteador de papel × complexidade × modo de assinatura → modelo e effort
// (G86, G87, #318). A política mora em `config/model-routing.json`; aqui só a
// validação (que falha fechado) e a resolução.
//
// Funções puras: recebem o JSON já lido, devolvem a rota ou lançam.

export const ROLES = ["analyst", "executor", "fixer", "reviewer", "judge"] as const;
export const COMPLEXITIES = ["low", "medium", "high"] as const;
export const MODES = ["claude_only", "codex_only", "multi_provider"] as const;
export const HARNESSES = ["claude", "codex", "opencode"] as const;

/**
 * Apelidos que o Agent tool do Claude Code aceita no campo `model`: ele não
 * recebe o ID completo nem effort por chamada (o effort vem do frontmatter do
 * agente). Todo modelo do provedor do Claude Code precisa de um apelido.
 */
export const CLAUDE_AGENT_ALIASES = ["opus", "sonnet", "haiku", "fable"] as const;

/** Modos de um harness só e o harness que eles permitem. */
const SINGLE_HARNESS_MODES: Partial<Record<Mode, Harness>> = {
  claude_only: "claude",
  codex_only: "codex",
};

export type Role = (typeof ROLES)[number];
export type Complexity = (typeof COMPLEXITIES)[number];
export type Mode = (typeof MODES)[number];
export type Harness = (typeof HARNESSES)[number];

export type Candidate = { model: string; effort: string | null };
export type Provider = {
  harness: Harness;
  efforts: string[];
  /** Só no provedor do Claude Code: ID do modelo → apelido do Agent tool. */
  agentAliases?: Record<string, string>;
  roles: Record<Role, Record<Complexity, Candidate[]>>;
};
export type Routing = {
  schemaVersion: 1;
  subscriptionMode: Mode;
  modes: Record<Mode, string[]>;
  providers: Record<string, Provider>;
};

export type Route = {
  mode: Mode;
  role: Role;
  complexity: Complexity;
  provider: string;
  harness: Harness;
  model: string;
  effort: string | null;
  /**
   * O que vai no campo de modelo da chamada de delegação do harness: no Claude
   * Code, o apelido do Agent tool (`opus`…); nos outros, o próprio `model`.
   */
  agentModel: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/**
 * Valida a política inteira e devolve a versão tipada. Qualquer lacuna —
 * modo ausente ou desconhecido, papel sem célula, effort que o provedor não
 * aceita, juiz sem alternativa — reprova: uma rota que "quase" resolve cairia
 * no padrão de algum harness, e esse padrão não é decisão de ninguém.
 */
export function validateRouting(raw: unknown): Routing {
  const errors: string[] = [];
  if (!isRecord(raw)) throw new Error("model-routing: o arquivo precisa ser um objeto");
  if (raw.schemaVersion !== 1) errors.push(`schemaVersion ${String(raw.schemaVersion)} não suportado (esperado 1)`);
  if (!oneOf(raw.subscriptionMode, MODES)) {
    errors.push(`subscriptionMode "${String(raw.subscriptionMode)}" ausente ou desconhecido (aceitos: ${MODES.join(", ")})`);
  }

  const providers = isRecord(raw.providers) ? raw.providers : {};
  if (!isRecord(raw.providers)) errors.push("providers ausente");
  const owner = new Map<string, string>();
  for (const [name, value] of Object.entries(providers)) {
    if (!isRecord(value)) {
      errors.push(`providers.${name}: precisa ser um objeto`);
      continue;
    }
    if (!oneOf(value.harness, HARNESSES)) errors.push(`providers.${name}.harness desconhecido`);
    const efforts = Array.isArray(value.efforts) ? value.efforts : null;
    if (!efforts || !efforts.every((effort) => typeof effort === "string")) {
      errors.push(`providers.${name}.efforts precisa ser lista de texto`);
    }
    const roles = isRecord(value.roles) ? value.roles : {};
    const models = new Set<string>();
    for (const role of ROLES) {
      const cells = isRecord(roles[role]) ? roles[role] : null;
      if (!cells) {
        errors.push(`providers.${name}.roles.${role} ausente`);
        continue;
      }
      for (const complexity of COMPLEXITIES) {
        const where = `providers.${name}.roles.${role}.${complexity}`;
        const list = cells[complexity];
        if (!Array.isArray(list) || list.length === 0) {
          errors.push(`${where}: sem candidato`);
          continue;
        }
        for (const candidate of list) {
          if (!isRecord(candidate) || typeof candidate.model !== "string" || candidate.model === "") {
            errors.push(`${where}: candidato sem model`);
            continue;
          }
          models.add(candidate.model);
          const previous = owner.get(candidate.model);
          if (previous && previous !== name) errors.push(`${where}: ${candidate.model} já pertence a ${previous}`);
          owner.set(candidate.model, name);
          const effort = candidate.effort;
          const accepted = efforts ?? [];
          if (accepted.length === 0 ? effort !== null : !accepted.includes(effort as string)) {
            errors.push(`${where}: effort ${JSON.stringify(effort)} fora de [${accepted.join(", ")}]${accepted.length === 0 ? " (use null)" : ""}`);
          }
        }
        const named = list.filter((candidate) => isRecord(candidate) && typeof candidate.model === "string");
        if (role === "judge" && new Set(named.map((candidate) => (candidate as Candidate).model)).size < 2) {
          // Com um modelo só, o juiz coincide com o autor sempre que o autor
          // for esse modelo — e o modo de um provedor só não teria saída.
          errors.push(`${where}: o juiz precisa de pelo menos dois modelos distintos`);
        }
      }
    }
    // Executor e corretor podem ser modelos diferentes no mesmo delta; se todo
    // candidato a juiz também escreve, dois autores do mesmo provedor deixam
    // um modo de provedor único sem juiz. Um candidato que nunca escreve fecha
    // o caso para qualquer combinação de autores.
    const writers = new Set(
      (["executor", "fixer"] as const).flatMap((role) =>
        COMPLEXITIES.flatMap((complexity) => {
          const list = isRecord(roles[role]) ? (roles[role] as Record<string, unknown>)[complexity] : [];
          return Array.isArray(list) ? list.filter(isRecord).map((candidate) => candidate.model) : [];
        }),
      ),
    );
    const judges = isRecord(roles.judge) ? roles.judge : {};
    for (const complexity of COMPLEXITIES) {
      const list = Array.isArray(judges[complexity]) ? (judges[complexity] as unknown[]).filter(isRecord) : [];
      if (list.length > 0 && list.every((candidate) => writers.has(candidate.model))) {
        errors.push(`providers.${name}.roles.judge.${complexity}: precisa de um candidato que não seja executor nem corretor`);
      }
    }
    if (value.harness === "claude") {
      const aliases = isRecord(value.agentAliases) ? value.agentAliases : {};
      for (const model of models) {
        if (!oneOf(aliases[model], CLAUDE_AGENT_ALIASES)) {
          errors.push(`providers.${name}.agentAliases: ${model} sem apelido do Agent tool (${CLAUDE_AGENT_ALIASES.join(", ")})`);
        }
      }
    } else if (value.agentAliases !== undefined) {
      errors.push(`providers.${name}.agentAliases: só o provedor do Claude Code usa apelido`);
    }
  }

  const modes = isRecord(raw.modes) ? raw.modes : {};
  if (!isRecord(raw.modes)) errors.push("modes ausente");
  for (const mode of MODES) {
    const ladder = modes[mode];
    if (!Array.isArray(ladder) || ladder.length === 0) {
      errors.push(`modes.${mode}: ladder de provedores ausente`);
      continue;
    }
    for (const provider of ladder) {
      if (typeof provider !== "string" || !(provider in providers)) {
        errors.push(`modes.${mode}: provedor ${String(provider)} desconhecido`);
        continue;
      }
      // O nome do modo é a promessa: `claude_only` nunca despacha fora do
      // Claude Code, por mais que alguém acrescente um provedor à lista.
      const only = SINGLE_HARNESS_MODES[mode];
      const harness = (providers[provider] as Record<string, unknown>).harness;
      if (only && harness !== only) errors.push(`modes.${mode}: ${provider} roda em ${String(harness)}, fora de ${only}`);
    }
    if (new Set(ladder).size !== ladder.length) errors.push(`modes.${mode}: provedor repetido na ladder`);
  }
  for (const mode of Object.keys(modes)) {
    if (!oneOf(mode, MODES)) errors.push(`modes.${mode}: modo desconhecido`);
  }

  if (errors.length > 0) throw new Error(`model-routing inválido:\n- ${errors.join("\n- ")}`);
  return raw as Routing;
}

/**
 * Modelo e effort que o agente de um papel carrega no arquivo do harness: o
 * primeiro candidato de complexidade `medium` do provedor daquele harness.
 * `low` e `high` passam o modelo explícito na chamada (G87).
 */
export function agentDefault(routing: Routing, harness: Harness, role: Role): Candidate & { provider: string } {
  const matches = Object.entries(routing.providers).filter(([, provider]) => provider.harness === harness);
  if (matches.length !== 1) throw new Error(`model-routing: esperado um provedor para o harness ${harness}, achados ${matches.length}`);
  const [name, provider] = matches[0]!;
  return { provider: name, ...provider.roles[role].medium[0]! };
}

export function providerOf(routing: Routing, model: string): string | null {
  for (const [name, provider] of Object.entries(routing.providers)) {
    for (const role of ROLES) {
      for (const complexity of COMPLEXITIES) {
        if (provider.roles[role][complexity].some((candidate) => candidate.model === model)) return name;
      }
    }
  }
  return null;
}

export type RouteRequest = {
  role: string;
  complexity: string;
  /**
   * Modelos que escreveram o delta em julgamento — o do executor e o de cada
   * corretor; obrigatório para o juiz, que não pode ser nenhum deles.
   */
  authors?: readonly string[];
  /** Provedores sem cota agora; saem da ladder. */
  unavailable?: readonly string[];
  /**
   * Harness da sessão que delega: fora o juiz, ela só delega a agentes do
   * próprio harness, então a ladder se restringe aos provedores dele.
   */
  session?: string;
};

export function resolveRoute(routing: Routing, request: RouteRequest): Route {
  if (!oneOf(request.role, ROLES)) throw new Error(`papel "${request.role}" desconhecido (aceitos: ${ROLES.join(", ")})`);
  if (!oneOf(request.complexity, COMPLEXITIES)) {
    throw new Error(`complexidade "${request.complexity}" desconhecida (aceitas: ${COMPLEXITIES.join(", ")})`);
  }
  if (request.session !== undefined && !oneOf(request.session, HARNESSES)) {
    throw new Error(`sessão "${request.session}" desconhecida (aceitas: ${HARNESSES.join(", ")})`);
  }
  const unavailable = request.unavailable ?? [];
  for (const provider of unavailable) {
    // Um nome errado aqui deixaria o provedor sem cota na ladder em silêncio.
    if (!(provider in routing.providers)) throw new Error(`provedor "${provider}" desconhecido em --unavailable`);
  }
  const { role, complexity } = request;
  const mode = routing.subscriptionMode;
  let ladder = routing.modes[mode].filter((provider) => !unavailable.includes(provider));
  if (ladder.length === 0) throw new Error(`nenhum provedor disponível no modo ${mode}`);

  const route = (provider: string, candidate: Candidate): Route => {
    const aliases = routing.providers[provider]!.agentAliases;
    return {
      mode,
      role,
      complexity,
      provider,
      harness: routing.providers[provider]!.harness,
      model: candidate.model,
      effort: candidate.effort,
      agentModel: aliases?.[candidate.model] ?? candidate.model,
    };
  };

  if (role !== "judge") {
    if (request.session !== undefined) {
      ladder = ladder.filter((provider) => routing.providers[provider]!.harness === request.session);
      if (ladder.length === 0) throw new Error(`o modo ${mode} não tem provedor disponível para a sessão ${request.session}`);
    }
    const provider = ladder[0]!;
    return route(provider, routing.providers[provider]!.roles[role][complexity][0]!);
  }

  const authors = request.authors ?? [];
  if (authors.length === 0) throw new Error("o juiz exige --author (cada modelo que escreveu o delta)");
  const authorProviders = new Set<string>();
  for (const author of authors) {
    const provider = providerOf(routing, author);
    if (provider === null) throw new Error(`autor "${author}" não está no registro de modelos`);
    authorProviders.add(provider);
  }
  // Outro provedor primeiro: independência de família vale mais que de versão.
  const ordered = [
    ...ladder.filter((provider) => !authorProviders.has(provider)),
    ...ladder.filter((provider) => authorProviders.has(provider)),
  ];
  for (const provider of ordered) {
    const candidate = routing.providers[provider]!.roles.judge[complexity].find((option) => !authors.includes(option.model));
    if (candidate) return route(provider, candidate);
  }
  throw new Error(`nenhum juiz diferente de ${authors.join(", ")} no modo ${mode}`);
}
