/**
 * Outbound URL policy for server-side requests.
 *
 * A URL being safe to show in an anchor does not make it safe for the server
 * to fetch. Job URLs can originate outside the trust boundary, so every hop
 * must resolve only to globally routable addresses. Redirects are checked
 * independently because an innocuous public URL may redirect to localhost or
 * a cloud metadata endpoint.
 */
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export type ResolvedAddress = { address: string; family: number };
export type LookupHost = (hostname: string) => Promise<readonly ResolvedAddress[]>;

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}

const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}

const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class UnsafeRemoteUrlError extends Error {
  readonly url: string;

  constructor(url: string, reason: string) {
    super(`URL remota recusada: ${reason}`);
    this.name = "UnsafeRemoteUrlError";
    this.url = url;
  }
}

/**
 * Recusa por finalidade, não por rede: o LinkedIn é público, responde 200 e
 * tem `robots.txt`, e nada disso autoriza buscá-lo — a regra 1 e a ADR 0001
 * proíbem aquisição automatizada daquele domínio. Por isso a recusa mora aqui,
 * no único ponto por onde passa cada salto de toda requisição a URL de vaga,
 * e não em `robots.ts` nem em cada adapter. Um redirect de um encurtador ou de
 * um ATS para `linkedin.com` é recusado antes do segundo pedido.
 *
 * Exibir a URL continua permitido: o alerta por e-mail (ADR 0008) e a vaga
 * cadastrada à mão guardam links do LinkedIn, e a interface os mostra como
 * âncora. O que esta regra impede é o SERVIDOR pedir essa URL.
 *
 * Limite conhecido: casa pelo nome do host. Um IP literal do LinkedIn ou um
 * domínio de terceiros que sirva o conteúdo por proxy passaria; e ferramentas
 * de agente fora deste runtime não passam por aqui (ver
 * `docs/linkedin-policy.md`).
 */
const PROHIBITED_ACQUISITION_DOMAINS = [
  "linkedin.com",
  "linkedin.cn",
  "lnkd.in",
  "licdn.com",
] as const;

export class ProhibitedAcquisitionError extends UnsafeRemoteUrlError {
  constructor(url: string) {
    super(url, "aquisição automatizada do LinkedIn é proibida (regra 1, ADR 0001)");
    this.name = "ProhibitedAcquisitionError";
  }
}

function normalizeHostname(hostname: string): string {
  return unbracket(hostname).toLowerCase().replace(/\.+$/, "");
}

/** Pure, exported so the prohibited list stays auditable. */
export function isProhibitedAcquisitionHost(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return PROHIBITED_ACQUISITION_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

function unbracket(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/** Pure address classification, exported so the deny-list stays auditable. */
export function isGloballyRoutableAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedIpv4.check(address, "ipv4");
  if (family === 6) {
    return (
      globalIpv6.check(address, "ipv6") &&
      !blockedIpv6.check(address, "ipv6")
    );
  }
  return false;
}

const systemLookup: LookupHost = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

/**
 * Parses and resolves one outbound destination.
 *
 * All answers must be public. Accepting one public answer beside a private one
 * would leave the choice to the connection layer and restore the SSRF risk.
 */
export async function assertSafeRemoteUrl(
  value: string | URL,
  opts: { lookupHost?: LookupHost } = {},
): Promise<URL> {
  const raw = String(value);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsafeRemoteUrlError(raw, "formato inválido");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeRemoteUrlError(raw, "somente HTTP(S) é permitido");
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeRemoteUrlError(raw, "credenciais na URL não são permitidas");
  }

  const hostname = normalizeHostname(parsed.hostname);
  // Antes do DNS: a recusa por finalidade não deve custar nem a consulta.
  if (isProhibitedAcquisitionHost(hostname)) {
    throw new ProhibitedAcquisitionError(raw);
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new UnsafeRemoteUrlError(raw, "host local");
  }

  const literalFamily = isIP(hostname);
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await (opts.lookupHost ?? systemLookup)(hostname);
  } catch {
    throw new UnsafeRemoteUrlError(raw, "host não pôde ser resolvido");
  }

  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isGloballyRoutableAddress(address))
  ) {
    throw new UnsafeRemoteUrlError(raw, "destino não é uma rede pública");
  }

  return parsed;
}

function redirectInit(
  init: RequestInit,
  status: number,
  from: URL,
  to: URL,
): RequestInit {
  const next = { ...init, redirect: "manual" as const };
  const method = (init.method ?? "GET").toUpperCase();
  if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
    next.method = "GET";
    delete next.body;
  }

  if (from.origin !== to.origin && init.headers) {
    const headers = new Headers(init.headers);
    headers.delete("authorization");
    headers.delete("cookie");
    headers.delete("proxy-authorization");
    next.headers = headers;
  }
  return next;
}

/** Fetches a public destination while validating every redirect hop. */
export async function safeRemoteFetch(
  input: string | URL,
  init: RequestInit = {},
  opts: {
    fetchImpl?: typeof fetch;
    lookupHost?: LookupHost;
    maxRedirects?: number;
  } = {},
): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxRedirects = opts.maxRedirects ?? 5;
  let current = await assertSafeRemoteUrl(input, { lookupHost: opts.lookupHost });
  let currentInit: RequestInit = { ...init, redirect: "manual" };

  for (let hop = 0; ; hop++) {
    const response = await doFetch(current, currentInit);
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (hop >= maxRedirects) {
      throw new UnsafeRemoteUrlError(current.href, "redirecionamentos demais");
    }

    const next = await assertSafeRemoteUrl(new URL(location, current), {
      lookupHost: opts.lookupHost,
    });
    currentInit = redirectInit(currentInit, response.status, current, next);
    current = next;
  }
}
