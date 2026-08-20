/**
 * Exportação markdown de volta para o vault do Obsidian.
 *
 * O banco é a fonte da verdade, mas o vault é onde o usuário lê e pensa. Estes
 * testes cobrem as duas metades do arquivo que estavam sem rede de proteção: as
 * seções condicionais do quadro (funil vazio, nenhuma vaga nova, bloco "em
 * andamento") e o gerador de dossiês offline, que é quem monta o frontmatter
 * que o Obsidian consulta.
 *
 * Duas regras do projeto aparecem repetidas aqui de propósito, porque são as
 * que quebram em silêncio: `manual://` é identidade de banco e nunca vira link
 * clicável, e o markdown de tabela precisa escapar `|` ou uma empresa com pipe
 * no nome parte a linha ao meio.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { ensureCandidate } from "../src/core/candidate.ts";
import { setApplicationStatus } from "../src/core/db/repo.ts";
import { company, job, jobScore, source } from "../src/core/db/schema.ts";
import {
  buildReport,
  exportDossiers,
  renderBoardMarkdown,
  type ReportRow,
} from "../src/core/report/markdown.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/* ------------------------------------------------------- renderizador puro */

const BASE: ReportRow = {
  fit: 81.4,
  cluster: "strong",
  companyName: "Acme",
  title: "Staff Engineer",
  locationRaw: "Remote",
  blockers: [],
  url: "https://jobs.example.test/staff",
  applyUrl: null,
  status: null,
  appliedAt: null,
};

function row(patch: Partial<ReportRow> = {}): ReportRow {
  return { ...BASE, ...patch };
}

