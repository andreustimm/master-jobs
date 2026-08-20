// Suite: adaptadores de agregadores (Himalayas, Remotive, Arbeitnow, RemoteOK, Adzuna)
// Invariante: agregador é burro — busca, mapeia, devolve — mas a normalização que
// ele faz no caminho decide o que o scorer consegue ler. Campo perdido aqui vira
// score neutro lá, sem nenhum sinal de que houve perda.
// Fronteira DENTRO: mapeamento RawJob, paginação, avisos, leitura de env.
// Fronteira FORA: rede (substituída pela porta HTTP) e o scorer.
import { afterEach, describe, expect, it } from "vitest";
import {
  adzuna,
  arbeitnow,
  himalayas,
  remoteok,
  remotive,
} from "../src/core/sources/aggregators.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import type { SourceConfig } from "../src/core/sources/types.ts";

function config(kind: SourceConfig["kind"], handle = "", label = "Agregador"): SourceConfig {
  return { kind, handle, label };
}

afterEach(() => {
  resetHttpPort();
  delete process.env.ADZUNA_APP_ID;
  delete process.env.ADZUNA_APP_KEY;
});

describe("himalayas", () => {
  it("lê pubDate em segundos, que é a unidade que a API devolve", async () => {
    // Tratar segundos como milissegundos joga toda a base para 1970 e o
    // componente de frescor — o mais forte do scorer — passa a punir a fonte
    // inteira por um erro de unidade.
    setHttpPort(
      fixtureHttp({
        "offset=0": {
          totalCount: 1,
          jobs: [
            {
              guid: "him-1",
              title: "  Staff AI Engineer  ",
              companyName: "Acme",
              pubDate: 1_755_000_000,
              applicationLink: "https://acme.test/jobs/1",
            },
          ],
        },
      }),
    );

    const { jobs } = await himalayas.fetchJobs(config("himalayas", "1"));
    expect(jobs[0]!.postedAt).toBe(new Date(1_755_000_000_000).toISOString());
    // O trim do título não é cosmético: espaço à frente quebra o casamento por
    // borda de palavra do componente de título.
    expect(jobs[0]!.title).toBe("Staff AI Engineer");
  });

  it("aceita data em texto e devolve null quando o texto não é data", async () => {
    // Regra 8: dado ausente pontua neutro. Uma data ilegível precisa virar
    // ausência declarada, nunca uma data inventada.
    setHttpPort(
      fixtureHttp({
        "offset=0": {
          jobs: [
            { guid: "a", title: "A", companyName: "X", pubDate: "2026-08-01T00:00:00Z" },
            { guid: "b", title: "B", companyName: "X", pubDate: "quarta-feira" },
            { guid: "c", title: "C", companyName: "X" },
          ],
        },
      }),
    );

    const { jobs } = await himalayas.fetchJobs(config("himalayas", "1"));
    expect(jobs[0]!.postedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(jobs[1]!.postedAt).toBeNull();
    expect(jobs[2]!.postedAt).toBeNull();
  });

  it("aceita seniority e locationRestrictions como texto ou como lista", async () => {
    // O agregador alterna entre as duas formas para o mesmo campo. Assumir uma
    // só faz metade das vagas perder a informação silenciosamente.
    setHttpPort(
      fixtureHttp({
        "offset=0": {
          jobs: [
            {
              guid: "lista",
              title: "A",
              companyName: "X",
              seniority: ["Senior", "Staff"],
              locationRestrictions: ["Brazil", 42, "LATAM"],
            },
            {
              guid: "texto",
              title: "B",
              companyName: "X",
              seniority: "Principal",
              locationRestrictions: "Worldwide",
            },
            { guid: "vazio", title: "C", companyName: "X", locationRestrictions: [] },
          ],
        },
      }),
    );

    const { jobs } = await himalayas.fetchJobs(config("himalayas", "1"));
    expect(jobs[0]!.seniorityRaw).toBe("Senior, Staff");
    // O 42 não é string e não pode virar "42" na lista de restrições.
    expect(jobs[0]!.locationRaw).toBe("Brazil, LATAM");
    expect(jobs[1]!.seniorityRaw).toBe("Principal");
    expect(jobs[1]!.locationRaw).toBe("Worldwide");
    // Sem restrição declarada a vaga é remota irrestrita, não uma vaga sem lugar.
    expect(jobs[2]!.locationRaw).toBe("Remote");
  });

  it("prefere a descrição em HTML e cai para o excerpt quando ela vem vazia", async () => {
    // Mesmo formato do bug histórico do Lever: string vazia não pode ganhar de
    // conteúdo real, porque `??` não cai em "".
    setHttpPort(
      fixtureHttp({
        "offset=0": {
          jobs: [
            {
              guid: "html",
              title: "A",
              companyName: "X",
              description: "<p>Construímos infraestrutura de agentes.</p>",
              excerpt: "resumo curto",
            },
            { guid: "excerpt", title: "B", companyName: "X", description: "", excerpt: "só o resumo" },
          ],
        },
      }),
    );

    const { jobs } = await himalayas.fetchJobs(config("himalayas", "1"));
    expect(jobs[0]!.descriptionText).toContain("infraestrutura de agentes");
    expect(jobs[1]!.descriptionText).toBe("só o resumo");
  });

  it("monta a URL da empresa quando não há link de candidatura", async () => {
    setHttpPort(
      fixtureHttp({
        "offset=0": { jobs: [{ guid: "g", title: "A", companyName: "X", companySlug: "acme" }] },
      }),
    );

    const { jobs } = await himalayas.fetchJobs(config("himalayas", "1"));
    expect(jobs[0]!.url).toBe("https://himalayas.app/companies/acme");
    expect(jobs[0]!.applyUrl).toBeNull();
  });

  it("pagina até a página incompleta e avisa quanto do acervo ficou de fora", async () => {
    // A API serve 20 por chamada e ignora `limit` maior. Sem o aviso, uma fatia
    // de 23 de 101.018 vagas parece a base inteira e o funil parece seco.
    const page = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        guid: `${prefix}-${i}`,
        title: `Vaga ${i}`,
        companyName: "X",
      }));

    setHttpPort(
      fixtureHttp({
        "offset=0": { totalCount: 101_018, jobs: page("p0", 20) },
        "offset=20": { totalCount: 101_018, jobs: page("p1", 3) },
      }),
    );

    const { jobs, warnings } = await himalayas.fetchJobs(config("himalayas", "5"));
    // Parou na página incompleta em vez de gastar as cinco chamadas pedidas.
    expect(jobs).toHaveLength(23);
    // O separador de milhar sai do locale do processo, então a asserção olha o
    // que importa: o aviso confronta o que veio com o tamanho real do acervo.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("23 de ");
    expect(warnings[0]).toMatch(/101[.,]018/);
  });

  it("usa a paginação padrão quando o handle não é um número de páginas", async () => {
    // `handle` aqui é contagem de páginas, não termo de busca — a API aceita `q`
    // e o ignora. Um handle textual não pode virar zero páginas.
    setHttpPort(fixtureHttp({ "offset=0": { jobs: [{ guid: "g", title: "A", companyName: "X" }] } }));

    const { jobs } = await himalayas.fetchJobs(config("himalayas", "ai architect"));
    expect(jobs).toHaveLength(1);
  });

  it("devolve lista vazia quando a resposta não traz o campo jobs", async () => {
    setHttpPort(fixtureHttp({ "offset=0": {} }));
    await expect(himalayas.fetchJobs(config("himalayas", "1"))).resolves.toEqual({
      jobs: [],
      warnings: [],
    });
  });
});

