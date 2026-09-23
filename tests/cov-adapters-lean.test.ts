/**
 * Resposta magra e caminhos de desistência dos adapters Workable e Hacker News.
 *
 * É a regra 8 aplicada à ingestão — campo ausente vira `null`, nunca um valor
 * inventado — e o caminho que sobra quando a cota acaba ou o conteúdo não é uma
 * vaga. Nenhum dos dois estava exercitado: `workable.ts` tinha 62,5% de branches
 * e `hackernews.ts` 71,4%, e o que faltava era exatamente isto.
 *
 * Adapter é a fronteira por onde entra dado de terceiro. O caminho feliz prova
 * que o mapeamento está certo quando a API colabora; estes casos provam o que
 * acontece quando ela não colabora, que é o mais frequente em produção.
 */
import { afterEach, describe, expect, it } from "vitest";
import { hackernews, parseHiringPost } from "../src/core/sources/hackernews.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import { workable } from "../src/core/sources/workable.ts";

afterEach(() => resetHttpPort());

/** Conta as reservas pedidas, recusando depois de `allow`. */
function reserver(allow = Number.POSITIVE_INFINITY) {
  let calls = 0;
  return { reserve: async () => ++calls <= allow, calls: () => calls };
}

describe("Workable diante de resposta magra", () => {
  /** Uma vaga com só o obrigatório: nenhum campo opcional presente. */
  const magra = {
    id: "w-magra",
    title: "  Staff Engineer  ",
    url: "https://jobs.workable.com/view/w-magra",
  };

  it("UT-120 campo ausente vira null, e o empregador cai no nome da fonte", async () => {
    setHttpPort(fixtureHttp({ "jobs.workable.com": { jobs: [magra] } }));

    const { jobs, warnings } = await workable.fetchJobs({
      kind: "workable",
      handle: "",
      label: "Workable",
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      externalId: "w-magra",
      // Sem `company.title`, o rótulo da fonte é o único nome disponível.
      companyName: "Workable",
      title: "Staff Engineer",
      locationRaw: null,
      remote: null,
      employmentType: null,
      descriptionHtml: null,
      descriptionText: null,
      postedAt: null,
    });
    // Sem `totalSize` não há como afirmar que faltou página, então não avisa.
    expect(warnings).toEqual([]);
  });

  it("sem próximo token a lista acabou: completa", async () => {
    setHttpPort(fixtureHttp({ "jobs.workable.com": { jobs: [magra] } }));
    const { completeness } = await workable.fetchJobs({ kind: "workable", handle: "", label: "Workable" });
    expect(completeness).toBe("complete");
  });

  it("teto de páginas com token pendente é janela parcial", async () => {
    // As cinco páginas do orçamento acabaram e a plataforma ainda oferecia a
    // seguinte: o que ficou depois nunca foi visto.
    setHttpPort(fixtureHttp({ "jobs.workable.com": { jobs: [magra], nextPageToken: "sempre" } }));
    const { completeness } = await workable.fetchJobs({ kind: "workable", handle: "", label: "Workable" });
    expect(completeness).toBe("partial");
  });

  it("UT-121 `workplace` presente e diferente de remoto é presencial, não desconhecido", async () => {
    setHttpPort(
      fixtureHttp({
        "jobs.workable.com": {
          jobs: [{ ...magra, workplace: "on_site", company: { title: "  Acme  " } }],
        },
      }),
    );

    const { jobs } = await workable.fetchJobs({ kind: "workable", handle: "", label: "Workable" });

    expect(jobs[0]!.remote).toBe(false);
    expect(jobs[0]!.companyName).toBe("Acme");
  });

  it("UT-122 página vazia com token encerra a paginação em vez de girar", async () => {
    // `nextPageToken` presente com `jobs` vazio é o par que faria o laço seguir
    // pedindo página até o fim do orçamento, sem trazer nada.
    const http = fixtureHttp({
      "pageToken=": { jobs: [], nextPageToken: "outro" },
      "jobs.workable.com": { jobs: [magra], nextPageToken: "t2", totalSize: 9 },
    });
    setHttpPort(http);

    const { jobs, warnings, completeness } = await workable.fetchJobs({
      kind: "workable",
      handle: "",
      label: "Workable",
    });

    expect(jobs).toHaveLength(1);
    expect(http.calls).toHaveLength(2);
    // Página vazia com token pendente não é o fim declarado pela plataforma.
    expect(completeness).toBe("partial");
    // Com `totalSize` maior que o que veio, o aviso diz que são as primeiras
    // páginas — é o outro lado do caso UT-120.
    expect(warnings[0]).toMatch(/1 de 9 vagas/);
  });

  it("UT-123 cota recusada antes da primeira página devolve a parada de cota", async () => {
    setHttpPort(fixtureHttp({ "jobs.workable.com": { jobs: [magra] } }));

    const parada = await workable.termSearch!.search("typescript", {
      limit: 100,
      reserve: reserver(0).reserve,
    });

    expect(parada.stoppedByQuota).toBe(true);
    expect(parada.jobs).toEqual([]);
  });
});

