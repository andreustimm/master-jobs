// Suite: bordas do extrator e do leitor de robots.txt
// Invariante: as duas funções são as guardiãs de coisas opostas. `stripHtml`
// decide o que o scorer lê — entidade não decodificada vira palavra falsa na
// contagem de keywords. `mayFetch` decide o que o crawler toca — e é a única
// regra deste projeto que não se negocia (ADR 0001).
// Fronteira DENTRO: decodificação de entidades, seleção de grupo em robots.txt,
// Crawl-delay malformado e URL que não é URL.
// Fronteira FORA: a busca em si (a página de robots vem da porta HTTP).
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanBullets,
  extractTitle,
  mainContent,
  stripHtml,
} from "../src/core/scrape/extract.ts";
import {
  clearRobotsCache,
  isAllowed,
  mayFetch,
  parseRobots,
  robotsFor,
} from "../src/core/scrape/robots.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";

afterEach(() => {
  resetHttpPort();
  clearRobotsCache();
});

describe("stripHtml", () => {
  it("decodifica entidade hexadecimal, que boards usam para travessão e aspas", () => {
    // Deixada crua, "&#x2014;" entra na contagem de keywords como palavra e o
    // texto exibido no dossiê fica ilegível — dois danos por um mesmo descuido.
    expect(stripHtml("<p>R&#x24;180.000 &#x2014; s&#xEA;nior</p>")).toBe("R$180.000 — sênior");
  });

  it("deixa intacta a entidade nomeada que não conhece, em vez de comer o texto", () => {
    // Apagar o que não se reconhece perderia conteúdo em silêncio; manter o
    // literal ao menos é visível para quem lê.
    expect(stripHtml("<p>a &naosei; b</p>")).toBe("a &naosei; b");
  });
});

describe("mainContent", () => {
  it("continua procurando quando o primeiro contêiner reconhecido é fino demais", () => {
    // Uma <div class="job-description"> com duas palavras é falso positivo — em
    // geral um cabeçalho. Parar nela entregaria ao scorer uma vaga sem texto,
    // que pontuaria zero em keywords sem que nada parecesse errado.
    const corpo = "Construímos infraestrutura de agentes para empresas. ".repeat(12);
    const html = `<div class="job-description">Vaga</div><article>${corpo}</article>`;
    expect(stripHtml(mainContent(html))).toContain("infraestrutura de agentes");
  });
});

describe("extractTitle", () => {
  it("recusa um h1 que na verdade é um parágrafo e recorre ao title", () => {
    // Careers pages usam h1 para slogan e manchete. Um "título" de trezentos
    // caracteres não casaria com cluster nenhum e ainda apareceria assim na
    // interface.
    const html = `<title>Staff AI Engineer — Acme</title><h1>${"palavra ".repeat(40)}</h1>`;
    expect(extractTitle(html)).toBe("Staff AI Engineer");
  });

  it("devolve null quando o title só tem um fragmento", () => {
    // Um título de dois caracteres não identifica vaga nenhuma; guardá-lo seria
    // pior que assumir a ausência.
    expect(extractTitle("<title>—</title>")).toBeNull();
  });
});

describe("cleanBullets", () => {
  it("descarta item de menu longo o bastante para passar pelo filtro de tamanho", () => {
    // O corte por tamanho pega a maioria do lixo de navegação, mas não "Privacy
    // Policy and Cookie Preferences", que tem cara de frase. Sem a lista de
    // ruído, esse texto entraria como requisito da vaga.
    expect(
      cleanBullets([
        "Privacy Policy and Cookie Preferences for this website",
        "Cinco anos ou mais construindo sistemas distribuídos em produção",
      ]),
    ).toEqual(["Cinco anos ou mais construindo sistemas distribuídos em produção"]);
  });
});

