// Suite: Braintrust — paginação, degradação e elegibilidade regional
// Invariante: é a única fonte que publica elegibilidade como DADO ESTRUTURADO, e
// para um candidato sem autorização de trabalho nos EUA isso é a informação mais
// cara que uma fonte pode dar. A linha de elegibilidade que o adapter escreve é o
// que transforma `locations[].country` em algo que o componente geográfico — que
// lê prosa — consegue usar.
// Fronteira DENTRO: paginação, teto de vagas, falha de detalhe e a linha de
// elegibilidade.
// Fronteira FORA: rede (porta HTTP) e o scorer.
import { afterEach, describe, expect, it } from "vitest";
import { braintrust } from "../src/core/sources/braintrust.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import type { SourceConfig } from "../src/core/sources/types.ts";

function config(handle = ""): SourceConfig {
  return { kind: "braintrust", handle, label: "Braintrust" };
}

afterEach(() => resetHttpPort());

describe("elegibilidade", () => {
  it("reconhece região aberta a LATAM mesmo sem país listado", async () => {
    // "south_america" não é código ISO e não entraria por `country`. Sem esta
    // linha, uma vaga estruturalmente elegível ficaria indistinguível de uma
    // vaga vagamente "remota" — e perderia a disputa para ela.
    setHttpPort(
      fixtureHttp({
        "api/jobs/1/": {
          id: 1,
          title: "Staff Engineer",
          locations: [{ custom_location: "south_america" }, { custom_location: "worldwide" }],
        },
        "api/jobs/?limit=20": {
          count: 1,
          next: null,
          results: [
            {
              id: 1,
              title: "Staff Engineer",
              locations: [{ custom_location: "south_america" }, { custom_location: "worldwide" }],
            },
          ],
        },
      }),
    );

    const { jobs } = await braintrust.fetchJobs(config());
    expect(jobs[0]!.descriptionText).toContain("Open to LATAM / worldwide.");
    // Nenhum país ISO foi listado, então não pode afirmar Brasil.
    expect(jobs[0]!.descriptionText).not.toContain("Open to Brazil.");
    expect(jobs[0]!.locationRaw).toBe("south_america / worldwide");
  });
});

describe("paginação", () => {
  it("segue o cursor `next` até acabar a lista", async () => {
    // A API entrega 20 por página; parar na primeira jogaria fora a maior parte
    // do board sem nenhum sinal de que houve corte.
    const port = fixtureHttp({
      "api/jobs/?limit=20&offset=20": {
        count: 2,
        next: null,
        results: [{ id: 2, title: "Segunda", employer: { name: "Y" } }],
      },
      "api/jobs/1/": { id: 1, title: "Primeira", description: "<p>corpo um</p>" },
      "api/jobs/2/": { id: 2, title: "Segunda", description: "<p>corpo dois</p>" },
      "api/jobs/?limit=20": {
        count: 2,
        next: "https://app.usebraintrust.com/api/jobs/?limit=20&offset=20",
        results: [{ id: 1, title: "Primeira", employer: { name: "X" } }],
      },
    });
    setHttpPort(port);

    const { jobs, warnings } = await braintrust.fetchJobs(config());
    expect(jobs.map((j) => j.externalId)).toEqual(["1", "2"]);
    expect(jobs[0]!.descriptionText).toContain("corpo um");
    // As duas páginas foram lidas e a contagem bate com `count`: sem aviso.
    expect(warnings).toEqual([]);
  });

  it("avisa quando o teto do handle corta parte do board", async () => {
    // Um recorte silencioso faz "2 de 121 vagas" parecer "o board tem 2 vagas",
    // e a fonte parece morta quando na verdade está limitada por configuração.
    setHttpPort(
      fixtureHttp({
        "api/jobs/1/": { id: 1, title: "Primeira" },
        "api/jobs/?limit=20": {
          count: 121,
          next: null,
          results: [
            { id: 1, title: "Primeira" },
            { id: 2, title: "Segunda" },
          ],
        },
      }),
    );

    const { jobs, warnings } = await braintrust.fetchJobs(config("1"));
    expect(jobs).toHaveLength(1);
    expect(warnings.join(" ")).toContain("1 de 121");
  });
});