describe("remotive", () => {
  it("passa o handle como termo de busca da própria API", async () => {
    // Aqui, ao contrário do Himalayas, a busca server-side funciona — e é o que
    // impede baixar o board inteiro para achar meia dúzia de vagas.
    const port = fixtureHttp({
      "remotive.com/api/remote-jobs": {
        jobs: [
          {
            id: 991,
            url: "https://remotive.com/jobs/991",
            title: " Principal Engineer ",
            company_name: "Remotive Co",
            job_type: "full_time",
            publication_date: "2026-08-10T09:00:00",
            candidate_required_location: "LATAM",
            description: "<p>Escala de plataforma.</p>",
          },
        ],
      },
    });
    setHttpPort(port);

    const { jobs } = await remotive.fetchJobs(config("remotive", "ai architect"));
    expect(port.calls[0]).toContain("search=ai+architect");
    expect(jobs[0]!.externalId).toBe("991");
    expect(jobs[0]!.title).toBe("Principal Engineer");
    expect(jobs[0]!.descriptionText).toBe("Escala de plataforma.");
    expect(jobs[0]!.locationRaw).toBe("LATAM");
    expect(jobs[0]!.remote).toBe(true);
  });

  it("omite o parâmetro de busca com handle vazio e assume remoto sem localização", async () => {
    const port = fixtureHttp({
      "remotive.com/api/remote-jobs": {
        jobs: [{ id: 1, url: "u", title: "A", company_name: "C" }],
      },
    });
    setHttpPort(port);

    const { jobs } = await remotive.fetchJobs(config("remotive"));
    expect(port.calls[0]).not.toContain("search=");
    // O board é inteiramente remoto; ausência de país é irrestrição, não lacuna.
    expect(jobs[0]!.locationRaw).toBe("Remote");
    expect(jobs[0]!.employmentType).toBeNull();
  });
});

