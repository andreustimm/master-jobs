// Suite: adaptadores de ATS (Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee)
// Invariante: cada ATS quebra a descrição de um jeito diferente — campo vazio em
// vez de nulo, HTML duplamente escapado, corpo ausente na listagem. O adapter é a
// única camada que sabe disso; o que ele deixar passar chega ao scorer como
// "vaga sem texto" e pontua zero em keywords por motivo de formato.
// Fronteira DENTRO: mapeamento RawJob, paginação, avisos.
// Fronteira FORA: rede (porta HTTP com dublê) e scoring.
import { afterEach, describe, expect, it } from "vitest";
import {
  ashby,
  greenhouse,
  lever,
  recruitee,
  smartrecruiters,
} from "../src/core/sources/ats.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import type { SourceConfig } from "../src/core/sources/types.ts";

function config(kind: SourceConfig["kind"], handle: string, label = "Acme Corp"): SourceConfig {
  return { kind, handle, label };
}

afterEach(() => resetHttpPort());

describe("greenhouse", () => {
  it("prefere first_published a updated_at para datar a vaga", async () => {
    // `updated_at` muda quando o recrutador corrige uma vírgula; usá-lo como
    // publicação rejuvenesceria vagas velhas e inflaria o componente de frescor.
    setHttpPort(
      fixtureHttp({
        "boards-api.greenhouse.io": {
          jobs: [
            {
              id: 1,
              title: " Staff Engineer ",
              absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
              first_published: "2026-06-01T00:00:00Z",
              updated_at: "2026-08-15T00:00:00Z",
            },
            {
              id: 2,
              title: "Sem publicação",
              absolute_url: "https://boards.greenhouse.io/acme/jobs/2",
              updated_at: "2026-08-15T00:00:00Z",
            },
            { id: 3, title: "Sem data", absolute_url: "https://boards.greenhouse.io/acme/jobs/3" },
          ],
        },
      }),
    );

    const { jobs } = await greenhouse.fetchJobs(config("greenhouse", "acme"));
    expect(jobs[0]!.postedAt).toBe("2026-06-01T00:00:00Z");
    expect(jobs[1]!.postedAt).toBe("2026-08-15T00:00:00Z");
    // Regra 8: sem data não é vaga velha — é ausência, e ausência é neutra.
    expect(jobs[2]!.postedAt).toBeNull();
  });

  it("usa o rótulo da configuração quando o board não devolve a empresa", async () => {
    // Vaga anônima quebra dedupe entre fontes e pesquisa de empresa; o nome do
    // config é a única fonte confiável nesse caso.
    setHttpPort(
      fixtureHttp({
        "boards-api.greenhouse.io": {
          jobs: [
            { id: 1, title: "A", absolute_url: "u" },
            { id: 2, title: "B", absolute_url: "u", company_name: "Subsidiária S.A." },
          ],
        },
      }),
    );

    const { jobs } = await greenhouse.fetchJobs(config("greenhouse", "acme"));
    expect(jobs[0]!.companyName).toBe("Acme Corp");
    expect(jobs[1]!.companyName).toBe("Subsidiária S.A.");
    // Sem `content` não há HTML a desescapar, e o texto tem de ser nulo — não "".
    expect(jobs[0]!.descriptionHtml).toBeNull();
    expect(jobs[0]!.descriptionText).toBeNull();
    expect(jobs[0]!.locationRaw).toBeNull();
  });

  it("devolve lista vazia quando o board não existe mas responde JSON", async () => {
    setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": {} }));
    await expect(greenhouse.fetchJobs(config("greenhouse", "inexistente"))).resolves.toEqual({
      jobs: [],
      warnings: [],
    });
  });

  it("codifica o handle na URL, para um token com caractere especial", async () => {
    const port = fixtureHttp({ "boards-api.greenhouse.io": { jobs: [] } });
    setHttpPort(port);
    await greenhouse.fetchJobs(config("greenhouse", "acme/one"));
    expect(port.calls[0]).toContain("/boards/acme%2Fone/jobs?content=true");
  });
});