describe("parseRobots", () => {
  it("ignora regra escrita antes de qualquer User-agent", () => {
    // Sem grupo, a diretiva não se aplica a ninguém. Assumi-la global bloquearia
    // um host inteiro por um arquivo mal formatado.
    const rules = parseRobots("Disallow: /tudo\n\nUser-agent: *\nDisallow: /admin");
    expect(rules.rules).toEqual([{ allow: false, path: "/admin" }]);
  });

  it("não inventa permissão nem proibição quando nenhum grupo se aplica", () => {
    // Só há grupo para o Googlebot: nada foi dito sobre nós, e ausência de
    // proibição é o único caso em que buscar é aceitável.
    const rules = parseRobots("User-agent: googlebot\nDisallow: /");
    expect(rules).toEqual({ rules: [], crawlDelayMs: null });
  });

  it("ignora Crawl-delay que não é número ou é negativo", () => {
    // Um atraso NaN viraria `setTimeout(NaN)` — isto é, nenhum atraso — e um
    // negativo seria o mesmo. Descartar deixa o padrão de 1s valendo.
    expect(parseRobots("User-agent: *\nCrawl-delay: rápido").crawlDelayMs).toBeNull();
    expect(parseRobots("User-agent: *\nCrawl-delay: -5").crawlDelayMs).toBeNull();
  });

  it("ignora linha sem dois-pontos, que não é diretiva", () => {
    const rules = parseRobots("User-agent: *\nisto não é diretiva\nDisallow: /x");
    expect(rules.rules).toEqual([{ allow: false, path: "/x" }]);
  });
});

describe("robotsFor", () => {
  it("busca uma vez por origem e reusa o resultado", async () => {
    // Uma varredura de 40 páginas no mesmo host faria 40 pedidos de robots.txt —
    // mais requisições do que as vagas em si, contra quem nos serve de graça.
    const port = fixtureHttp({ "acme.test/robots.txt": "User-agent: *\nDisallow: /admin" });
    setHttpPort(port);

    await robotsFor("https://acme.test");
    await robotsFor("https://acme.test");
    expect(port.calls).toHaveLength(1);
  });

  it("trata robots.txt ilegível como ausência de regra, não como proibição", async () => {
    // 404, timeout e bloqueio de robô não dizem nada sobre permissão. Tratá-los
    // como "não pode" derrubaria um host inteiro por uma falha passageira.
    setHttpPort(fixtureHttp({ "sem.test/robots.txt": { status: 500 } }));
    expect(await robotsFor("https://sem.test")).toEqual({ rules: [], crawlDelayMs: null });
  });
});

describe("mayFetch", () => {
  it("recusa o que nem chega a ser URL, em vez de tentar resolver", async () => {
    // Uma URL malformada não tem origem, então não há robots.txt a consultar —
    // e o único desfecho seguro é não buscar.
    setHttpPort(fixtureHttp({}));
    expect(await mayFetch("nao-e-url")).toBe(false);
  });

  it("leva a query em conta, porque a regra pode mirar exatamente nela", async () => {
    // `Disallow: /busca?` só faz sentido se o caminho comparado incluir a query;
    // comparar só o pathname deixaria passar exatamente o que foi proibido.
    setHttpPort(fixtureHttp({ "acme.test/robots.txt": "User-agent: *\nDisallow: /vagas?page=" }));
    expect(await mayFetch("https://acme.test/vagas?page=2")).toBe(false);
    expect(await mayFetch("https://acme.test/vagas/staff-engineer")).toBe(true);
  });
});

describe("bordas do parser de robots", () => {
  it("ignora diretiva que não conhece em vez de tratá-la como regra", () => {
    // `Sitemap` e `Host` aparecem em quase todo robots.txt real. Interpretá-las
    // como caminho proibido bloquearia o host inteiro.
    const rules = parseRobots("User-agent: *\nSitemap: https://acme.test/sitemap.xml\nDisallow: /x");
    expect(rules.rules).toEqual([{ allow: false, path: "/x" }]);
  });

  it("decide pela regra mais longa, qualquer que seja a ordem no arquivo", () => {
    // Longest-match é o que a especificação manda, e a ordem no arquivo não pode
    // decidir: com a ordem mandando, um `Disallow: /vagas` escrito por último
    // apagaria a permissão específica escrita acima — e a fonte inteira sumiria.
    const permissivaPrimeiro = parseRobots("User-agent: *\nAllow: /vagas/publicas\nDisallow: /vagas");
    const restritivaPrimeiro = parseRobots("User-agent: *\nDisallow: /vagas\nAllow: /vagas/publicas");

    for (const rules of [permissivaPrimeiro, restritivaPrimeiro]) {
      expect(isAllowed(rules, "/vagas/publicas/1")).toBe(true);
      expect(isAllowed(rules, "/vagas/internas/1")).toBe(false);
    }
  });
});
