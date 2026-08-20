/**
 * Suíte: `src/core/ingest/manual.ts` — vaga adicionada à mão.
 *
 * São três caminhos, em ordem de quanto dá para recuperar sozinho: (1) a URL é
 * de um ATS que sabemos ler, e a vaga entra completa como se um sync a tivesse
 * trazido; (2) a URL é reconhecível mas ilegível (LinkedIn, Workday); (3)
 * qualquer outra coisa. Nos dois últimos o sistema guarda o que a pessoa deu, e
 * **avisa** o que isso custa na pontuação.
 *
 * O invariante que amarra tudo: vaga manual é linha de primeira classe. Mesma
 * tabela, mesmo fingerprint, mesmo scorer — porque ela precisa deduplicar contra
 * o mesmo anúncio chegando depois por um sync.
 *
 * Fronteira DENTRO: detecção de URL, resolução via adapter, persistência.
 * Fronteira FORA: rede — a porta HTTP é dublê e nenhum caso abre socket.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { authUser, job, source } from "../src/core/db/schema.ts";
import { addJob, addManualDescriptionJob, upsertRawJob } from "../src/core/ingest/manual.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;

beforeEach(async () => {
  db = await useTestDb();
});

afterEach(() => {
  resetHttpPort();
  releaseTestDb();
});

const URL_GREENHOUSE = "https://boards.greenhouse.io/textlayer/jobs/4111216009";

/** Resposta do board com a vaga pedida e uma vizinha, como a API devolve. */
function boardComVaga(): void {
  setHttpPort(
    fixtureHttp({
      "boards-api.greenhouse.io": {
        jobs: [
          {
            id: 4_111_216_009,
            title: "Staff AI Engineer",
            absolute_url: URL_GREENHOUSE,
            company_name: "TextLayer",
            first_published: "2026-08-01T00:00:00Z",
            location: { name: "Remote — LATAM" },
            content: "&lt;p&gt;Construir plataformas de RAG em produção.&lt;/p&gt;",
          },
          {
            id: 1,
            title: "Outra vaga",
            absolute_url: "https://boards.greenhouse.io/textlayer/jobs/1",
          },
        ],
      },
    }),
  );
}

describe("addJob pelo caminho do ATS", () => {
  it("resolve a vaga completa pelo board e grava como um sync gravaria", async () => {
    // O ganho inteiro deste caminho: descrição, local e data vêm da API em vez
    // de serem redigitados. Sem descrição o componente de keywords vale 27
    // pontos que a vaga simplesmente não disputa.
    boardComVaga();

    const r = await addJob({ url: URL_GREENHOUSE });

    expect(r).toMatchObject({
      via: "ats",
      kind: "greenhouse",
      created: true,
      outcome: "inserted",
      title: "Staff AI Engineer",
      companyName: "TextLayer",
      warnings: [],
    });
    const [linha] = await db.select().from(job).where(eq(job.id, r.jobId));
    expect(linha!.descriptionText).toContain("RAG");
    expect(linha!.locationRaw).toBe("Remote — LATAM");
    expect(linha!.sourceId).toBe("greenhouse:textlayer");
  });

  it("prefere o rótulo curado da configuração ao derivado da URL", async () => {
    // Derivar do handle transformaria "TextLayer" em "Textlayer" — e o rótulo
    // entra no fingerprint das vagas daquele board. Uma letra diferente
    // duplicaria o acervo inteiro da fonte.
    await db.insert(source).values({
      id: "greenhouse:textlayer",
      kind: "greenhouse",
      handle: "textlayer",
      label: "TextLayer",
    });
    setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": { jobs: [] } }));

    await addJob({
      url: URL_GREENHOUSE,
      title: "Staff AI Engineer",
      companyName: "TextLayer",
    });

    const [linha] = await db
      .select()
      .from(source)
      .where(eq(source.id, "greenhouse:textlayer"));
    expect(linha!.label).toBe("TextLayer");
  });

  it("casa a vaga pela URL quando o link não carrega id de posting", async () => {
    // O formato embutido do Greenhouse não traz id. Sem o casamento por URL a
    // vaga cairia no caminho manual mesmo com o board respondendo.
    boardComVaga();

    const r = await addJob({
      url: "https://boards.greenhouse.io/embed/job_app?for=textlayer&token=1",
      title: "Fallback",
      companyName: "Fallback",
    });

    // Nenhuma vaga do board tem essa URL, então cai para manual — mas o board
    // foi consultado, e é isso que o aviso registra.
    expect(r.via).toBe("manual");
    expect(r.warnings.join(" ")).toContain("não apareceu no board greenhouse:textlayer");
    expect(r.warnings.join(" ")).toContain("2 vagas listadas");
  });

  it("registra manualmente quando a vaga sumiu do board", async () => {
    // Vaga fechada entre a pessoa ver o link e colar aqui é o caso comum. Falhar
    // perderia o registro; gravar sem avisar esconderia que a vaga pode já não
    // existir.
    setHttpPort(fixtureHttp({ "boards-api.greenhouse.io": { jobs: [] } }));

    const r = await addJob({
      url: URL_GREENHOUSE,
      title: "Staff AI Engineer",
      companyName: "TextLayer",
      description: "Descrição colada à mão.",
    });

    expect(r.via).toBe("manual");
    expect(r.kind).toBe("manual");
    expect(r.warnings.join(" ")).toContain("pode ter sido fechada");
    const [linha] = await db.select().from(job).where(eq(job.id, r.jobId));
    expect(linha!.sourceId).toBe("manual:boards.greenhouse.io");
  });

  it("descreve falha que não é Error sem virar '[object Object]'", async () => {
    // Adapter e porta HTTP podem rejeitar com string ou objeto simples. Um aviso
    // ilegível é pior que nenhum: parece diagnóstico e não é.
    setHttpPort({
      async json(): Promise<never> {
        throw "limite de requisições";
      },
      async text() {
        return null;
      },
    });

    const r = await addJob({
      url: URL_GREENHOUSE,
      title: "Staff AI Engineer",
      companyName: "TextLayer",
      description: "Descrição colada à mão.",
    });

    expect(r.warnings.join(" ")).toContain("limite de requisições");
    expect(r.warnings.join(" ")).not.toContain("[object Object]");
  });

  it("não perde a vaga quando o board está fora do ar, e diz o motivo", async () => {
    // Regra de ouro do pipeline: falha de uma fonte nunca derruba a operação.
    // Aqui isso significa que a pessoa não perde o que digitou porque a API
    // escolheu aquele minuto para cair.
    setHttpPort({
      async json() {
        throw new Error("ECONNRESET");
      },
      async text() {
        return null;
      },
    });

    const r = await addJob({
      url: URL_GREENHOUSE,
      title: "Staff AI Engineer",
      companyName: "TextLayer",
      description: "Descrição colada à mão.",
    });

    expect(r.via).toBe("manual");
    expect(r.warnings.join(" ")).toContain("Falha ao consultar greenhouse:textlayer");
    expect(r.warnings.join(" ")).toContain("ECONNRESET");
  });
});

