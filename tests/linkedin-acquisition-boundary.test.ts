/**
 * Regra 1 como contrato de runtime: o servidor nunca pede nada ao LinkedIn.
 *
 * `remote-url.test.ts` já prova que endereço privado, DNS misto e redirect para
 * a rede interna são recusados. Nada disso impedia buscar o LinkedIn: o
 * domínio é público, resolve para IP roteável, responde 200 e tem robots.txt.
 * E havia caminho real até lá — o alerta por e-mail (ADR 0008) grava
 * `linkedin.com/jobs/view/<id>` como URL da vaga, e `jobs verify` e a fila de
 * raspagem pegam as URLs do acervo.
 *
 * Cada caso usa um transporte falso que REGISTRA as chamadas, e a asserção é
 * sobre o registro: zero pedidos ao domínio proibido, direto ou por redirect.
 * Nenhum caso abre socket, resolve DNS de verdade nem toca o LinkedIn.
 *
 * Fronteira DENTRO: a política de URL, as três aquisições que levam URL de
 * vaga à rede (porta HTTP dos adapters, sonda HEAD/GET, captura HTML) e as
 * duas entradas permitidas (alerta por e-mail, cadastro manual).
 * Fronteira FORA: ferramentas de agente e scripts avulsos, que não passam por
 * este runtime — a política escrita cobre esses (`docs/linkedin-policy.md`).
 * Também fora: IP literal do LinkedIn e proxy de terceiros, porque a recusa
 * casa pelo nome do host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeRemoteUrl,
  isProhibitedAcquisitionHost,
  ProhibitedAcquisitionError,
  safeRemoteFetch,
  UnsafeRemoteUrlError,
  type LookupHost,
} from "../src/core/remote-url.ts";
import { probe } from "../src/core/ingest/probe.ts";
import { capture } from "../src/core/scrape/fetcher.ts";
import { clearRobotsCache } from "../src/core/scrape/robots.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import { getJson, getText } from "../src/core/sources/http.ts";
import { extractAlertJobs, toRawJobs } from "../src/core/mail/job-alert.ts";

/** Endereço público literal: dispensa DNS, então o teste nunca resolve nada. */
const PUBLIC_ATS = "https://93.184.216.34/jobs/123";

const PROHIBITED_URLS = [
  "https://www.linkedin.com/jobs/view/4111216009",
  "https://linkedin.com/jobs/view/4111216009",
  "https://br.linkedin.com/jobs/view/4111216009",
  "https://WWW.LinkedIn.COM./jobs/view/4111216009",
  "https://www.linkedin.cn/jobs/view/1",
  "https://lnkd.in/abc123",
  "https://media.licdn.com/dms/image/x",
];

/** fetch falso que registra tudo e, se chamado, devolve 200 — o pior caso. */
function recordingFetch(
  answer: (url: string) => Response = () => new Response("ok", { status: 200 }),
) {
  const calls: Array<{ url: string; method: string }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
    return answer(url);
  }) as typeof fetch;
  return { calls, impl };
}

function redirectTo(location: string) {
  return recordingFetch((url) =>
    url.includes("linkedin") || url.includes("lnkd.in")
      ? new Response("linkedin", { status: 200 })
      : new Response(null, { status: 302, headers: { location } }),
  );
}

const lookupSpy = () => {
  const hosts: string[] = [];
  const lookupHost: LookupHost = async (hostname) => {
    hosts.push(hostname);
    return [{ address: "93.184.216.34", family: 4 }];
  };
  return { hosts, lookupHost };
};

describe("classificação do host proibido", () => {
  it("reconhece o domínio, os subdomínios, o encurtador e a CDN", () => {
    for (const host of [
      "linkedin.com",
      "www.linkedin.com",
      "br.linkedin.com",
      "LINKEDIN.COM.",
      "linkedin.cn",
      "lnkd.in",
      "media.licdn.com",
    ]) {
      expect(isProhibitedAcquisitionHost(host), host).toBe(true);
    }
  });

  it("não confunde nome parecido com o domínio", () => {
    // Recusar por substring apagaria fontes legítimas que só citam o nome.
    for (const host of [
      "notlinkedin.com",
      "linkedin.com.evil.test",
      "linkedin-jobs.example",
      "jobs.example.test",
      "lnkd.info",
    ]) {
      expect(isProhibitedAcquisitionHost(host), host).toBe(false);
    }
  });
});