describe("arbeitnow", () => {
  it("lê created_at em segundos e normaliza job_types em qualquer forma", async () => {
    setHttpPort(
      fixtureHttp({
        "arbeitnow.com/api/job-board-api": {
          data: [
            {
              slug: "acme-staff-engineer",
              company_name: "Acme",
              title: " Staff Engineer ",
              url: "https://arbeitnow.com/view/acme-staff-engineer",
              job_types: ["Full Time", "Contract"],
              remote: true,
              location: "Berlin",
              created_at: 1_755_000_000,
              description: "<p>Backend distribuído.</p>",
            },
            { slug: "sem-tipo", company_name: "B", title: "B", url: "u" },
          ],
        },
      }),
    );

    const { jobs } = await arbeitnow.fetchJobs(config("arbeitnow"));
    expect(jobs[0]!.externalId).toBe("acme-staff-engineer");
    expect(jobs[0]!.employmentType).toBe("Full Time, Contract");
    expect(jobs[0]!.postedAt).toBe(new Date(1_755_000_000_000).toISOString());
    // Regra 8: campo ausente é null (neutro), nunca string vazia nem false.
    expect(jobs[1]!.employmentType).toBeNull();
    expect(jobs[1]!.remote).toBeNull();
    expect(jobs[1]!.locationRaw).toBeNull();
    expect(jobs[1]!.postedAt).toBeNull();
  });

  it("devolve lista vazia quando a resposta não traz o campo data", async () => {
    setHttpPort(fixtureHttp({ "arbeitnow.com/api/job-board-api": {} }));
    await expect(arbeitnow.fetchJobs(config("arbeitnow"))).resolves.toEqual({
      jobs: [],
      warnings: [],
    });
  });
});

describe("remoteok", () => {
  it("descarta o aviso legal que a API entrega como primeiro elemento", async () => {
    // O primeiro item do array não é uma vaga. Ingerido, vira uma "vaga" sem
    // empresa nem título que polui o funil todo dia.
    setHttpPort(
      fixtureHttp({
        "remoteok.com/api": [
          { legal: "See https://remoteok.com/terms" },
          { id: "1", position: "Staff Engineer", company: "Acme", slug: "acme-staff" },
          // Sem `position` não há o que pontuar; sem `id` não há como deduplicar.
          { id: "2", company: "Sem cargo" },
          { position: "Sem id", company: "X" },
        ],
      }),
    );

    const { jobs } = await remoteok.fetchJobs(config("remoteok"));
    expect(jobs.map((j) => j.externalId)).toEqual(["1"]);
    // Sem `url` explícita, o slug reconstrói o link — id nenhum é perdido.
    expect(jobs[0]!.url).toBe("https://remoteok.com/remote-jobs/acme-staff");
  });

  it("declara USD/ano só quando existe salário, e não inventa moeda", async () => {
    setHttpPort(
      fixtureHttp({
        "remoteok.com/api": [
          {
            id: "10",
            position: "A",
            salary_min: 150_000,
            salary_max: 200_000,
            location: "",
            url: "https://remoteok.com/l/10",
            apply_url: "https://acme.test/apply",
            date: "2026-08-01T00:00:00+00:00",
            description: "<p>texto</p>",
          },
          { id: "11", position: "B", location: "Europe only" },
        ],
      }),
    );

    const { jobs } = await remoteok.fetchJobs(config("remoteok"));
    expect(jobs[0]!.compCurrency).toBe("USD");
    expect(jobs[0]!.compPeriod).toBe("year");
    expect(jobs[0]!.applyUrl).toBe("https://acme.test/apply");
    // Location vazia é irrestrição no board remoto, não ausência de dado.
    expect(jobs[0]!.locationRaw).toBe("Remote");
    // Sem salário, moeda e período ficam nulos — piso salarial inventado seria
    // pior que piso ausente.
    expect(jobs[1]!.compCurrency).toBeNull();
    expect(jobs[1]!.compPeriod).toBeNull();
    expect(jobs[1]!.companyName).toBe("Unknown");
    expect(jobs[1]!.locationRaw).toBe("Europe only");
  });

  it("aceita uma resposta sem corpo sem quebrar a sincronização", async () => {
    setHttpPort(fixtureHttp({ "remoteok.com/api": [] }));
    await expect(remoteok.fetchJobs(config("remoteok"))).resolves.toEqual({
      jobs: [],
      warnings: [],
    });
  });
});