describe("renderBoardMarkdown", () => {
  it("diz que o funil está vazio em vez de deixar uma tabela sem linha", () => {
    // Tabela de markdown sem nenhuma linha de corpo some na renderização: o
    // usuário veria um cabeçalho solto e não saberia se é vazio ou defeito.
    const md = renderBoardMarkdown({ rows: [], counts: {}, today: "2026-08-20", minFit: 45 });

    expect(md).toContain("| _(nenhuma candidatura registrada)_ | 0 |");
  });

  it("ordena o funil pelo volume, não pela ordem de chegada do objeto", () => {
    const md = renderBoardMarkdown({
      rows: [],
      counts: { applied: 3, screening: 9, offer: 1 },
      today: "2026-08-20",
      minFit: 45,
    });
    const funnel = md.slice(md.indexOf("## Funil"), md.indexOf("## Novas"));

    expect(funnel.indexOf("| screening | 9 |")).toBeLessThan(funnel.indexOf("| applied | 3 |"));
    expect(funnel.indexOf("| applied | 3 |")).toBeLessThan(funnel.indexOf("| offer | 1 |"));
  });

  it("declara explicitamente quando nada novo passou do corte", () => {
    // Sem essa linha, um corte alto demais parece um relatório quebrado.
    const md = renderBoardMarkdown({
      rows: [row({ status: "applied", appliedAt: "2026-08-01T10:00:00.000Z" })],
      counts: { applied: 1 },
      today: "2026-08-20",
      minFit: 90,
    });

    expect(md).toContain("_nenhuma vaga nova acima do corte_");
  });

  it("trata backlog como vaga nova, e qualquer outro status como acompanhada", () => {
    // `backlog` é onde a vaga cai antes de o usuário decidir: ainda é uma
    // oportunidade nova, não um processo em andamento.
    const md = renderBoardMarkdown({
      rows: [
        row({ status: "backlog", title: "Ainda Nova" }),
        row({ status: "screening", title: "Em Processo", appliedAt: "2026-07-30T08:00:00.000Z" }),
      ],
      counts: {},
      today: "2026-08-20",
      minFit: 45,
    });

    const novas = md.slice(md.indexOf("## Novas"), md.indexOf("## Em andamento"));
    expect(novas).toContain("Ainda Nova");
    expect(novas).not.toContain("Em Processo");
    expect(md).toContain("## Em andamento");
  });

  it("corta a data de candidatura no dia — hora não ajuda a decidir nada", () => {
    const md = renderBoardMarkdown({
      rows: [row({ status: "applied", appliedAt: "2026-07-30T08:15:42.123Z" })],
      counts: {},
      today: "2026-08-20",
      minFit: 45,
    });

    expect(md).toContain("| 2026-07-30 |");
    expect(md).not.toContain("08:15:42");
  });

  it("omite a seção 'Em andamento' quando não há nada em andamento", () => {
    const md = renderBoardMarkdown({ rows: [row()], counts: {}, today: "2026-08-20", minFit: 45 });

    expect(md).not.toContain("## Em andamento");
  });

  it("não transforma URL sintética em link clicável", () => {
    // Regra do `job-url`: `manual://` é identidade de banco, não destino de
    // navegação. Um link desses no vault leva o usuário a lugar nenhum.
    const md = renderBoardMarkdown({
      rows: [
        row({ url: "manual://local/42", applyUrl: null }),
        row({
          url: "manual://local/43",
          applyUrl: null,
          status: "applied",
          appliedAt: "2026-08-01T00:00:00.000Z",
        }),
      ],
      counts: {},
      today: "2026-08-20",
      minFit: 45,
    });

    expect(md).not.toContain("manual://");
    expect(md).not.toContain("[aplicar]");
    expect(md).not.toContain("[vaga]");
  });

  it("prefere o link de candidatura na lista de novas e o da vaga nas acompanhadas", () => {
    // São perguntas diferentes: em uma vaga nova o usuário quer aplicar; numa
    // que já está em processo ele quer reler o anúncio.
    const md = renderBoardMarkdown({
      rows: [
        row({ applyUrl: "https://apply.example.test/staff" }),
        row({
          applyUrl: "https://apply.example.test/outra",
          url: "https://jobs.example.test/outra",
          status: "screening",
          appliedAt: null,
        }),
      ],
      counts: {},
      today: "2026-08-20",
      minFit: 45,
    });

    expect(md).toContain("[aplicar](https://apply.example.test/staff)");
    expect(md).toContain("[vaga](https://jobs.example.test/outra)");
  });

  it("também usa travessão para fit ausente na tabela de acompanhadas", () => {
    // A vaga pode ter sido movida para o funil antes de qualquer pontuação —
    // candidatura manual, por exemplo. A coluna não pode sair "undefined".
    const md = renderBoardMarkdown({
      rows: [row({ status: "applied", fit: null, appliedAt: null })],
      counts: {},
      today: "2026-08-20",
      minFit: 45,
    });

    expect(md).toContain("| applied | — | Acme | Staff Engineer | — |");
  });

  it("escapa pipe e achata quebra de linha para a tabela não partir", () => {
    const md = renderBoardMarkdown({
      rows: [row({ companyName: "Acme | Labs", locationRaw: "Remote\n\nLATAM" })],
      counts: {},
      today: "2026-08-20",
      minFit: 45,
    });

    expect(md).toContain("Acme \\| Labs");
    expect(md).toContain("Remote LATAM");
  });

  it("mostra travessão para fit, cluster e bloqueios ausentes", () => {
    // Dado faltante pontua neutro (regra 8) e, aqui, aparece como ausência
    // declarada — não como zero, que o olho lê como avaliação ruim.
    //
    // Local é a exceção, e o teste fixa isso como está: `esc(null)` devolve
    // string vazia, então a coluna Local sai em branco em vez do travessão que
    // as outras usam. É inconsistência de apresentação, não perda de dado — se
    // um dia for uniformizado, este é o teste que avisa.
    const md = renderBoardMarkdown({
      rows: [row({ fit: null, cluster: null, locationRaw: null, url: "manual://x" })],
      counts: {},
      today: "2026-08-20",
      minFit: 45,
    });

    expect(md).toContain("| — | — | Acme | Staff Engineer |  | — | — |");
  });

  it("arredonda o fit e renderiza os bloqueios legados como texto", () => {
    const md = renderBoardMarkdown({
      rows: [row({ blockers: ["Exige autorização | EUA", "Presencial"] })],
      counts: {},
      today: "2026-08-20",
      minFit: 45,
    });

    expect(md).toContain("| 81 |");
    expect(md).toContain("Exige autorização \\| EUA; Presencial");
  });

  it("é determinístico: mesma entrada, mesmo byte", () => {
    // O arquivo é reescrito no vault a cada execução. Saída instável encheria
    // o histórico do usuário de diffs falsos.
    const input = {
      rows: [row(), row({ status: "applied", appliedAt: "2026-08-01T00:00:00.000Z" })],
      counts: { applied: 1 },
      today: "2026-08-20",
      minFit: 45,
    };

    expect(renderBoardMarkdown(input)).toBe(renderBoardMarkdown(input));
  });
});

