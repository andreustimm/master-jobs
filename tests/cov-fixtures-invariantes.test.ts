/**
 * Cada regra de `validateFixtures`, provada contra um fixture que a viola.
 *
 * `tests/fixture-seed.test.ts` chama a função com o conjunto REAL, que é válido —
 * e por isso só exercita o desfecho `ok: true`. Todas as onze regras de dentro
 * ficaram sem caso: elas existem, retornam a mensagem certa, e nada verifica
 * qual mensagem sai para qual violação.
 *
 * O risco é específico. Este validador é a única coisa entre um fixture errado e
 * um ambiente de demonstração que ninguém confere à mão. Duas das regras não são
 * sobre volume:
 *
 * - **URL fora de `example.test`.** `example.test` é host reservado pela RFC 6761
 *   e não resolve. Um fixture com URL real transforma o primeiro clique distraído
 *   numa requisição para um terceiro, a partir de uma tela de demonstração.
 * - **E-mail fora de `fixture.test`.** Mesma razão, com o agravante de que um
 *   e-mail plausível num fixture pode receber mensagem de verdade.
 *
 * As outras garantem que a interface tenha um caso de cada ramo que ela desenha —
 * remoto, presencial, modalidade não declarada, aberta e fechada. Sem elas, uma
 * tela fica sem exemplo e ninguém descobre até alguém abri-la.
 */
import { describe, expect, it } from "vitest";
import {
  FIXTURE_BOUNDS,
  validateFixtures,
  type CandidateFixture,
  type JobFixture,
} from "../src/core/db/fixtures.ts";

/** Uma vaga válida, para variar UM campo por caso. */
function vaga(overrides: Partial<JobFixture> = {}): JobFixture {
  return {
    externalId: "fixture-base",
    companyName: "Aurora Sistemas",
    title: "Senior Software Architect",
    locationRaw: "Remoto — Brasil",
    remote: true,
    descriptionText: "Plataforma em TypeScript e PostgreSQL.",
    url: "https://example.test/vaga/base",
    closedAt: null,
    ...overrides,
  };
}

function pessoa(overrides: Partial<CandidateFixture> = {}): CandidateFixture {
  return {
    slug: "fixture-dono",
    name: "Dono da Conta",
    email: "dono@fixture.test",
    roles: ["candidate"],
    cv: null,
    ...overrides,
  };
}

/** O conjunto mínimo que satisfaz TODAS as regras de ramificação. */
function conjuntoValido(): { jobs: JobFixture[]; candidates: CandidateFixture[] } {
  return {
    jobs: [
      vaga({ externalId: "a", remote: true, closedAt: null }),
      vaga({ externalId: "b", remote: false, closedAt: null }),
      vaga({ externalId: "c", remote: null, closedAt: "2026-09-01T00:00:00.000Z" }),
    ],
    candidates: [pessoa()],
  };
}

/** Os problemas que o validador aponta para este conjunto. */
function problemas(
  jobs: readonly JobFixture[],
  candidates: readonly CandidateFixture[],
): string[] {
  const resultado = validateFixtures(jobs, candidates);
  return resultado.ok ? [] : resultado.problems;
}

describe("o conjunto mínimo válido", () => {
  it("UT-360 passa, e é o que torna os casos seguintes conclusivos", () => {
    const { jobs, candidates } = conjuntoValido();

    expect(validateFixtures(jobs, candidates)).toEqual({ ok: true });
  });

  it("UT-361 o conjunto REAL do repositório também passa", () => {
    // Sem argumento, a função valida `JOB_FIXTURES` e `CANDIDATE_FIXTURES`. É a
    // única asserção aqui que protege os dados de verdade.
    expect(validateFixtures()).toEqual({ ok: true });
  });
});

describe("os hosts reservados, que são a regra de segurança do arquivo", () => {
  it("UT-362 URL fora de `example.test` é recusada nomeando a vaga", () => {
    const { jobs, candidates } = conjuntoValido();
    jobs[0] = vaga({
      externalId: "vazando",
      url: "https://boards.greenhouse.io/empresa/jobs/123",
      remote: true,
    });

    const lista = problemas(jobs, candidates);

    expect(lista).toContain("fixture url must stay on example.test: vazando");
  });

  it("UT-363 `http://example.test` e subdomínio não passam: o prefixo é exato", () => {
    // `startsWith("https://example.test/")` é deliberadamente literal. Um
    // `example.test.attacker.com` começa com o nome e não é o host.
    const { candidates } = conjuntoValido();
    for (const url of [
      "http://example.test/vaga/1",
      "https://example.test.attacker.com/vaga/1",
      "https://www.example.test/vaga/1",
      "https://example.test",
    ]) {
      const jobs = [
        vaga({ externalId: "x", url, remote: true }),
        vaga({ externalId: "y", remote: false }),
        vaga({ externalId: "z", remote: null, closedAt: "2026-09-01T00:00:00.000Z" }),
      ];
      expect(problemas(jobs, candidates), url).toContain(
        "fixture url must stay on example.test: x",
      );
    }
  });

  it("UT-364 e-mail fora de `fixture.test` é recusado nomeando o slug", () => {
    const { jobs } = conjuntoValido();

    const lista = problemas(jobs, [pessoa({ slug: "vazando", email: "andreus@gmail.com" })]);

    expect(lista).toContain("fixture email must stay on fixture.test: vazando");
  });
});