describe("lever", () => {
  it("prefere allLocations à localização única, que só mostra o primeiro escritório", async () => {
    // Uma vaga aberta em cinco países aparece como "New York" se lermos só
    // `categories.location` — e o componente geográfico a elimina por engano.
    setHttpPort(
      fixtureHttp({
        "api.lever.co": [
          {
            id: "a",
            text: "Engineer",
            hostedUrl: "https://jobs.lever.co/acme/a",
            workplaceType: "Remote",
            categories: {
              location: "New York",
              allLocations: ["New York", "Remote - Brazil"],
              commitment: "Full-time",
            },
            createdAt: 1_755_000_000_000,
          },
          {
            id: "b",
            text: "Engineer",
            hostedUrl: "https://jobs.lever.co/acme/b",
            workplaceType: "On-site",
            categories: { location: "Austin" },
          },
          { id: "c", text: "Engineer", hostedUrl: "https://jobs.lever.co/acme/c" },
        ],
      }),
    );

    const { jobs } = await lever.fetchJobs(config("lever", "acme"));
    expect(jobs[0]!.locationRaw).toBe("New York / Remote - Brazil");
    expect(jobs[0]!.remote).toBe(true);
    expect(jobs[0]!.employmentType).toBe("Full-time");
    expect(jobs[0]!.postedAt).toBe(new Date(1_755_000_000_000).toISOString());
    expect(jobs[1]!.locationRaw).toBe("Austin");
    expect(jobs[1]!.remote).toBe(false);
    // Sem `workplaceType` o board não disse nada — e "não disse" não é "não é
    // remoto" (regra 8).
    expect(jobs[2]!.remote).toBeNull();
    expect(jobs[2]!.locationRaw).toBeNull();
    expect(jobs[2]!.postedAt).toBeNull();
  });

  it("cai para o link hospedado quando não há URL de candidatura", async () => {
    setHttpPort(
      fixtureHttp({
        "api.lever.co": [{ id: "a", text: "E", hostedUrl: "https://jobs.lever.co/acme/a" }],
      }),
    );
    const { jobs } = await lever.fetchJobs(config("lever", "acme"));
    expect(jobs[0]!.applyUrl).toBe("https://jobs.lever.co/acme/a");
  });

  it("deixa a descrição nula quando nem corpo nem seções trazem texto", async () => {
    // O adapter junta corpo + seções; a junção de dois vazios tem de ser null,
    // porque "" derrota todo `??` a jusante — o bug que apagou 4.538 descrições.
    setHttpPort(
      fixtureHttp({
        "api.lever.co": [
          {
            id: "a",
            text: "E",
            hostedUrl: "u",
            descriptionPlain: "",
            description: "",
            lists: [{ text: "", content: "" }],
          },
        ],
      }),
    );
    const { jobs } = await lever.fetchJobs(config("lever", "acme"));
    expect(jobs[0]!.descriptionText).toBeNull();
  });
});

