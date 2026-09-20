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
};

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

    // Identidade nunca acompanha o erro, mesmo que `sendDefaultPii` mude de
    // padrão numa atualização do SDK.
    delete event.user;
    return event;
  } catch {
    return null;
  }
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