describe("Hacker News diante de comentário que não é vaga", () => {
  const hiring = { objectID: "t1", title: "Ask HN: Who is hiring? (September 2026)" };

  it("UT-124 sem texto, com menos de três campos, ou sem empresa não vira vaga", () => {
    expect(parseHiringPost({ objectID: "c0", comment_text: null } as never)).toBeNull();
    // Duas partes só: não dá para separar empresa, cargo e local.
    expect(parseHiringPost({ objectID: "c1", comment_text: "Acme | Remote" } as never)).toBeNull();
    // O nome inteiro entre parênteses é batch, e sobra string vazia.
    expect(
      parseHiringPost({ objectID: "c2", comment_text: "(YC S26) | Staff Engineer | Remote" } as never),
    ).toBeNull();
  });

  it("UT-125 sem cargo reconhecível, o primeiro campo depois da empresa é o cargo", () => {
    const vaga = parseHiringPost({
      objectID: "c3",
      comment_text: "Acme | Algo Que Nao Casa | Brazil",
    } as never);

    expect(vaga).toMatchObject({ companyName: "Acme", title: "Algo Que Nao Casa" });
    // `created_at` ausente é neutro, nunca "agora".
    expect(vaga!.postedAt).toBeNull();
  });

  it("UT-126 busca recusada na primeira reserva não chega a pedir a thread", async () => {
    const http = fixtureHttp({ search_by_date: { hits: [hiring] } });
    setHttpPort(http);

    const parada = await hackernews.termSearch!.search("laravel", {
      limit: 100,
      reserve: reserver(0).reserve,
    });

    expect(parada.stoppedByQuota).toBe(true);
    expect(http.calls).toEqual([]);
  });

  it("UT-127 busca por termo sem thread devolve vazio sem estourar", async () => {
    // `hits` ausente, e não vazio: é a resposta magra da API.
    setHttpPort(fixtureHttp({ search_by_date: {} }));

    const resultado = await hackernews.termSearch!.search("laravel", {
      limit: 100,
      reserve: reserver().reserve,
    });

    expect(resultado).toMatchObject({ jobs: [], totalHint: 0, stoppedByQuota: false });
  });

  it("UT-128 thread existe mas a resposta da thread não traz `hits`", async () => {
    setHttpPort(fixtureHttp({ search_by_date: { hits: [hiring] }, "/search?": {} }));

    const resultado = await hackernews.fetchJobs({
      kind: "hackernews",
      handle: "",
      label: "Hacker News",
    });

    expect(resultado.jobs).toEqual([]);
    // Sem a contagem do Algolia, nada prova que a thread veio inteira.
    expect(resultado.completeness).toBe("partial");
  });

  it("thread lida inteira é completa; cortada pelo teto de página, parcial", async () => {
    const comentario = (id: string) => ({
      objectID: id,
      parent_id: "t1",
      comment_text: "Acme | Staff Engineer | Remote",
    });
    setHttpPort(
      fixtureHttp({ search_by_date: { hits: [hiring] }, "/search?": { hits: [comentario("c1")], nbHits: 1 } }),
    );
    const inteira = await hackernews.fetchJobs({ kind: "hackernews", handle: "", label: "Hacker News" });
    expect(inteira.completeness).toBe("complete");

    setHttpPort(
      fixtureHttp({ search_by_date: { hits: [hiring] }, "/search?": { hits: [comentario("c1")], nbHits: 1200 } }),
    );
    const cortada = await hackernews.fetchJobs({ kind: "hackernews", handle: "", label: "Hacker News" });
    expect(cortada.completeness).toBe("partial");
  });

  it("UT-129 story que não é 'Who is hiring?' não conta como thread", async () => {
    // O mesmo robô publica "Who wants to be hired?", que é o inverso: gente
    // oferecendo trabalho. Tratar como thread de vagas encheria o acervo de
    // currículos.
    setHttpPort(
      fixtureHttp({
        search_by_date: {
          hits: [{ objectID: "t9", title: "Ask HN: Who wants to be hired? (September 2026)" }],
        },
      }),
    );

    const resultado = await hackernews.fetchJobs({
      kind: "hackernews",
      handle: "",
      label: "Hacker News",
    });

    expect(resultado.jobs).toEqual([]);
    expect(resultado.warnings[0]).toMatch(/no "Who is hiring\?" thread/);
  });
});