describe("degradação", () => {
  it("mantém a vaga e declara o prejuízo quando o detalhe falha", async () => {
    // A listagem não traz descrição nenhuma. Sem o detalhe, a vaga pontua zero em
    // keywords — o mesmo modo de falha que já apagou 4.538 descrições no Lever.
    // Descartar a vaga esconderia o problema; o aviso o torna auditável.
    setHttpPort(
      fixtureHttp({
        "api/jobs/2/": { id: 2, title: "Com detalhe", description: "<p>corpo</p>" },
        "api/jobs/?limit=20": {
          count: 2,
          next: null,
          results: [
            { id: 1, title: "Sem detalhe", employer: { name: "X" }, main_skills: [{ name: "Go" }] },
            { id: 2, title: "Com detalhe" },
          ],
        },
      }),
    );

    const { jobs, warnings } = await braintrust.fetchJobs(config());
    expect(jobs).toHaveLength(2);
    // O resumo da listagem sobrevive: skills e elegibilidade ainda dão algum texto.
    expect(jobs[0]!.descriptionText).toContain("Skills: Go.");
    expect(warnings.join(" ")).toContain("1 vaga(s) sem detalhe");
  });
});

describe("bordas de dado", () => {
  it("não converte orçamento ausente, zerado ou ilegível em piso salarial", async () => {
    // Um `compMin` de zero entraria no comparador de piso como oferta real e
    // rebaixaria a vaga; pior, "0" e "não informado" viram a mesma coisa.
    setHttpPort(
      fixtureHttp({
        "api/jobs/1/": { id: 1, title: "A", budget_minimum_usd: "0", budget_maximum_usd: "abc" },
        "api/jobs/?limit=20": {
          results: [{ id: 1, title: "A", budget_minimum_usd: "0", budget_maximum_usd: "abc" }],
        },
      }),
    );

    const { jobs } = await braintrust.fetchJobs(config());
    expect(jobs[0]!.compMin).toBeNull();
    expect(jobs[0]!.compMax).toBeNull();
    expect(jobs[0]!.compCurrency).toBeNull();
  });

  it("declara localização nula quando nenhuma entrada tem nome legível", async () => {
    // Uma lista de objetos vazios não é "sem restrição": é dado que não dá para
    // mostrar. Emitir " / " seria pior que emitir nada.
    setHttpPort(
      fixtureHttp({
        "api/jobs/2/": { id: 2, title: "B", locations: [{}, { location: "" }] },
        "api/jobs/?limit=20": { results: [{ id: 2, title: "B", locations: [{}] }] },
      }),
    );

    const { jobs } = await braintrust.fetchJobs(config());
    expect(jobs[0]!.locationRaw).toBeNull();
  });

  it("registra na descrição que a localização é obrigatória", async () => {
    // A diferença entre "prefere alguém no fuso X" e "só contrata quem mora em
    // X" é eliminatória para um candidato no Brasil; o scorer lê prosa, então
    // isso precisa virar frase.
    setHttpPort(
      fixtureHttp({
        "api/jobs/3/": {
          id: 3,
          title: "C",
          locations: [{ country: "US", location: "United States" }],
          locations_strongly_required: true,
        },
        "api/jobs/?limit=20": { results: [{ id: 3, title: "C" }] },
      }),
    );

    const { jobs } = await braintrust.fetchJobs(config());
    expect(jobs[0]!.descriptionText).toContain("Location is strongly required.");
    expect(jobs[0]!.descriptionText).toContain("Eligible countries: US.");
    expect(jobs[0]!.descriptionText).not.toContain("Open to Brazil.");
  });

  it("aceita uma página de listagem sem contagem e sem resultados", async () => {
    setHttpPort(fixtureHttp({ "api/jobs/?limit=20": {} }));
    await expect(braintrust.fetchJobs(config())).resolves.toEqual({ jobs: [], warnings: [] });
  });
});

describe("orçamento numérico", () => {
  it("aceita orçamento já entregue como número, não só como texto", async () => {
    // A API alterna entre "60.00" e 60 no mesmo campo; tratar só um dos dois
    // apagaria metade dos pisos salariais da fonte.
    setHttpPort(
      fixtureHttp({
        "api/jobs/9/": { id: 9, title: "D", budget_minimum_usd: 60, budget_maximum_usd: 70 },
        "api/jobs/?limit=20": { results: [{ id: 9, title: "D" }] },
      }),
    );

    const { jobs } = await braintrust.fetchJobs(config());
    expect(jobs[0]!.compMin).toBe(60);
    expect(jobs[0]!.compMax).toBe(70);
    expect(jobs[0]!.compCurrency).toBe("USD");
  });
});