describe("adzuna", () => {
  it("se declara pulado quando falta credencial, em vez de falhar a sync", async () => {
    // Uma fonte sem chave é configuração incompleta, não erro de execução:
    // derrubar a run inteira por isso custaria todas as outras fontes.
    const result = await adzuna.fetchJobs(config("adzuna", "us:ai architect"));
    expect(result.jobs).toEqual([]);
    expect(result.warnings.join(" ")).toContain("ADZUNA_APP_ID");
  });

  it("lê país e consulta do handle e assina a chamada com as credenciais", async () => {
    process.env.ADZUNA_APP_ID = "id-teste";
    process.env.ADZUNA_APP_KEY = "key-teste";
    const port = fixtureHttp({
      "api.adzuna.com": {
        results: [
          {
            id: "77",
            title: " Solutions Architect ",
            redirect_url: "https://adzuna.test/77",
            created: "2026-08-05T00:00:00Z",
            description: "Texto puro, sem HTML.",
            salary_min: 149_999.6,
            salary_max: 200_000.4,
            company: { display_name: "Adzuna Co" },
            location: { display_name: "São Paulo, BR" },
            contract_time: "full_time",
          },
        ],
      },
    });
    setHttpPort(port);

    const { jobs } = await adzuna.fetchJobs(config("adzuna", "br:ai architect"));
    expect(port.calls[0]).toContain("/jobs/br/search/1?");
    expect(port.calls[0]).toContain("app_id=id-teste");
    expect(port.calls[0]).toContain("what=ai+architect");
    // Centavos num salário anual são ruído; o piso é comparado em inteiros.
    expect(jobs[0]!.compMin).toBe(150_000);
    expect(jobs[0]!.compMax).toBe(200_000);
    // A API não diz a moeda, e supor USD para um país arbitrário distorceria o
    // piso salarial. Melhor nulo.
    expect(jobs[0]!.compCurrency).toBeNull();
    expect(jobs[0]!.title).toBe("Solutions Architect");
    expect(jobs[0]!.remote).toBeNull();
  });

  it("usa a consulta padrão quando o handle traz só o país", async () => {
    process.env.ADZUNA_APP_ID = "id";
    process.env.ADZUNA_APP_KEY = "key";
    const port = fixtureHttp({
      "api.adzuna.com": { results: [{ id: "1", title: "A", redirect_url: "u" }] },
    });
    setHttpPort(port);

    const { jobs } = await adzuna.fetchJobs(config("adzuna", "gb"));
    expect(port.calls[0]).toContain("/jobs/gb/search/1?");
    expect(port.calls[0]).toContain("what=software+architect");
    expect(jobs[0]!.companyName).toBe("Unknown");
    expect(jobs[0]!.locationRaw).toBeNull();
    expect(jobs[0]!.compMin).toBeNull();
  });

  it("DEFEITO CONHECIDO: handle vazio produz URL sem país em vez de cair para us", async () => {
    // `const [country = "us"] = "".split(":")` não cai no padrão: split de string
    // vazia devolve [""] e default de destructuring só vale para `undefined`.
    // O resultado é `/v1/api/jobs//search/1`, que a Adzuna recusa — e como
    // `handle` tem `.default("")` no schema de sources.yaml, essa configuração é
    // aceita pela validação. Teste caracteriza o comportamento atual; a correção
    // é trocar o default por `|| "us"` em aggregators.ts.
    process.env.ADZUNA_APP_ID = "id";
    process.env.ADZUNA_APP_KEY = "key";
    const port = fixtureHttp({ "api.adzuna.com": { results: [] } });
    setHttpPort(port);

    await adzuna.fetchJobs(config("adzuna"));
    expect(port.calls[0]).toContain("/v1/api/jobs//search/1?");
  });
});
