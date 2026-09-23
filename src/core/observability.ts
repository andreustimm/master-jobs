/**
 * O que pode sair desta casa quando um erro é reportado.
 *
 * Relatório de erro é a única coisa neste sistema que manda dado para um
 * terceiro por padrão. Tudo o mais — CV, funil, piso salarial — existe sob a
 * regra de que não sai. Então a decisão sobre o que acompanha um erro é
 * domínio puro, testada exaustivamente, e não um detalhe de configuração do
 * SDK: configuração some numa atualização de dependência, teste não.
 *
 * A postura é lista de PERMISSÃO. Cabeçalho, parâmetro ou campo que ninguém
 * previu não vai — porque o que ninguém previu é exatamente o que vaza.
 */

/**
 * Cabeçalhos que podem viajar junto do erro.
 *
 * Nenhum deles identifica pessoa. `cookie` carrega a sessão inteira,
 * `authorization` a credencial, e `x-forwarded-for` o IP, que é dado pessoal
 * sob a LGPD — os três são exatamente o que um relatório de erro tende a
 * levar junto sem ninguém perceber.
 */
export const ALLOWED_HEADERS: readonly string[] = [
  "content-type",
  "accept",
  "accept-language",
  "x-vercel-id",
  "x-vercel-deployment-url",
];

/** Marcador único, para o teste distinguir "omitido" de "nunca existiu". */
export const REDACTED = "[redigido]";

/**
 * Caminho sem query string.
 *
 * O caminho responde "onde quebrou" e é preciso para reproduzir. A query
 * responde "o que a pessoa estava procurando" — termo de busca, faixa
 * salarial, estágio do funil — e isso é comportamento de uso, não diagnóstico.
 * Some inteira, em vez de por parâmetro: filtro novo nasce redigido.
 *
 * Entrada malformada vira `/`, nunca estoura: um relator de erro que estoura
 * ao relatar transforma um erro em dois.
 */
