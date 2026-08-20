import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ComparisonInputError,
  createManualComparison,
  getComparisonDetail,
  type ComparisonErrorCode,
  type ComparisonField,
  type ManualComparisonInput,
} from "../src/contexts/matching/index.ts";
import { ensureCandidate, saveDocument } from "../src/core/candidate.ts";
import type { DB } from "../src/core/db/client.ts";
import { job, skill } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * A comparação manual é a resposta ao gargalo real do produto: o acervo tem
 * 6.000 vagas e o funil tem 1 candidatura — falta decisão, não descoberta. O
 * usuário cola uma vaga que achou em qualquer lugar e recebe o mesmo score
 * canônico das vagas sincronizadas.
 *
 * Por isso o caso de uso é quase todo validação: ele recebe entrada de
 * formulário e de upload, e cada recusa precisa dizer QUAL campo está errado e
 * POR QUÊ, num código estável que a UI traduz. Mensagem genérica devolve o
 * usuário ao formulário sem saber o que corrigir, e a tela é justamente a que
 * deveria destravar o funil.
 */
const DESCRICAO =
  "Senior AI Software Architect para liderar plataformas de LLM em produção, com TypeScript, " +
  "Python, sistemas distribuídos, observabilidade e entrega em nuvem. Totalmente remoto, aberto " +
  "para LATAM e Brasil, contrato B2B.";

let db: DB;
let candidatoId: number;

const entrada = (extra: Partial<ManualComparisonInput> = {}): ManualComparisonInput => ({
  title: "Senior AI Software Architect",
  companyName: "Exemplo Labs",
  location: "Remoto · LATAM",
  url: "",
  description: DESCRICAO,
  ...extra,
});

async function recusa(
  input: ManualComparisonInput,
): Promise<{ code: ComparisonErrorCode; field?: ComparisonField }> {
  try {
    await createManualComparison(candidatoId, input);
  } catch (erro) {
    expect(erro).toBeInstanceOf(ComparisonInputError);
    const e = erro as ComparisonInputError;
    // A mensagem existe para log; o contrato com a UI é o par código+campo.
    expect(e.message).toContain(e.code);
    return { code: e.code, field: e.field };
  }
  throw new Error("esperava recusa e a chamada passou");
}

beforeEach(async () => {
  db = await useTestDb();
  candidatoId = await ensureCandidate({ name: "Candidato da Comparação" });
});

afterEach(() => {
  releaseTestDb();
});