/* --------------------------------------------------------- com banco real- */

let db: DB;
let candidateId: number;

beforeEach(async () => {
  db = await useTestDb();
  candidateId = await ensureCandidate({ name: "Dono do Relatório" });
  await db.insert(source).values({
    id: "ashby:acme",
    kind: "ashby",
    handle: "acme",
    label: "Acme via Ashby",
  });
});

afterEach(() => {
  releaseTestDb();
});

type SeedJob = {
  title: string;
  companyName: string;
  url?: string;
  applyUrl?: string | null;
  locationRaw?: string | null;
  descriptionText?: string | null;
  postedAt?: string | null;
  fit?: number | null;
  cluster?: string;
  blockers?: unknown;
  reasons?: unknown;
  matchedKeywords?: unknown;
};

async function seedJob(input: SeedJob): Promise<number> {
  const slug = input.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await db.insert(company).values({ slug, name: input.companyName }).onConflictDoNothing();
  const [inserted] = await db
    .insert(job)
    .values({
      sourceId: "ashby:acme",
      companyName: input.companyName,
      externalId: `${slug}-${input.title}`,
      title: input.title,
      url: input.url ?? `https://jobs.example.test/${slug}`,
      applyUrl: input.applyUrl === undefined ? null : input.applyUrl,
      locationRaw: input.locationRaw === undefined ? "Remote · LATAM" : input.locationRaw,
      descriptionText: input.descriptionText ?? null,
      postedAt: input.postedAt ?? null,
      fingerprint: `fp-${slug}-${input.title}`,
      contentHash: `hash-${slug}-${input.title}`,
      raw: "{}",
    })
    .returning({ id: job.id });

  if (input.fit != null) {
    await db.insert(jobScore).values({
      candidateId,
      jobId: inserted!.id,
      fit: input.fit,
      titleScore: 1,
      keywordScore: 1,
      seniorityScore: 1,
      geoScore: 1,
      compScore: 1,
      cluster: input.cluster ?? "architect",
      matchedKeywords: input.matchedKeywords ?? [],
      missingKeywords: [],
      reasons: input.reasons ?? [],
      blockers: input.blockers ?? [],
      scorerVersion: "test",
    });
  }
  return inserted!.id;
}

describe("buildReport", () => {
  it("monta o quadro a partir do banco, com o corte e o funil reais", async () => {
    const jobId = await seedJob({ title: "Principal Architect", companyName: "Acme", fit: 88 });
    await seedJob({ title: "Junior Dev", companyName: "Acme", fit: 12 });
    await setApplicationStatus(candidateId, jobId, "applied");

    const { markdown } = await buildReport(candidateId, { minFit: 45 });

    expect(markdown).toContain("Corte de fit: 45");
    expect(markdown).toContain("Principal Architect");
    // Abaixo do corte não entra: o relatório existe para reduzir, não listar.
    expect(markdown).not.toContain("Junior Dev");
    expect(markdown).toContain("| applied | 1 |");
  });

  it("usa o corte padrão de 45 e a data de hoje quando nada é pedido", async () => {
    await seedJob({ title: "Staff Engineer", companyName: "Acme", fit: 50 });

    const { markdown } = await buildReport(candidateId);

    expect(markdown).toContain("Corte de fit: 45");
    expect(markdown).toContain(`(${new Date().toISOString().slice(0, 10)})`);
    expect(markdown).toContain("Vagas listadas: 1");
  });
});