describe("addJob pelo caminho manual", () => {
  it("explica que o host não tem API e o que fazer a respeito", async () => {
    // Mensagem acionável: LinkedIn não é uma falha nossa, é uma propriedade
    // daquele host. Dizer isso junto com "passe --description" é a diferença
    // entre o usuário melhorar a pontuação e achar que o sistema está quebrado.
    const r = await addJob({
      url: "https://www.linkedin.com/jobs/view/4111216009",
      title: "Staff AI Engineer",
      companyName: "TextLayer",
      description: "Descrição colada do anúncio.",
    });

    expect(r.unfetchableHost).toBe("LinkedIn");
    expect(r.warnings.join(" ")).toContain("não expõe API pública");
    expect(r.warnings.join(" ")).toContain("--description");
    // O host do source id perde o "www.", senão "linkedin.com" e
    // "www.linkedin.com" viram duas fontes para o mesmo lugar.
    const [linha] = await db.select().from(job).where(eq(job.id, r.jobId));
    expect(linha!.sourceId).toBe("manual:linkedin.com");
  });

  it("avisa que sem descrição o fit sai artificialmente baixo", async () => {
    // O aviso é o que impede a pessoa de concluir que a vaga é ruim quando o que
    // faltou foi texto para pontuar.
    const r = await addJob({
      url: "https://acme.test/careers/staff",
      title: "Staff AI Engineer",
      companyName: "Acme",
    });

    expect(r.warnings.join(" ")).toContain("keywords fica em zero");
    expect(r.unfetchableHost).toBeUndefined();
  });

  it("guarda notas e data de publicação informadas pela pessoa", async () => {
    const r = await addJob({
      url: "https://acme.test/careers/staff",
      title: "Staff AI Engineer",
      companyName: "Acme",
      location: "Remote — Brasil",
      description: "Descrição.",
      postedAt: "2026-07-15",
      notes: "Indicação da Ana",
    });

    const [linha] = await db.select().from(job).where(eq(job.id, r.jobId));
    expect(linha!.postedAt).toBe("2026-07-15T00:00:00.000Z");
    expect(linha!.locationRaw).toBe("Remote — Brasil");
    expect(JSON.stringify(linha!.raw)).toContain("Indicação da Ana");
  });

  it("recusa URL malformada antes de criar qualquer linha", async () => {
    // Sem a validação, o `new URL` estouraria mais adiante já com a fonte criada,
    // deixando lixo no cadastro de fontes.
    await expect(
      addJob({ url: "isto não é uma url", title: "T", companyName: "C" }),
    ).rejects.toThrow(/URL inválida/);

    await expect(db.select().from(source)).resolves.toHaveLength(0);
  });

  it("exige cargo e empresa quando a URL não resolveu nada", async () => {
    // São os dois campos sem os quais não existe fingerprint estável, e portanto
    // não existe deduplicação. Aceitar vazio criaria uma linha que nunca casa
    // com o mesmo anúncio vindo depois por um sync.
    await expect(addJob({ url: "https://acme.test/x" })).rejects.toThrow(/--title e --company/);
    await expect(addJob({ url: "https://acme.test/x", title: "T" })).rejects.toThrow(
      /--company/,
    );
  });

  it("deduplica contra a mesma vaga adicionada de novo", async () => {
    // Colar o mesmo link duas vezes é o erro mais provável do fluxo. A segunda
    // vez tem que atualizar, nunca duplicar.
    const entrada = {
      url: "https://acme.test/careers/staff",
      title: "Staff AI Engineer",
      companyName: "Acme",
      description: "Descrição.",
    };

    const primeira = await addJob(entrada);
    const segunda = await addJob(entrada);

    expect(primeira.created).toBe(true);
    expect(segunda.created).toBe(false);
    expect(segunda.outcome).toBe("unchanged");
    expect(segunda.jobId).toBe(primeira.jobId);
    await expect(db.select().from(job)).resolves.toHaveLength(1);
  });
});