describe("ashby", () => {
  it("ignora vagas despublicadas, que continuam na resposta da API", async () => {
    // `isListed: false` é vaga fora do ar. Ingerida, ela entra no funil e o
    // usuário se candidata a algo que não existe mais.
    setHttpPort(
      fixtureHttp({
        "api.ashbyhq.com": {
          jobs: [
            { id: "on", title: "Publicada", jobUrl: "u1", isListed: true },
            { id: "off", title: "Despublicada", jobUrl: "u2", isListed: false },
            { id: "omitido", title: "Sem o campo", jobUrl: "u3" },
          ],
        },
      }),
    );

    const { jobs } = await ashby.fetchJobs(config("ashby", "acme"));
    // Ausência do campo não é despublicação: só `false` explícito exclui.
    expect(jobs.map((j) => j.externalId)).toEqual(["on", "omitido"]);
  });

  it("escolhe a linha de salário e ignora a de equity, que não tem faixa", async () => {
    setHttpPort(
      fixtureHttp({
        "api.ashbyhq.com": {
          jobs: [
            {
              id: "1",
              title: "Staff",
              jobUrl: "https://jobs.ashbyhq.com/acme/1",
              applyUrl: "https://jobs.ashbyhq.com/acme/1/application",
              isRemote: true,
              employmentType: "FullTime",
              publishedAt: "2026-08-01T00:00:00Z",
              location: "Remote",
              secondaryLocations: [{ location: "Brazil" }, {}, { location: "Portugal" }],
              descriptionPlain: "",
              descriptionHtml: "<p>Plataforma de agentes.</p>",
              compensation: {
                summaryComponents: [
                  { compensationType: "EquityPercentage", interval: "NONE" },
                  {
                    compensationType: "Salary",
                    interval: "YEAR",
                    currencyCode: "USD",
                    minValue: 180_000,
                    maxValue: 220_000,
                  },
                ],
              },
            },
          ],
        },
      }),
    );

    const { jobs } = await ashby.fetchJobs(config("ashby", "acme"));
    expect(jobs[0]!.compMin).toBe(180_000);
    expect(jobs[0]!.compCurrency).toBe("USD");
    expect(jobs[0]!.compPeriod).toBe("YEAR");
    // Locais secundários sem `location` não podem virar separadores órfãos.
    expect(jobs[0]!.locationRaw).toBe("Remote / Brazil / Portugal");
    // Mesma armadilha do Lever: `descriptionPlain` vazio não pode ganhar do HTML.
    expect(jobs[0]!.descriptionText).toBe("Plataforma de agentes.");
    expect(jobs[0]!.applyUrl).toBe("https://jobs.ashbyhq.com/acme/1/application");
  });

  it("deriva remoto de workplaceType quando isRemote não vem", async () => {
    setHttpPort(
      fixtureHttp({
        "api.ashbyhq.com": {
          jobs: [
            { id: "1", title: "A", jobUrl: "u", workplaceType: "Remote" },
            { id: "2", title: "B", jobUrl: "u", workplaceType: "Hybrid" },
            { id: "3", title: "C", jobUrl: "u" },
          ],
        },
      }),
    );

    const { jobs } = await ashby.fetchJobs(config("ashby", "acme"));
    expect(jobs[0]!.remote).toBe(true);
    expect(jobs[1]!.remote).toBe(false);
    expect(jobs[2]!.remote).toBeNull();
    expect(jobs[2]!.applyUrl).toBe("u");
    expect(jobs[2]!.locationRaw).toBeNull();
    expect(jobs[2]!.compMin).toBeNull();
  });

  it("avisa quando o board responde sem nenhuma vaga listada", async () => {
    // Board vazio e board com handle errado se parecem; sem o aviso a fonte
    // morre em silêncio e ninguém percebe até o funil secar.
    setHttpPort(fixtureHttp({ "api.ashbyhq.com": { jobs: [] } }));
    const result = await ashby.fetchJobs(config("ashby", "acme"));
    expect(result.jobs).toEqual([]);
    expect(result.warnings.join(" ")).toContain("ashby:acme");
  });
});

describe("smartrecruiters", () => {
  it("pagina até a página incompleta em vez de parar na primeira", async () => {
    // A API entrega no máximo 100 por chamada. Ler só a primeira página perde
    // silenciosamente tudo que passa disso num board grande.
    const page = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, name: `Vaga ${i}` }));

    const port = fixtureHttp({
      "offset=0": { content: page("p0", 100) },
      "offset=100": { content: page("p1", 2) },
    });
    setHttpPort(port);

    const { jobs, warnings } = await smartrecruiters.fetchJobs(config("smartrecruiters", "acme"));
    expect(jobs).toHaveLength(102);
    expect(port.calls).toHaveLength(2);
    // O aviso existe porque a listagem não traz corpo: quem lê o relatório
    // precisa saber que o score de keywords veio só do título.
    expect(warnings.join(" ")).toContain("titles only");
  });

  it("compõe cidade, região e país e monta a URL pública da vaga", async () => {
    setHttpPort(
      fixtureHttp({
        "offset=0": {
          content: [
            {
              id: "abc",
              name: " Principal Architect ",
              releasedDate: "2026-08-01T00:00:00Z",
              location: { city: "São Paulo", country: "br", remote: true },
              typeOfEmployment: { label: "Permanent" },
              company: { name: "Filial Ltda" },
            },
            { id: "sem-local", name: "B" },
          ],
        },
      }),
    );

    const { jobs } = await smartrecruiters.fetchJobs(config("smartrecruiters", "acme"));
    expect(jobs[0]!.locationRaw).toBe("São Paulo, br");
    expect(jobs[0]!.url).toBe("https://jobs.smartrecruiters.com/acme/abc");
    expect(jobs[0]!.companyName).toBe("Filial Ltda");
    expect(jobs[0]!.title).toBe("Principal Architect");
    // Sem corpo na listagem, descrição nula é a verdade — não string vazia.
    expect(jobs[0]!.descriptionText).toBeNull();
    expect(jobs[1]!.locationRaw).toBeNull();
    expect(jobs[1]!.remote).toBeNull();
    expect(jobs[1]!.companyName).toBe("Acme Corp");
  });

  it("não avisa sobre corpo ausente quando não trouxe vaga nenhuma", async () => {
    // Aviso sobre qualidade de dado inexistente é ruído no relatório de sync.
    setHttpPort(fixtureHttp({ "offset=0": {} }));
    await expect(smartrecruiters.fetchJobs(config("smartrecruiters", "acme"))).resolves.toEqual({
      jobs: [],
      warnings: [],
    });
  });
});