describe("exportDossiers", () => {
  it("gera um arquivo por vaga, com frontmatter consultável pelo Obsidian", async () => {
    const jobId = await seedJob({
      title: 'O "melhor" cargo',
      companyName: "Acme Labs",
      locationRaw: "Remote · LATAM",
      postedAt: "2026-08-01T12:00:00.000Z",
      descriptionText: "Descrição completa da vaga.",
      fit: 82.5,
      cluster: "architect",
      matchedKeywords: ["typescript", "llm"],
      reasons: ["Título casa com o cluster architect"],
      blockers: ["Exige autorização nos EUA"],
    });
    await setApplicationStatus(candidateId, jobId, "applied");

    const { documents } = await exportDossiers(candidateId);

    expect(documents).toHaveLength(1);
    const doc = documents[0]!;
    // O nome carrega o id porque duas vagas da mesma empresa colidiriam.
    expect(doc.name).toBe(`acme-${jobId}.md`);
    // Aspas dentro do valor YAML quebrariam o frontmatter inteiro; viram
    // apóstrofo em vez de escapar, que é mais fácil de ler no vault.
    expect(doc.markdown).toContain(`titulo: "O 'melhor' cargo"`);
    expect(doc.markdown).toContain('empresa: "Acme Labs"');
    expect(doc.markdown).toContain("fit: 82.5");
    expect(doc.markdown).toContain("cluster: architect");
    expect(doc.markdown).toContain("status: applied");
    expect(doc.markdown).toContain("fonte: ashby:acme");
    expect(doc.markdown).toContain("publicada: 2026-08-01");
    expect(doc.markdown).toContain('bloqueios: ["Exige autorização nos EUA"]');
    expect(doc.markdown).toContain("tags: [vaga]");
    // O corpo repete o que importa em prosa, porque frontmatter não se lê.
    expect(doc.markdown).toContain("Fit **82.5** · cluster `architect`");
    expect(doc.markdown).toContain("## Por que pontuou assim");
    expect(doc.markdown).toContain("> ⚠ **Bloqueios:** Exige autorização nos EUA");
    expect(doc.markdown).toContain("**Keywords casadas:** typescript, llm");
    expect(doc.markdown).toContain("Descrição completa da vaga.");
  });

  it("omite as seções que não têm conteúdo, em vez de deixar cabeçalho vazio", async () => {
    await seedJob({
      title: "Sem Nada",
      companyName: "Acme",
      locationRaw: null,
      fit: 70,
      matchedKeywords: [],
      reasons: [],
      blockers: [],
    });

    const [doc] = (await exportDossiers(candidateId)).documents;

    expect(doc?.markdown).toContain("bloqueios: []");
    expect(doc?.markdown).not.toContain("## Por que pontuou assim");
    expect(doc?.markdown).not.toContain("Bloqueios:");
    expect(doc?.markdown).not.toContain("Keywords casadas");
    // Sem local, o nome da empresa não pode ficar com um separador solto.
    expect(doc?.markdown).toContain("**Acme**\n");
  });

  it("explica a ausência de descrição em vez de entregar dossiê em branco", async () => {
    // Vaga vinda de job alert é ponteiro: o e-mail traz só o título. Dizer isso
    // no arquivo evita o usuário achar que o scraper falhou.
    await seedJob({ title: "Vinda de Alerta", companyName: "Acme", fit: 65 });

    const [doc] = (await exportDossiers(candidateId)).documents;

    expect(doc?.markdown).toContain("_Sem descrição — esta vaga entrou por um ponteiro");
  });

  it("aceita vaga sem score, marcando fit vazio e status não triada", async () => {
    // `minFit: 0` é o modo "me mostra tudo". O dossiê continua tendo de sair
    // legível mesmo sem nenhuma nota calculada.
    await seedJob({ title: "Nunca Pontuada", companyName: "Acme", fit: null });

    const [doc] = (await exportDossiers(candidateId, { minFit: 0 })).documents;

    expect(doc?.markdown).toContain("fit: \n");
    expect(doc?.markdown).toContain("cluster: \n");
    expect(doc?.markdown).toContain("status: não triada");
    expect(doc?.markdown).not.toContain("Fit **");
  });

  it("filtra para o funil quando onlyTracked é pedido", async () => {
    const acompanhada = await seedJob({ title: "Acompanhada", companyName: "Acme", fit: 90 });
    await seedJob({ title: "Solta", companyName: "Acme", fit: 91 });
    await setApplicationStatus(candidateId, acompanhada, "screening");

    const { documents } = await exportDossiers(candidateId, { onlyTracked: true });

    expect(documents).toHaveLength(1);
    expect(documents[0]?.markdown).toContain("Acompanhada");
    expect(documents[0]?.markdown).toContain("status: screening");
  });

  it("respeita minFit e limit", async () => {
    await seedJob({ title: "Alta", companyName: "Acme", fit: 95 });
    await seedJob({ title: "Média", companyName: "Acme", fit: 75 });
    await seedJob({ title: "Baixa", companyName: "Acme", fit: 30 });

    await expect(exportDossiers(candidateId)).resolves.toMatchObject({
      documents: [expect.anything(), expect.anything()],
    });
    const limitada = await exportDossiers(candidateId, { limit: 1 });
    expect(limitada.documents).toHaveLength(1);
    // Ordenado por fit: o corte de 1 tem de trazer a melhor, não a primeira.
    expect(limitada.documents[0]?.markdown).toContain("Alta");
  });

  it("dá dois links quando a candidatura tem endereço próprio", async () => {
    await seedJob({
      title: "Com Apply",
      companyName: "Acme",
      url: "https://jobs.example.test/vaga",
      applyUrl: "https://apply.example.test/vaga",
      fit: 70,
    });

    const [doc] = (await exportDossiers(candidateId)).documents;

    expect(doc?.markdown).toContain("[Ver vaga](https://jobs.example.test/vaga)");
    expect(doc?.markdown).toContain("[Aplicar](https://apply.example.test/vaga)");
    expect(doc?.markdown).toContain("url: https://jobs.example.test/vaga");
  });

  it("não repete o mesmo link duas vezes quando apply e vaga coincidem", async () => {
    await seedJob({
      title: "Mesmo Link",
      companyName: "Acme",
      url: "https://jobs.example.test/vaga",
      applyUrl: "https://jobs.example.test/vaga",
      fit: 70,
    });

    const [doc] = (await exportDossiers(candidateId)).documents;

    expect(doc?.markdown).toContain("[Ver vaga]");
    expect(doc?.markdown).not.toContain("[Aplicar]");
  });

  it("cai para o link de candidatura quando a vaga só tem URL sintética", async () => {
    // Comparação manual entra com `manual://`; o único endereço navegável pode
    // ser o de candidatura, e perdê-lo deixaria o dossiê sem saída.
    await seedJob({
      title: "Só Apply",
      companyName: "Acme",
      url: "manual://local/7",
      applyUrl: "https://apply.example.test/local",
      fit: 70,
    });

    const [doc] = (await exportDossiers(candidateId)).documents;

    expect(doc?.markdown).toContain("[Aplicar](https://apply.example.test/local)");
    expect(doc?.markdown).not.toContain("[Ver vaga]");
    expect(doc?.markdown).toContain("url: https://apply.example.test/local");
  });

  it("não escreve link nenhum quando os dois endereços são sintéticos", async () => {
    await seedJob({
      title: "Sem Link",
      companyName: "Acme",
      url: "manual://local/8",
      applyUrl: "manual://local/8",
      fit: 70,
    });

    const [doc] = (await exportDossiers(candidateId)).documents;

    expect(doc?.markdown).not.toContain("manual://");
    expect(doc?.markdown).toContain("url: \n");
  });

  it("devolve lista vazia quando nada passa do corte", async () => {
    await seedJob({ title: "Baixa", companyName: "Acme", fit: 10 });

    await expect(exportDossiers(candidateId)).resolves.toEqual({ documents: [] });
  });
});