describe("os limites de volume", () => {
  it("UT-365 mais vagas que o teto é apontado, e exatamente o teto passa", () => {
    const { candidates } = conjuntoValido();
    const muitas = Array.from({ length: FIXTURE_BOUNDS.maxJobs + 1 }, (_, n) =>
      vaga({
        externalId: `j${n}`,
        remote: n === 0 ? true : n === 1 ? false : null,
        closedAt: n === 2 ? "2026-09-01T00:00:00.000Z" : null,
      }),
    );

    expect(problemas(muitas, candidates)).toContain("too many job fixtures");
    // O limite é inclusivo: é o que distingue `>` de `>=`.
    expect(problemas(muitas.slice(0, FIXTURE_BOUNDS.maxJobs), candidates)).toEqual([]);
  });

  it("UT-366 mais candidatos que o teto é apontado", () => {
    const { jobs } = conjuntoValido();
    const muitos = Array.from({ length: FIXTURE_BOUNDS.maxCandidates + 1 }, (_, n) =>
      pessoa({ slug: `p${n}`, email: `p${n}@fixture.test` }),
    );

    expect(problemas(jobs, muitos)).toContain("too many candidate fixtures");
    expect(problemas(jobs, muitos.slice(0, FIXTURE_BOUNDS.maxCandidates))).toEqual([]);
  });

  it("UT-367 descrição acima do limite é apontada nomeando a vaga", () => {
    const { jobs, candidates } = conjuntoValido();
    jobs[0] = vaga({
      externalId: "longa",
      remote: true,
      descriptionText: "x".repeat(FIXTURE_BOUNDS.maxDescriptionChars + 1),
    });

    expect(problemas(jobs, candidates)).toContain("description too long: longa");

    // No limite exato, passa.
    jobs[0] = vaga({
      externalId: "longa",
      remote: true,
      descriptionText: "x".repeat(FIXTURE_BOUNDS.maxDescriptionChars),
    });
    expect(problemas(jobs, candidates)).toEqual([]);
  });
});

describe("as chaves duplicadas", () => {
  it("UT-368 `externalId` repetido é apontado; o seed faria upsert em cima de si", () => {
    const { candidates } = conjuntoValido();
    const jobs = [
      vaga({ externalId: "igual", remote: true }),
      vaga({ externalId: "igual", remote: false }),
      vaga({ externalId: "c", remote: null, closedAt: "2026-09-01T00:00:00.000Z" }),
    ];

    expect(problemas(jobs, candidates)).toContain("duplicate job externalId");
  });

  it("UT-369 slug de candidato repetido é apontado", () => {
    const { jobs } = conjuntoValido();

    const lista = problemas(jobs, [
      pessoa({ slug: "igual", email: "a@fixture.test" }),
      pessoa({ slug: "igual", email: "b@fixture.test" }),
    ]);

    expect(lista).toContain("duplicate candidate slug");
  });
});

describe("os ramos que a interface precisa ter exemplo", () => {
  const RAMOS: Array<{ falta: string; jobs: JobFixture[] }> = [
    {
      falta: "missing remote fixture",
      jobs: [
        vaga({ externalId: "a", remote: false }),
        vaga({ externalId: "b", remote: null, closedAt: "2026-09-01T00:00:00.000Z" }),
      ],
    },
    {
      falta: "missing on-site/hybrid fixture",
      jobs: [
        vaga({ externalId: "a", remote: true }),
        vaga({ externalId: "b", remote: null, closedAt: "2026-09-01T00:00:00.000Z" }),
      ],
    },
    {
      falta: "missing undeclared-mode fixture",
      jobs: [
        vaga({ externalId: "a", remote: true }),
        vaga({ externalId: "b", remote: false, closedAt: "2026-09-01T00:00:00.000Z" }),
      ],
    },
    {
      falta: "missing closed fixture",
      jobs: [
        vaga({ externalId: "a", remote: true }),
        vaga({ externalId: "b", remote: false }),
        vaga({ externalId: "c", remote: null }),
      ],
    },
    {
      falta: "missing open fixture",
      jobs: [
        vaga({ externalId: "a", remote: true, closedAt: "2026-09-01T00:00:00.000Z" }),
        vaga({ externalId: "b", remote: false, closedAt: "2026-09-02T00:00:00.000Z" }),
        vaga({ externalId: "c", remote: null, closedAt: "2026-09-03T00:00:00.000Z" }),
      ],
    },
  ];

  for (const { falta, jobs } of RAMOS) {
    it(`UT-370 sem exemplo do ramo, o validador aponta «${falta}»`, () => {
      const { candidates } = conjuntoValido();

      expect(problemas(jobs, candidates)).toContain(falta);
    });
  }

  it("UT-371 modalidade não declarada é `null`, e `undefined` não serve", () => {
    // `remote === null` é a asserção literal do validador. Um fixture que omita o
    // campo passaria a ter `undefined`, que não casa — e a tela ficaria sem o
    // exemplo de "o anúncio não diz", que é o caso mais comum do acervo real.
    const { candidates } = conjuntoValido();
    const semCampo = [
      vaga({ externalId: "a", remote: true }),
      vaga({ externalId: "b", remote: false }),
      { ...vaga({ externalId: "c", closedAt: "2026-09-01T00:00:00.000Z" }), remote: undefined },
    ] as unknown as JobFixture[];

    expect(problemas(semCampo, candidates)).toContain("missing undeclared-mode fixture");
  });
});