describe("recruitee", () => {
  it("junta descrição e requisitos, que a API separa em dois campos", async () => {
    // Os requisitos são justamente onde mora o sinal de keyword; ignorá-los
    // faria toda vaga da fonte pontuar como se não pedisse nada.
    setHttpPort(
      fixtureHttp({
        "recruitee.com/api/offers": {
          offers: [
            {
              id: 55,
              title: " Staff Engineer ",
              slug: "staff-engineer",
              careers_url: "https://acme.recruitee.com/o/staff-engineer",
              careers_apply_url: "https://acme.recruitee.com/o/staff-engineer/c/new",
              location: "Remote — LATAM",
              remote: true,
              employment_type_code: "fulltime",
              published_at: "2026-08-01",
              description: "<p>Construímos plataforma.</p>",
              requirements: "<ul><li>Kubernetes em produção</li></ul>",
            },
          ],
        },
      }),
    );

    const { jobs } = await recruitee.fetchJobs(config("recruitee", "acme"));
    expect(jobs[0]!.externalId).toBe("55");
    expect(jobs[0]!.descriptionText).toContain("plataforma");
    expect(jobs[0]!.descriptionText).toContain("Kubernetes");
    expect(jobs[0]!.applyUrl).toBe("https://acme.recruitee.com/o/staff-engineer/c/new");
  });

  it("monta URL e localização a partir das partes quando os campos prontos faltam", async () => {
    setHttpPort(
      fixtureHttp({
        "recruitee.com/api/offers": {
          offers: [
            { id: 1, title: "A", slug: "a", city: "Lisboa", country: "Portugal" },
            { id: 2, title: "B", slug: "b" },
          ],
        },
      }),
    );

    const { jobs } = await recruitee.fetchJobs(config("recruitee", "acme"));
    expect(jobs[0]!.url).toBe("https://acme.recruitee.com/o/a");
    expect(jobs[0]!.locationRaw).toBe("Lisboa, Portugal");
    expect(jobs[0]!.applyUrl).toBeNull();
    // Sem nenhuma parte de localização o campo é nulo, não string vazia.
    expect(jobs[1]!.locationRaw).toBeNull();
    // Sem corpo nem requisitos, o HTML montado é "" e precisa virar null.
    expect(jobs[1]!.descriptionHtml).toBeNull();
    expect(jobs[1]!.descriptionText).toBeNull();
    expect(jobs[1]!.remote).toBeNull();
  });

  it("devolve lista vazia quando a resposta não traz offers", async () => {
    setHttpPort(fixtureHttp({ "recruitee.com/api/offers": {} }));
    await expect(recruitee.fetchJobs(config("recruitee", "acme"))).resolves.toEqual({
      jobs: [],
      warnings: [],
    });
  });
});

describe("bordas de resposta", () => {
  it("lever aceita corpo nulo sem derrubar a sincronização", async () => {
    // Um board removido devolve `null` em vez de `[]`; deixar isso estourar
    // custaria todas as outras fontes da mesma execução.
    setHttpPort(fixtureHttp({ "api.lever.co": "null" }));
    await expect(lever.fetchJobs(config("lever", "sumido"))).resolves.toEqual({
      jobs: [],
      warnings: [],
    });
  });

  it("ashby avisa também quando o envelope vem sem o campo jobs", async () => {
    setHttpPort(fixtureHttp({ "api.ashbyhq.com": {} }));
    const result = await ashby.fetchJobs(config("ashby", "acme"));
    expect(result.jobs).toEqual([]);
    expect(result.warnings.join(" ")).toContain("no listed jobs");
  });
});