describe("política de URL remota", () => {
  it("recusa antes de resolver DNS", async () => {
    for (const url of PROHIBITED_URLS) {
      const dns = lookupSpy();
      await expect(
        assertSafeRemoteUrl(url, { lookupHost: dns.lookupHost }),
        url,
      ).rejects.toBeInstanceOf(ProhibitedAcquisitionError);
      expect(dns.hosts, url).toEqual([]);
    }
  });

  it("é uma recusa de URL remota: quem já trata a família continua tratando", () => {
    expect(new ProhibitedAcquisitionError("https://lnkd.in/x")).toBeInstanceOf(
      UnsafeRemoteUrlError,
    );
  });

  it("não faz pedido nenhum quando a URL já é do LinkedIn", async () => {
    for (const url of PROHIBITED_URLS) {
      const net = recordingFetch();
      await expect(safeRemoteFetch(url, {}, { fetchImpl: net.impl })).rejects.toBeInstanceOf(
        ProhibitedAcquisitionError,
      );
      expect(net.calls, url).toEqual([]);
    }
  });

  it("recusa o redirect para o LinkedIn antes do segundo pedido", async () => {
    for (const location of [
      "https://www.linkedin.com/jobs/view/1",
      "https://lnkd.in/abc",
      "//br.linkedin.com/jobs/view/1", // relativo ao protocolo
    ]) {
      const net = redirectTo(location);
      await expect(
        safeRemoteFetch(PUBLIC_ATS, { method: "HEAD" }, { fetchImpl: net.impl }),
        location,
      ).rejects.toBeInstanceOf(ProhibitedAcquisitionError);
      expect(net.calls.map((c) => c.url), location).toEqual([PUBLIC_ATS]);
    }
  });

  it("continua seguindo redirect entre destinos públicos permitidos", async () => {
    // O controle negativo: sem ele, uma recusa geral de redirect passaria.
    const net = recordingFetch((url) =>
      url === PUBLIC_ATS
        ? new Response(null, { status: 301, headers: { location: "https://93.184.216.35/jobs/123" } })
        : new Response("vaga", { status: 200 }),
    );
    const res = await safeRemoteFetch(PUBLIC_ATS, {}, { fetchImpl: net.impl });
    expect(res.status).toBe(200);
    expect(net.calls).toHaveLength(2);
  });
});

describe("aquisição por sonda (HEAD, depois GET)", () => {
  it("vaga do LinkedIn fica inconclusiva sem nenhum pedido — e nunca é fechada", async () => {
    // Recusar não é prova de ausência: só 404/410 fecham (probe.ts). Se a
    // recusa virasse "gone", toda vaga vinda de alerta por e-mail sumiria no
    // primeiro `jobs verify`.
    const net = recordingFetch();
    const result = await probe("https://www.linkedin.com/jobs/view/4111216009", {
      fetchImpl: net.impl,
    });
    expect(result).toEqual({ verdict: "inconclusive", status: null });
    expect(net.calls).toEqual([]);
  });

  it("HEAD que redireciona para o LinkedIn para no primeiro salto", async () => {
    const net = redirectTo("https://www.linkedin.com/jobs/view/1");
    const result = await probe(PUBLIC_ATS, { fetchImpl: net.impl });
    expect(result.verdict).toBe("inconclusive");
    expect(net.calls).toEqual([{ url: PUBLIC_ATS, method: "HEAD" }]);
  });
});

describe("aquisição pela porta HTTP dos adapters (JSON e HTML)", () => {
  let net: ReturnType<typeof recordingFetch>;

  beforeEach(() => {
    resetHttpPort();
    net = recordingFetch();
    vi.stubGlobal("fetch", net.impl);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetHttpPort();
  });

  it("getJson recusa sem pedido e sem tentar de novo", async () => {
    // Sem a exceção em `realGetJson`, a recusa entraria no laço de retry com
    // espera exponencial: nenhum pedido, mas um sync mais lento à toa.
    const started = Date.now();
    await expect(getJson("https://www.linkedin.com/voyager/api/jobs")).rejects.toBeInstanceOf(
      ProhibitedAcquisitionError,
    );
    expect(Date.now() - started).toBeLessThan(400);
    expect(net.calls).toEqual([]);
  });

  it("getText devolve null sem pedido, como faz com qualquer página ilegível", async () => {
    await expect(getText("https://www.linkedin.com/jobs/view/1")).resolves.toBeNull();
    expect(net.calls).toEqual([]);
  });

  it("getText de uma career page que redireciona para o LinkedIn para no primeiro salto", async () => {
    const redirecting = redirectTo("https://www.linkedin.com/company/acme/jobs");
    vi.stubGlobal("fetch", redirecting.impl);
    await expect(getText(PUBLIC_ATS)).resolves.toBeNull();
    expect(redirecting.calls.map((c) => c.url)).toEqual([PUBLIC_ATS]);
  });
});

describe("aquisição pela raspagem de descrição", () => {
  afterEach(() => {
    resetHttpPort();
    clearRobotsCache();
  });

  it("bloqueia antes do robots.txt: pedir o robots do LinkedIn já seria requisição", async () => {
    const robotsPort = fixtureHttp({ "robots.txt": "User-agent: *\nAllow: /" });
    setHttpPort(robotsPort);
    const net = recordingFetch();
    const dns = lookupSpy();

    const outcome = await capture(
      { id: 1, jobId: 1, url: "https://www.linkedin.com/jobs/view/4111216009", attempts: 0 },
      { fetcher: net.impl, lookupHost: dns.lookupHost },
    );

    expect(outcome).toEqual({ kind: "blocked", reason: "aquisição proibida (LinkedIn, regra 1)" });
    expect(robotsPort.calls).toEqual([]);
    expect(net.calls).toEqual([]);
    expect(dns.hosts).toEqual([]);
  });
});

describe("entradas permitidas continuam funcionando", () => {
  it("alerta por e-mail ainda produz vaga com a URL do LinkedIn, sem buscá-la", () => {
    // ADR 0008: o LinkedIn ENVIA o alerta; ler a própria caixa é permitido.
    // Guardar e exibir a URL não é aquisição — buscá-la no servidor é.
    const html = `<div><a href="https://www.linkedin.com/comm/jobs/view/4231234567/?trackingId=abc">Senior AI Architect</a>
      <span>Nubank</span> · <span>Remote</span></div>`;
    const raw = toRawJobs(extractAlertJobs(html, null), "2026-09-20T12:00:00Z");
    expect(raw).toHaveLength(1);
    expect(raw[0]?.url).toBe("https://www.linkedin.com/jobs/view/4231234567");
  });
});