describe("addManualDescriptionJob", () => {
  const base = {
    title: "Staff AI Engineer",
    companyName: "Acme",
    description: "Descrição colada da tela de comparação, com corpo suficiente.",
    inputMethod: "paste" as const,
  };

  it("exige cargo, empresa e descrição, ignorando espaço em branco", async () => {
    // Campo só com espaços é o que um formulário entrega quando alguém apaga o
    // conteúdo mas deixa o cursor. Aceitar criaria vaga sem identidade.
    await expect(addManualDescriptionJob({ ...base, title: "   " })).rejects.toThrow(
      /Informe o cargo/,
    );
    await expect(addManualDescriptionJob({ ...base, companyName: " " })).rejects.toThrow(
      /Informe a empresa/,
    );
    await expect(addManualDescriptionJob({ ...base, description: "\n\t " })).rejects.toThrow(
      /Informe a descrição/,
    );
  });

  it("recusa esquema que não seja HTTP na URL pública", async () => {
    // `javascript:` e `file:` viram link clicável na interface. O primeiro é
    // execução de script; o segundo abre o disco de quem clicar.
    await expect(
      addManualDescriptionJob({ ...base, url: "javascript:alert(1)" }),
    ).rejects.toThrow(/HTTP ou HTTPS/);
    await expect(
      addManualDescriptionJob({ ...base, url: "file:///etc/passwd" }),
    ).rejects.toThrow(/HTTP ou HTTPS/);
  });

  it("usa o host da URL pública como fonte, sem o 'www.'", async () => {
    const r = await addManualDescriptionJob({
      ...base,
      url: "https://www.acme.test/careers/staff",
    });

    const [linha] = await db.select().from(job).where(eq(job.id, r.jobId));
    expect(linha!.sourceId).toBe("manual:acme.test");
    expect(linha!.url).toBe("https://www.acme.test/careers/staff");
    const [fonte] = await db.select().from(source).where(eq(source.id, "manual:acme.test"));
    expect(fonte!.label).toBe("acme.test");
  });

  it("inventa uma origem estável quando não há URL pública nenhuma", async () => {
    // O schema exige origem. A URL sintética nunca é renderizada como link — ela
    // existe só para a linha ter identidade, e é derivada do fingerprint para
    // duas colagens do mesmo anúncio caírem na mesma vaga.
    const primeira = await addManualDescriptionJob({ ...base, inputMethod: "file" });
    const segunda = await addManualDescriptionJob({ ...base, inputMethod: "file" });

    expect(segunda.jobId).toBe(primeira.jobId);
    const [linha] = await db.select().from(job).where(eq(job.id, primeira.jobId));
    expect(linha!.url).toMatch(/^manual:\/\/local\//);
    expect(linha!.sourceId).toBe("manual:local");
    const [fonte] = await db.select().from(source).where(eq(source.id, "manual:local"));
    expect(fonte!.label).toBe("Manual");
  });

  it("guarda a proveniência da extração junto da vaga", async () => {
    // Descrição extraída de PDF pode estar truncada ou embaralhada. O aviso
    // precisa acompanhar a vaga, senão a próxima leitura do fit não sabe que o
    // texto era suspeito.
    const r = await addManualDescriptionJob({
      ...base,
      inputMethod: "file",
      sourceFilename: "vaga.pdf",
      documentFormat: "pdf",
      pages: 3,
      extractionWarnings: ["Pouca letra no texto extraído"],
    });

    expect(r.warnings).toEqual(["Pouca letra no texto extraído"]);
    const [linha] = await db.select().from(job).where(eq(job.id, r.jobId));
    const metadados = linha!.raw as Record<string, unknown>;
    expect(metadados).toMatchObject({
      manual: true,
      inputMethod: "file",
      sourceFilename: "vaga.pdf",
      documentFormat: "pdf",
      pages: 3,
    });
  });
});

describe("addManualDescriptionJob por um recrutador", () => {
  const base = {
    title: "Staff AI Engineer",
    companyName: "Acme",
    description: "Vaga oferecida por um recrutador, com corpo suficiente.",
    inputMethod: "paste" as const,
  };

  it("separa a fonte do recrutador da fonte manual do próprio candidato", async () => {
    // O rótulo de origem — web · recrutador · manual — deriva de `source.kind`,
    // e não de uma coluna denormalizada na vaga. Reaproveitar `manual:` para as
    // duas faria a lista dizer "eu colei isto" sobre uma vaga que alguém ofereceu.
    const r = await addManualDescriptionJob({ ...base, sourceKind: "recruiter" });

    expect(r.kind).toBe("recruiter");
    const [linha] = await db.select().from(job).where(eq(job.id, r.jobId));
    expect(linha!.sourceId).toBe("recruiter:local");
    expect(linha!.url).toMatch(/^recruiter:\/\/local\//);
    const [fonte] = await db.select().from(source).where(eq(source.id, "recruiter:local"));
    expect(fonte!.kind).toBe("recruiter");
    expect(fonte!.enabled).toBe(false);
  });

  it("registra qual recrutador ofereceu a vaga", async () => {
    // Atribuição, não rótulo: guarda a quem perguntar. Vem da sessão, nunca do
    // formulário — id em entrada é pedido, não prova (regra 15).
    const [conta] = await db
      .insert(authUser)
      .values({ email: "recrutador@exemplo.test", roles: ["recruiter"] })
      .returning({ id: authUser.id });

    const r = await addManualDescriptionJob({
      ...base,
      sourceKind: "recruiter",
      postedByUserId: conta!.id,
    });

    const [linha] = await db.select().from(job).where(eq(job.id, r.jobId));
    expect(linha!.postedByUserId).toBe(conta!.id);
    expect(r.warnings).toEqual([]);
  });

  it("avisa em vez de perder a vaga quando a atribuição não resolve", async () => {
    // O modo aberto sintetiza sessão com `userId: 0`, que não é linha nenhuma em
    // `auth_user`. A ordem de importância decide o comportamento: a vaga é o
    // dado, a atribuição é metadado — falhar aqui não pode custar o que a pessoa
    // digitou.
    const r = await addManualDescriptionJob({
      ...base,
      sourceKind: "recruiter",
      postedByUserId: 999_999,
    });

    expect(r.jobId).toBeGreaterThan(0);
    expect(r.warnings.join(" ")).toContain("Não foi possível registrar quem cadastrou");
    const [linha] = await db.select().from(job).where(eq(job.id, r.jobId));
    expect(linha!.postedByUserId).toBeNull();
  });

  it("ignora atribuição ausente ou sentinela zero sem tocar no banco", async () => {
    // `0` é a sessão sintética do modo aberto, e `null` é "não veio de ninguém".
    // Os dois têm que passar direto, não virar aviso.
    const semAtribuicao = await addManualDescriptionJob({ ...base, postedByUserId: null });
    const sentinela = await addManualDescriptionJob({
      ...base,
      title: "Outro cargo",
      postedByUserId: 0,
    });

    expect(semAtribuicao.warnings).toEqual([]);
    expect(sentinela.warnings).toEqual([]);
    const linhas = await db.select().from(job);
    expect(linhas.every((l) => l.postedByUserId === null)).toBe(true);
  });
});

describe("upsertRawJob", () => {
  it("continua traduzindo o desfecho canônico para o booleano antigo", async () => {
    // Fachada mantida por compatibilidade. Enquanto existir chamador, ela tem
    // que concordar com `observeRawJob` — duas verdades sobre "foi criada?" é
    // como um contador de sync começa a mentir.
    await db
      .insert(source)
      .values({ id: "manual:acme", kind: "manual", handle: "acme", label: "Acme" });
    const raw = {
      externalId: "x1",
      companyName: "Acme",
      title: "Staff AI Engineer",
      url: "https://acme.test/x1",
      raw: {},
    };

    const primeira = await upsertRawJob(raw, "manual:acme");
    const segunda = await upsertRawJob(raw, "manual:acme");

    expect(primeira.created).toBe(true);
    expect(primeira.outcome).toBe("inserted");
    expect(segunda.created).toBe(false);
    expect(segunda.outcome).toBe("unchanged");
  });
});