describe("createManualComparison: validação por campo, com código estável", () => {
  it("exige cargo e empresa com conteúdo de verdade", async () => {
    // Espaço em branco não é preenchimento: `trim` acontece antes do mínimo,
    // senão "   " passaria e a vaga entraria no acervo sem título.
    expect(await recusa(entrada({ title: "" }))).toEqual({
      code: "required",
      field: "title",
    });
    expect(await recusa(entrada({ title: "   " }))).toEqual({
      code: "required",
      field: "title",
    });
    expect(await recusa(entrada({ companyName: "X" }))).toEqual({
      code: "required",
      field: "companyName",
    });
  });

  it("limita o tamanho de cada campo de texto no campo certo", async () => {
    // O limite protege o fingerprint e a listagem. O que importa no teste é o
    // CAMPO devolvido: apontar "too-long" sem dizer onde é indistinguível de
    // não validar nada, do ponto de vista de quem preenche.
    expect(await recusa(entrada({ title: "a".repeat(181) }))).toEqual({
      code: "too-long",
      field: "title",
    });
    expect(await recusa(entrada({ companyName: "a".repeat(181) }))).toEqual({
      code: "too-long",
      field: "companyName",
    });
    expect(await recusa(entrada({ location: "a".repeat(241) }))).toEqual({
      code: "too-long",
      field: "location",
    });
    expect(
      await recusa(entrada({ url: `https://exemplo.test/${"a".repeat(2_000)}` })),
    ).toEqual({ code: "too-long", field: "url" });
    expect(await recusa(entrada({ description: "a".repeat(200_001) }))).toEqual({
      code: "too-long",
      field: "description",
    });
  });

  it("aceita só URL pública HTTP(S)", async () => {
    // `manual://` é identidade de banco e `javascript:` é ataque; nenhum dos
    // dois pode virar link clicável na tela de detalhe.
    for (const url of ["não é url", "javascript:alert(1)", "manual://local/x", "ftp://a.test/x"]) {
      expect(await recusa(entrada({ url })), url).toEqual({
        code: "invalid-url",
        field: "url",
      });
    }
  });

  it("recusa descrição curta demais para produzir score honesto", async () => {
    // Abaixo de 100 caracteres o componente de keywords fica praticamente
    // zerado e o fit sai artificialmente baixo — pior que não pontuar, porque
    // parece um veredito.
    expect(await recusa(entrada({ description: "Vaga boa, remoto." }))).toEqual({
      code: "description-too-short",
      field: "description",
    });
  });

  it("exige exatamente uma fonte de conteúdo", async () => {
    // Nenhuma fonte não dá o que pontuar. Duas fontes exigiriam escolher qual
    // vale, e qualquer escolha implícita é a errada metade das vezes.
    expect(await recusa(entrada({ description: "" }))).toEqual({ code: "missing-source" });
    expect(
      await recusa(
        entrada({
          document: {
            name: "vaga.txt",
            type: "text/plain",
            data: new TextEncoder().encode(DESCRICAO).buffer as ArrayBuffer,
          },
        }),
      ),
    ).toEqual({ code: "multiple-sources" });
  });

  it("degrada para `unexpected` em vez de vazar erro do validador", async () => {
    // A entrada vem de FormData, onde tudo pode ser qualquer coisa. Um erro de
    // Zod não previsto não pode chegar cru à Server Action — vira "unexpected"
    // com o campo, quando dá para saber qual é.
    expect(await recusa(entrada({ title: 42 as unknown as string }))).toEqual({
      code: "unexpected",
      field: "title",
    });
    // Sem campo identificável, resta a forma sem campo.
    expect(await recusa(null as unknown as ManualComparisonInput)).toEqual({
      code: "unexpected",
      field: undefined,
    });
  });
});

describe("createManualComparison: upload de arquivo", () => {
  const comoArquivo = (nome: string, texto: string) =>
    entrada({
      description: "",
      document: {
        name: nome,
        type: "text/plain",
        data: new TextEncoder().encode(texto).buffer as ArrayBuffer,
      },
    });

  it("extrai texto de arquivo e guarda a proveniência", async () => {
    const { jobId } = await createManualComparison(
      candidatoId,
      comoArquivo("descricao-da-vaga.md", `# Vaga\n\n${DESCRICAO}`),
    );

    const detalhe = await getComparisonDetail(candidatoId, jobId);
    expect(detalhe?.metadata).toEqual({
      sourceFilename: "descricao-da-vaga.md",
      documentFormat: "markdown",
      pages: null,
      warningCount: 0,
    });
    // O binário é transitório por desenho: fica o texto extraído e a
    // proveniência para auditar, nunca o arquivo.
    expect(detalhe?.job.descriptionText).toContain("Senior AI Software Architect");
  });

  it("traduz cada falha de extração para o campo `file`", async () => {
    // O erro é do arquivo, não do formulário. Marcar o campo errado manda o
    // usuário corrigir o texto que ele nem digitou.
    expect(await recusa(comoArquivo("curriculo.docx", DESCRICAO))).toEqual({
      code: "unsupported-file",
      field: "file",
    });
    expect(await recusa(comoArquivo("vaga.txt", "curta demais"))).toEqual({
      code: "description-too-short",
      field: "file",
    });
    expect(
      await recusa(
        entrada({
          description: "",
          document: { name: "vazio.txt", type: "text/plain", data: new ArrayBuffer(0) },
        }),
      ),
    ).toEqual({ code: "file-empty", field: "file" });
  });

  it("converte falha inesperada de extração em `extraction-failed`", async () => {
    // ArrayBuffer transferido (destacado) é o caso real: o upload chega de um
    // worker e o buffer já foi movido. Sem este ramo, um TypeError cru subiria
    // pela Server Action e derrubaria a página inteira.
    const destacado = new ArrayBuffer(64);
    structuredClone(destacado, { transfer: [destacado] });

    expect(
      await recusa(
        entrada({
          description: "",
          document: { name: "vaga.txt", type: "text/plain", data: destacado },
        }),
      ),
    ).toEqual({ code: "extraction-failed", field: "file" });
  });
});