export function redactPath(path: string): string {
  if (typeof path !== "string" || path.length === 0) return "/";
  const cut = path.search(/[?#]/);
  const clean = cut === -1 ? path : path.slice(0, cut);
  return clean.length > 0 ? clean : "/";
}

/**
 * Só os cabeçalhos da lista de permissão, em minúsculas.
 *
 * Valor repetido (`string[]`) vira lista separada por vírgula; o que não está
 * na lista simplesmente não aparece, em vez de aparecer como `[redigido]` —
 * dizer que existe um cabeçalho e omitir o valor ainda conta que ele existe.
 */
export function safeHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string> {
  const safe: Record<string, string> = {};
  if (!headers || typeof headers !== "object") return safe;
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (!ALLOWED_HEADERS.includes(key)) continue;
    if (value === undefined) continue;
    safe[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return safe;
}

/**
 * Apaga segredo e identificador pessoal de um texto livre.
 *
 * Mensagem de erro deste repositório nunca carrega valor — é regra, e
 * `config.ts` a cumpre nomeando a variável e não o conteúdo. Mas a pilha
 * atravessa driver, runtime e biblioteca de terceiro, e nenhum deles
 * prometeu isso. O caso concreto: uma falha de conexão do `postgres` traz a
 * URL inteira, com senha, no texto da exceção.
 *
 * A ordem das substituições é a parte que erra sozinha, e cada passo abaixo
 * está onde está por um motivo:
 *
 * - credencial de URL ANTES do e-mail, senão `user:senha@host` casa como
 *   endereço e a senha sobrevive à redação do trecho que veio depois dela;
 * - `bearer` ANTES da chave nomeada, senão `Authorization: Bearer <token>`
 *   consome só a palavra `Bearer` — a regra de chave nomeada para no primeiro
 *   espaço — e o token segue inteiro. Foi o teste que pegou isso.
 */
export function redactSecrets(text: string): string {
  if (typeof text !== "string" || text.length === 0) return "";
  return (
    text
      // postgres://usuario:senha@host → postgres://usuario:[redigido]@host
      .replace(/(\/\/[^\s/:@]+):[^\s@]+@/g, `$1:${REDACTED}@`)
      // esquema Bearer, antes de qualquer regra que pare no espaço
      .replace(/\b(bearer\s+)\S+/gi, `$1${REDACTED}`)
      // chave nomeada, em query string ou em cabeçalho
      .replace(
        /\b(password|passwd|senha|token|secret|api[-_]?key|authorization)\b(\s*[=:]\s*)\S+/gi,
        `$1$2${REDACTED}`,
      )
      // e-mail
      .replace(/\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi, REDACTED)
      // bloco longo o bastante para só poder ser credencial
      .replace(/\b[A-Za-z0-9_-]{40,}\b/g, REDACTED)
  );
}

/** Requisição já reduzida ao que pode sair. */
export type SafeRequest = {
  path: string;
  method: string;
  headers: Record<string, string>;
};

/**
 * Reduz a requisição que o Next entrega ao que pode sair daqui.
 *
 * O Next passa `headers` com TUDO, `cookie` inclusive. Encaminhar o objeto
 * como veio é o modo padrão de integrar, e é por isso que ele está errado
 * aqui: o padrão manda a sessão junto do erro.
 */
export function safeRequest(
  request: Readonly<{
    path?: string;
    method?: string;
    headers?: Record<string, string | string[] | undefined>;
  }>,
): SafeRequest {
  return {
    path: redactPath(request?.path ?? "/"),
    method: typeof request?.method === "string" ? request.method : "GET",
    headers: safeHeaders(request?.headers ?? {}),
  };
}

/**
 * O formato mínimo do evento do Sentry que esta peneira toca.
 *
 * Deliberadamente estrutural em vez de importar o tipo do SDK: o que importa
 * aqui é o formato dos campos perigosos, e amarrar o teste ao tipo de uma
 * dependência faria uma atualização dela silenciar a verificação.
 */
export type ScrubbableEvent = {
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
  request?: {
    cookies?: unknown;
    data?: unknown;
    headers?: Record<string, string | string[] | undefined>;
    query_string?: unknown;
    url?: string;
  };
  user?: unknown;
  breadcrumbs?: Array<{ message?: string; data?: { [key: string]: unknown } }>;
};

/** Texto sem o que vem depois de `?` ou `#` — a mesma regra de `redactPath`, fora de caminho. */
function withoutQuery(text: string): string {
  const cut = text.search(/[?#]/);
  return cut === -1 ? text : text.slice(0, cut);
}

/**
 * Migalha é o rastro que o SDK junta antes do erro: requisição de saída,
 * linha de console, navegação. A de requisição traz a URL inteira — e a busca
 * por termo nas fontes leva o termo da pessoa na query string.
 */
function scrubBreadcrumb(crumb: { message?: string; data?: { [key: string]: unknown } }): void {
  if (!crumb || typeof crumb !== "object") return;
  if (typeof crumb.message === "string") crumb.message = withoutQuery(redactSecrets(crumb.message));
  if (!crumb.data || typeof crumb.data !== "object") return;
  for (const [key, value] of Object.entries(crumb.data)) {
    if (typeof value === "string") crumb.data[key] = withoutQuery(redactSecrets(value));
    else if (typeof value !== "number" && typeof value !== "boolean") delete crumb.data[key];
  }
}

/**
 * Última peneira, depois de tudo que o SDK montou.
 *
 * Roda como `beforeSend`. Ela existe porque o evento não é montado só pelo
 * nosso código: o SDK enriquece com o que encontra no ambiente, e uma
 * atualização dele pode passar a anexar um campo que ninguém previu. Então a
 * peneira é explícita sobre os campos perigosos e roda por último.
 *
 * É pura e exportada para poder ser TESTADA. Enquanto viveu inline na
 * configuração do `init`, nenhum teste a exercitava — justamente a função que
 * carrega a promessa de privacidade inteira.
 *
 * Nunca estoura: devolver o evento sem peneirar seria pior que não relatar, e
 * estourar dentro do `beforeSend` faz o SDK descartar o evento inteiro. Em
 * caso de dúvida, descarta — `null` significa "não envie".
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T | null {
  try {
    if (!event || typeof event !== "object") return null;

    if (typeof event.message === "string") {
      event.message = redactSecrets(event.message);
    }
    for (const entrada of event.exception?.values ?? []) {
      if (typeof entrada?.value === "string") entrada.value = redactSecrets(entrada.value);
    }

    if (event.request && typeof event.request === "object") {
      // Apagados por nome, e não filtrados: são os campos que carregam sessão,
      // corpo e busca, e nenhum deles tem uso em diagnóstico.
      delete event.request.cookies;
      delete event.request.data;
      delete event.request.query_string;
      if (typeof event.request.url === "string") {
        event.request.url = redactPath(event.request.url);
      }
      if (event.request.headers) {
        event.request.headers = safeHeaders(event.request.headers);
      }
    }

    for (const crumb of Array.isArray(event.breadcrumbs) ? event.breadcrumbs : []) scrubBreadcrumb(crumb);

    // Identidade nunca acompanha o erro, mesmo que `sendDefaultPii` mude de
    // padrão numa atualização do SDK.
    delete event.user;
    return event;
  } catch {
    return null;
  }
}

/**
 * Amostragem de traces quando `SENTRY_TRACES_SAMPLE_RATE` não diz nada.
 *
 * Um em cada dez. O plano Developer da organização reserva 5 milhões de spans
 * por ciclo, dividido entre quatro projetos, e sem gasto sob demanda: passar da
 * quota descarta span, não gera cobrança. Uma leitura de `/jobs` rende algumas
 * dezenas de spans; com um usuário, 10% é folga larga e ainda junta amostra
 * para o objetivo de latência (100 por rota) em poucos dias.
 */
export const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/**
 * Lê a amostragem configurada.
 *
 * Valor que não é um número entre 0 e 1 DESLIGA o tracing, em vez de cair no
 * padrão: configuração ilegível é engano de alguém, e o engano não pode
 * resultar em mais dado saindo do que o pedido. Ausente ou em branco é o
 * padrão — a regra 17 vale aqui, `""` não é zero.
 */
export function tracesSampleRate(raw: string | undefined): number {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_TRACES_SAMPLE_RATE;
  const text = raw.trim();
  if (!/^(?:0|1|0?\.\d+|1\.0+)$/.test(text)) return 0;
  return Number(text);
}

/**
 * Atributos de span que podem sair.
 *
 * Lista de PERMISSÃO, como os cabeçalhos. A instrumentação de HTTP anexa
 * `http.target`, `url.full` e `url.query` — a URL com o filtro da pessoa — e
 * `client.address`, que é IP. A do PostgreSQL anexa `db.query.text` e o
 * endereço do banco. Nenhum deles responde "quanto demorou e onde", que é a
 * pergunta do tracing; todos respondem "quem, e o que procurava".
 */
export const ALLOWED_SPAN_DATA: readonly string[] = [
  "sentry.op",
  "sentry.origin",
  "sentry.source",
  "sentry.sample_rate",
  "http.method",
  "http.request.method",
  "http.status_code",
  "http.response.status_code",
  "http.route",
  "next.route",
  "next.span_name",
  "next.span_type",
  "db.system",
  "db.system.name",
  "db.operation.name",
  "db.response.status_code",
  "otel.kind",
  "error.type",
  "jho.etapa",
];

/** Contextos de transação que podem sair; o resto (`otel`, `response`, o que uma atualização do SDK anexar) não. */
export const ALLOWED_TRANSACTION_CONTEXTS: readonly string[] = ["trace", "runtime", "os", "app", "device"];

/** O formato mínimo de span que a peneira toca — estrutural, pelo mesmo motivo de `ScrubbableEvent`. */
export type ScrubbableSpan = {
  description?: string;
  op?: string;
  data?: { [key: string]: unknown };
};

function safeSpanData(data: unknown): { [key: string]: unknown } {
  const safe: { [key: string]: unknown } = {};
  if (!data || typeof data !== "object") return safe;
  for (const [key, value] of Object.entries(data)) {
    if (!ALLOWED_SPAN_DATA.includes(key)) continue;
    if (typeof value === "string") safe[key] = withoutQuery(redactSecrets(value));
    else if (typeof value === "number" || typeof value === "boolean") safe[key] = value;
  }
  return safe;
}

const SQL_VERB = /^\s*(select|insert|update|delete|with|begin|commit|rollback|set|show|values|copy|lock|create|alter|drop|truncate|explain)\b/i;

/**
 * A descrição de um span de banco é a consulta. O SDK troca os literais por
 * `?`, mas a consulta ainda descreve o filtro — quais colunas a busca tocou — e
 * o nome da operação basta para saber onde o tempo foi.
 */
function safeSpanDescription(description: string, op: string | undefined, data: { [key: string]: unknown }): string {
  const isDb =
    (typeof op === "string" && op.startsWith("db")) ||
    data["db.system"] !== undefined ||
    data["db.system.name"] !== undefined;
  if (!isDb) return withoutQuery(redactSecrets(description));
  const operation = data["db.operation.name"];
  if (typeof operation === "string" && operation.length > 0) return operation;
  return SQL_VERB.exec(description)?.[1]?.toUpperCase() ?? "db";
}

/**
 * Peneira de um span. Roda como `beforeSendSpan` e, de novo, dentro de
 * `scrubTransaction` para cada span da transação.
 *
 * `beforeSendSpan` não pode descartar span — o SDK envia o original se a função
 * devolver `null`. Então, se algo estourar aqui, o span sai vazio de dado, e
 * não como veio.
 */
export function scrubSpan<T extends ScrubbableSpan>(span: T): T {
  if (!span || typeof span !== "object") return span;
  try {
    span.data = safeSpanData(span.data);
    if (typeof span.description === "string") {
      span.description = safeSpanDescription(span.description, span.op, span.data);
    }
  } catch {
    span.data = {};
    delete span.description;
  }
  return span;
}

/** O formato mínimo da transação que a peneira toca. */
export type ScrubbableTransaction = ScrubbableEvent & {
  transaction?: string;
  contexts?: { [key: string]: unknown };
  spans?: ScrubbableSpan[];
  tags?: { [key: string]: unknown };
  extra?: unknown;
};

/**
 * Última peneira de uma transação, depois de tudo que o SDK montou.
 *
 * Roda como `beforeSendTransaction`. Uma transação é um evento como outro
 * qualquer — pedido, usuário, migalhas — e mais: o nome (que pode ser a URL),
 * o contexto `trace` com os atributos do span raiz e a lista de spans. Por
 * isso ela reaproveita `scrubEvent` e acrescenta o resto.
 *
 * O span raiz passa por `beforeSendSpan`, mas o SDK MESCLA o resultado com o
 * evento original: chave apagada lá volta na mescla. É aqui, e não no
 * `beforeSendSpan`, que `contexts.trace.data` perde o que não pode sair.
 *
 * Em caso de dúvida, descarta — `null` significa "não envie". Perder uma
 * amostra de latência não custa nada; mandar a busca de alguém custa.
 */
export function scrubTransaction<T extends ScrubbableTransaction>(event: T): T | null {
  try {
    const clean = scrubEvent(event);
    if (!clean) return null;

    if (typeof clean.transaction === "string") {
      clean.transaction = withoutQuery(redactSecrets(clean.transaction));
    }

    if (clean.contexts && typeof clean.contexts === "object") {
      for (const name of Object.keys(clean.contexts)) {
        if (!ALLOWED_TRANSACTION_CONTEXTS.includes(name)) delete clean.contexts[name];
      }
      const trace = clean.contexts.trace;
      if (trace && typeof trace === "object") scrubSpan(trace as ScrubbableSpan);
    }

    if (Array.isArray(clean.spans)) {
      for (const span of clean.spans) scrubSpan(span);
    }

    if (clean.tags && typeof clean.tags === "object") {
      for (const [key, value] of Object.entries(clean.tags)) {
        if (typeof value === "string") clean.tags[key] = withoutQuery(redactSecrets(value));
        else if (typeof value !== "number" && typeof value !== "boolean") delete clean.tags[key];
      }
    }

    // Numa transação não há diagnóstico a preservar em `extra` nem em
    // migalha: a pergunta é de tempo, e os dois são onde texto livre entra.
    delete clean.extra;
    delete clean.breadcrumbs;
    return clean;
  } catch {
    return null;
  }
}

/** O que a instrumentação lê do ambiente para montar o relato. */
export type SentryServerEnv = {
  dsn: string;
  environment: string;
  release?: string;
  tracesSampleRate?: string;
};

/**
 * A configuração do SDK no servidor, montada aqui para ser TESTADA.
 *
 * Enquanto viveu dentro do `Sentry.init`, só a leitura do código garantia que a
 * peneira estava ligada. Aqui um teste aplica cada gancho a um evento real e
 * reprova se a remoção sumir.
 *
 * `tracePropagationTargets: []`: com tracing ligado, o SDK anexa `sentry-trace`
 * e `baggage` a TODA requisição de saída — e o `baggage` leva a chave pública,
 * o release e o nome da transação para cada board que a sincronização consulta.
 * Não há serviço nosso do outro lado para continuar o trace; propagar só vaza.
 */
export function sentryServerOptions(env: SentryServerEnv) {
  const rate = tracesSampleRate(env.tracesSampleRate);
  return {
    dsn: env.dsn,
    environment: env.environment,
    release: env.release,
    sendDefaultPii: false,
    tracesSampleRate: rate,
    // Sem `tracesSampler`, o SDK obedece ao `sentry-trace: …-1` que chega no
    // pedido ANTES da taxa configurada: qualquer cliente, sem sessão, forçaria
    // 100% de amostragem — e o `0` deixaria de desligar. A taxa é nossa.
    tracesSampler: (_contexto?: unknown) => rate,
    tracePropagationTargets: [] as string[],
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubTransaction,
    beforeSendSpan: scrubSpan,
  };
}

/**
 * Onde publicar os mapas de origem do build, ou por que não publicar.
 *
 * Sem `SENTRY_AUTH_TOKEN`, o build segue sem mapas: ausência de provedor não
 * bloqueia produto, e o desenvolvimento local e o CI não têm — nem devem ter —
 * o token. Organização e projeto têm padrão porque não são segredo; o token
 * nunca entra no plano, para que registrar o plano não o imprima.
 */
export type SourceMapPlan =
  | { upload: false; reason: string }
  | { upload: true; org: string; project: string; release?: string };

export const SENTRY_DEFAULT_ORG = "master-timm";
export const SENTRY_DEFAULT_PROJECT = "master-jobs";

export function sourceMapPlan(env: Readonly<{ [key: string]: string | undefined }>): SourceMapPlan {
  if (!env.SENTRY_AUTH_TOKEN?.trim()) {
    return { upload: false, reason: "SENTRY_AUTH_TOKEN ausente: o build segue sem publicar mapas de origem" };
  }
  const release = env.VERCEL_GIT_COMMIT_SHA?.trim();
  return {
    upload: true,
    org: env.SENTRY_ORG?.trim() || SENTRY_DEFAULT_ORG,
    project: env.SENTRY_PROJECT?.trim() || SENTRY_DEFAULT_PROJECT,
    ...(release ? { release } : {}),
  };
}

/**
 * O aviso que sai antes de a plataforma matar o processo.
 *
 * A pior falha do produto é a única invisível: `FUNCTION_INVOCATION_TIMEOUT`
 * encerra o processo aos 30 segundos, o código não lança exceção, e por isso
 * nada é reportado — o registro da Vercel traz uma linha só, sem rastro da
 * aplicação. Foi assim que o 504 de `/candidate/skills` conviveu com um Sentry
 * limpo enquanto a tela estava quebrada.
 *
 * Um processo ainda vivo aos 22 segundos consegue falar. É essa a janela que
 * esta função usa: ela não corrige nem interrompe nada, só faz o travamento
 * deixar rastro — e o rastro nomeia a rota, que é o que faltava.
 */
export type TimeoutWatchReport = {
  /** A rota que não respondeu a tempo, sem query string. */
  route: string;
  /** Quanto tempo se passou quando o aviso saiu. */
  elapsedMs: number;
};

export type TimeoutWatchDeps = {
  /** Para onde o aviso vai. Injetado porque domínio puro não conhece SDK. */
  report: (report: TimeoutWatchReport) => void;
  /** Injetável para o teste não esperar 22 segundos de verdade. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/**
 * Roda `work`, e avisa se ele passar de `limitMs` — sem alterar o resultado.
 *
 * O aviso nunca atrapalha o trabalho: um relator que estoura é engolido, e um
 * trabalho que falha continua falhando com o próprio erro. Relatar não pode
 * virar um segundo defeito por cima do primeiro.
 */
export async function warnIfSlower<T>(
  route: string,
  limitMs: number,
  work: () => Promise<T>,
  deps: TimeoutWatchDeps,
): Promise<T> {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as never));
  const handle = setTimer(() => {
    try {
      deps.report({ route: redactPath(route), elapsedMs: limitMs });
    } catch {
      // Ver acima: o aviso é secundário ao trabalho.
    }
  }, limitMs);
  try {
    return await work();
  } finally {
    clearTimer(handle);
  }
}

/**
 * Onde uma leitura de tela gasta o tempo.
 *
 * Existe porque "a busca está lenta" era uma sensação sem número: nenhuma
 * rota media a si mesma, o log da Vercel não traz duração por etapa e o Sentry
 * rodava sem tracing (a URL carrega o filtro do usuário). Sem medida, cada
 * conserto era uma hipótese — a região da função só apareceu ao comparar dois
 * nomes de região.
 *
 * `trace`, quando injetado, envolve cada estágio num span: é o mesmo nome de
 * estágio que já sai no log, agora dentro do trace amostrado da requisição.
 * Domínio puro não conhece SDK, então quem abre o span é o adapter.
 *
 * Mede ESTÁGIOS, não consultas: cada estágio é uma espera do servidor pelo
 * banco (uma ida, ou várias em paralelo), e é o que a latência soma. Só sai
 * número e nome de estágio — nunca query string, nem identidade, nem valor de
 * filtro —, então o que sai por aqui cabe na mesma lista de permissão do resto.
 */
export type StageTiming = { stage: string; ms: number };

export type TimingReport = {
  /** A rota, sem query string. */
  route: string;
  totalMs: number;
  stages: StageTiming[];
};

export type StageTimer = {
  /** Roda `work`, anota quanto levou e devolve o resultado (ou relança o erro). */
  time<T>(stage: string, work: () => Promise<T>): Promise<T>;
  report(route: string): TimingReport;
};

const roundMs = (ms: number) => Math.round(ms * 10) / 10;

/** Envolve o trabalho de um estágio num span; tem de rodar `work` exatamente uma vez. */
export type StageTrace = <T>(stage: string, work: () => Promise<T>) => Promise<T>;

/** `now` é injetável para o teste não depender do relógio da máquina. */
export function createStageTimer(
  now: () => number = () => performance.now(),
  trace?: StageTrace,
): StageTimer {
  const startedAt = now();
  const stages: StageTiming[] = [];
  return {
    async time(stage, work) {
      const begin = now();
      try {
        return await (trace ? trace(stage, work) : work());
      } finally {
        // No `finally`: o estágio que estoura é justamente o que interessa medir.
        stages.push({ stage, ms: roundMs(now() - begin) });
      }
    },
    report(route) {
      return { route: redactPath(route), totalMs: roundMs(now() - startedAt), stages: [...stages] };
    },
  };
}

export type TimingLogPolicy = {
  /** A partir daqui o relatório sai mesmo sem pedido. */
  slowMs: number;
  /** `JHO_PERF_LOG=1`: sai sempre, para medir uma tela em vez de esperar que ela piore. */
  always: boolean;
};

export function shouldLogTiming(report: TimingReport, policy: TimingLogPolicy): boolean {
  return policy.always || report.totalMs >= policy.slowMs;
}

/**
 * A linha que vai para o log: JSON de uma linha, para o painel filtrar por
 * `perf`. `region` é a região da função, que é o que teria mostrado a
 * `iad1` ao lado de um banco em São Paulo.
 */
export function timingLogLine(report: TimingReport, region?: string): string {
  return JSON.stringify({
    perf: report.route,
    totalMs: report.totalMs,
    ...(region ? { region } : {}),
    stages: Object.fromEntries(report.stages.map(({ stage, ms }) => [stage, ms])),
  });
}