describe("createManualComparison: caminho feliz", () => {
  it("observa a vaga e grava o score canônico do candidato", async () => {
    const { jobId } = await createManualComparison(candidatoId, entrada());

    const detalhe = await getComparisonDetail(candidatoId, jobId);
    expect(detalhe?.job.title).toBe("Senior AI Software Architect");
    // O score é o mesmo do resto do acervo: mesma tabela, mesma versão do
    // scorer. Se fosse um cálculo paralelo, a vaga colada não seria comparável
    // com as sincronizadas — e comparar é o objetivo da tela.
    expect(detalhe?.score?.fit).toBeGreaterThan(0);
    expect(detalhe?.score?.candidateId).toBe(candidatoId);
    expect(detalhe?.metadata).toMatchObject({
      sourceFilename: null,
      documentFormat: null,
      warningCount: 0,
    });
  });

  it("marca a vaga como manual e não oferece link externo inventado", async () => {
    // A URL sintética existe só porque o schema exige origem estável. Renderizá-la
    // como link levaria o usuário a um endereço que não existe.
    //
    // NOTA: apesar do nome, `externalUrl` é um SINALIZADOR booleano, não a URL
    // — a tela usa `externalUrl && <a href={detail.job.url}>`. O nome é uma
    // armadilha para o próximo consumidor, ainda mais porque
    // `publicPostingUrl()` existe no mesmo código e devolve a URL ou null.
    const { jobId } = await createManualComparison(candidatoId, entrada());
    const detalhe = await getComparisonDetail(candidatoId, jobId);

    expect(detalhe?.manualJob).toBe(true);
    expect(detalhe?.job.url).toMatch(/^manual:\/\/local\//);
    expect(detalhe?.externalUrl).toBe(false);
  });

  it("sinaliza link externo quando o usuário informa uma URL pública", async () => {
    const { jobId } = await createManualComparison(
      candidatoId,
      entrada({ url: "https://jobs.exemplo.test/arquiteto-ia" }),
    );
    const detalhe = await getComparisonDetail(candidatoId, jobId);
    expect(detalhe?.externalUrl).toBe(true);
    expect(detalhe?.job.url).toBe("https://jobs.exemplo.test/arquiteto-ia");
    // A vaga continua sendo observação do usuário, mesmo com URL pública: ela
    // nunca pode sobrescrever a observação canônica de um ATS.
    expect(detalhe?.manualJob).toBe(true);
  });

  it("colar a mesma vaga duas vezes não cria duas linhas", async () => {
    // Idempotência é regra do projeto, e aqui ela também é usabilidade: o
    // usuário reenvia o formulário depois de corrigir a localização.
    const primeira = await createManualComparison(candidatoId, entrada());
    const segunda = await createManualComparison(candidatoId, entrada());
    expect(segunda.jobId).toBe(primeira.jobId);
    expect(await db.select().from(job)).toHaveLength(1);
  });
});

describe("getComparisonDetail: modelo de leitura tipado", () => {
  it("devolve null para vaga que não existe", async () => {
    expect(await getComparisonDetail(candidatoId, 99_999)).toBeNull();
  });

  it("sem currículo salvo, não há comparação de vocabulário", async () => {
    // Comparar o vocabulário da vaga contra um currículo inexistente
    // produziria "faltam todos os termos" — conselho ruidoso e falso.
    const { jobId } = await createManualComparison(candidatoId, entrada());
    const detalhe = await getComparisonDetail(candidatoId, jobId);
    expect(detalhe?.cv).toBeNull();
    expect(detalhe?.vocabulary).toBeNull();
  });

  it("com currículo salvo, compara o vocabulário da vaga contra ele", async () => {
    await db.insert(skill).values([
      {
        slug: "kubernetes",
        canonicalName: "Kubernetes",
        category: "cloud",
        aliases: ["kubernetes", "k8s"],
      },
      {
        slug: "observability",
        canonicalName: "Observability",
        category: "practice",
        aliases: ["observabilidade", "observability"],
      },
    ]);
    await saveDocument({
      candidateId: candidatoId,
      label: "CV atual",
      content: "Operei plataformas Kubernetes e instrumentei serviços com métricas.",
    });

    const { jobId } = await createManualComparison(
      candidatoId,
      entrada({ description: `${DESCRICAO} A vaga exige Kubernetes e observabilidade.` }),
    );
    const detalhe = await getComparisonDetail(candidatoId, jobId);

    expect(detalhe?.cv?.label).toBe("CV atual");
    expect(detalhe?.vocabulary?.totalJobs).toBe(1);
    const k8s = detalhe?.vocabulary?.items.find((i) => i.skill.slug === "kubernetes");
    expect(k8s?.kind).toBe("covered");
    // "observabilidade" está na vaga e não no currículo: é exatamente a lacuna
    // de vocabulário que a tela existe para mostrar.
    expect(
      detalhe?.vocabulary?.items.find((i) => i.skill.slug === "observability")?.kind,
    ).toBe("missing");
  });

  it("lê metadados no formato aninhado, além do formato de raiz", async () => {
    // Duas gerações de gravação convivem na coluna `raw`. A leitura precisa
    // aceitar as duas, senão a proveniência do arquivo some da tela para toda
    // vaga cadastrada antes da mudança.
    const { jobId } = await createManualComparison(candidatoId, entrada());
    await db
      .update(job)
      .set({
        raw: {
          manualComparison: {
            manual: true,
            sourceFilename: "antiga.pdf",
            documentFormat: "pdf",
            pages: 3,
            extractionWarnings: ["ordem de leitura", "linhas longas"],
          },
        },
      })
      .where(eq(job.id, jobId));

    expect((await getComparisonDetail(candidatoId, jobId))?.metadata).toEqual({
      sourceFilename: "antiga.pdf",
      documentFormat: "pdf",
      pages: 3,
      warningCount: 2,
    });
  });

  it("devolve metadata null para vaga que não é comparação manual", async () => {
    // Uma vaga vinda de ATS tem `raw` com o payload da fonte. Interpretá-lo
    // como metadado de upload produziria campos inventados na tela.
    const { jobId } = await createManualComparison(candidatoId, entrada());

    // (`raw` é NOT NULL no schema, então null não é um estado alcançável)
    for (const cru of [{ sourcePayload: true }, "texto solto", 42, { manual: false }]) {
      await db.update(job).set({ raw: cru }).where(eq(job.id, jobId));
      expect((await getComparisonDetail(candidatoId, jobId))?.metadata, JSON.stringify(cru))
        .toBeNull();
    }
  });

  it("ignora campos de metadado com tipo errado em vez de propagá-los", async () => {
    // `raw` é JSON livre: `pages: "três"` chegaria à UI como número e quebraria
    // a formatação. Cada campo é conferido individualmente.
    const { jobId } = await createManualComparison(candidatoId, entrada());
    await db
      .update(job)
      .set({
        raw: {
          manual: true,
          sourceFilename: 7,
          documentFormat: null,
          pages: "três",
          extractionWarnings: "um aviso",
        },
      })
      .where(eq(job.id, jobId));

    expect((await getComparisonDetail(candidatoId, jobId))?.metadata).toEqual({
      sourceFilename: null,
      documentFormat: null,
      pages: null,
      warningCount: 0,
    });
  });
});
