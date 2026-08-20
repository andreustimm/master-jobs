/**
 * Suíte: `src/core/ingest/detect.ts` e `src/core/ingest/job-document.ts`.
 *
 * Os dois cobrem o mesmo momento — a pessoa trouxe uma vaga de fora — por duas
 * portas diferentes: uma URL colada, ou um arquivo com a descrição. Em ambos o
 * risco é o mesmo: aceitar algo que *parece* ter dado e gravar uma vaga que o
 * scorer vai pontuar com base em lixo.
 *
 * Fronteira DENTRO: reconhecimento de padrão e extração determinística.
 * Fronteira FORA: rede e banco — nenhum caso aqui toca em um ou outro.
 */
import { describe, expect, it } from "vitest";
import { describeUnfetchable, detectJobUrl } from "../src/core/ingest/detect.ts";
import {
  extractJobDocument,
  JobDocumentError,
  MAX_JOB_DESCRIPTION_CHARS,
  MAX_JOB_DOCUMENT_BYTES,
} from "../src/core/ingest/job-document.ts";

const bytes = (texto: string) => new TextEncoder().encode(texto);

describe("detectJobUrl", () => {
  it("reconhece o board embutido do Greenhouse, que não carrega id de vaga", () => {
    // Este é o formato que aparece quando a empresa embute o Greenhouse na
    // própria página de carreiras. Só dá para saber o board, não a vaga — e
    // reconhecer mesmo assim vale, porque o adapter lista o board inteiro e o
    // casamento acontece pela URL depois.
    const detectado = detectJobUrl(
      "https://boards.greenhouse.io/embed/job_app?for=stackblitz&token=4111216009",
    );

    expect(detectado).toEqual({
      kind: "greenhouse",
      handle: "stackblitz",
      externalId: undefined,
      label: "Stackblitz",
    });
  });

  it("reconhece o SmartRecruiters preservando as maiúsculas do handle", () => {
    // O handle do SmartRecruiters é sensível a caixa na API. Normalizar aqui
    // produziria 404 no adapter.
    const detectado = detectJobUrl("https://jobs.smartrecruiters.com/AcmeCorp/743999");

    expect(detectado!.handle).toBe("AcmeCorp");
    expect(detectado!.externalId).toBe("743999");
  });

  it("transforma pontuação do handle em rótulo legível", () => {
    // O handle costuma ser o nome da empresa em kebab-case. Mostrar
    // "text-layer.ai" na tela até a API responder é pior que "Text Layer Ai".
    expect(detectJobUrl("https://jobs.ashbyhq.com/text-layer.ai")!.label).toBe("Text Layer Ai");
  });

  it("devolve nulo para link que não é de board conhecido", () => {
    // Encurtador, página de carreira própria e post de LinkedIn continuam
    // entrando pelo caminho manual — só não passam pelo adapter.
    expect(detectJobUrl("https://bit.ly/vaga")).toBeNull();
    expect(detectJobUrl("https://acme.com/careers/staff-engineer")).toBeNull();
  });

  it("nomeia os hosts reconhecíveis que não têm API pública", () => {
    // O nome é o que permite a mensagem dizer "LinkedIn não expõe API" em vez de
    // "não consegui". A primeira é acionável; a segunda parece bug.
    expect(describeUnfetchable("https://www.linkedin.com/jobs/view/123")).toBe("LinkedIn");
    expect(describeUnfetchable("https://acme.myworkdayjobs.com/x/job/1")).toBe("Workday");
    expect(describeUnfetchable("https://app.loxo.co/job/1")).toBe("Loxo");
    expect(describeUnfetchable("https://jobs.ashbyhq.com/acme")).toBeNull();
  });
});

describe("extractJobDocument", () => {
  const corpo = "Descrição de vaga com tamanho suficiente para passar do mínimo. ".repeat(3);

  it("normaliza quebra de linha do Windows sem alterar o conteúdo", async () => {
    // Colar de um .docx exportado no Windows traz CRLF. Sem normalizar, o
    // `contentHash` mudaria só por o arquivo ter passado por outro sistema
    // operacional, e a vaga apareceria como "editada".
    const r = await extractJobDocument({
      name: "vaga.txt",
      data: bytes(corpo.replace(/ /g, "\r\n")),
    });

    expect(r.text).not.toContain("\r");
    expect(r.format).toBe("text");
    expect(r.pages).toBeNull();
  });

  it("guarda só o nome do arquivo, nunca o caminho de onde ele veio", async () => {
    // O caminho revela a estrutura de diretórios da máquina do usuário e não
    // acrescenta nada à proveniência: o que importa é qual arquivo, não onde ele
    // estava.
    const r = await extractJobDocument({
      name: "/Users/alguem/Documentos secretos/vaga.md",
      data: bytes(corpo),
    });

    expect(r.sourceFilename).toBe("vaga.md");
    expect(r.format).toBe("markdown");
  });

  it("cai para um nome genérico quando o arquivo chega sem nome utilizável", async () => {
    // Upload por clipboard pode chegar com nome vazio. Sem o fallback a extensão
    // ficaria indefinida e o arquivo seria recusado por motivo errado.
    await expect(extractJobDocument({ name: "", data: bytes(corpo) })).rejects.toMatchObject({
      code: "unsupported-file",
    });
    await expect(
      extractJobDocument({ name: "sem-extensao", data: bytes(corpo) }),
    ).rejects.toMatchObject({ code: "unsupported-file" });
  });

  it("recusa descrição maior que o teto, com código próprio", async () => {
    // O teto existe porque o texto vai para o banco e, no caminho do LLM, para
    // fora da máquina. Um PDF de manual inteiro colado como vaga custaria os dois.
    const gigante = "a".repeat(MAX_JOB_DESCRIPTION_CHARS + 1);

    await expect(
      extractJobDocument({ name: "vaga.txt", data: bytes(gigante) }),
    ).rejects.toMatchObject({ code: "description-too-long" });
  });

  it("recusa arquivo binário disfarçado de texto pelo byte nulo", async () => {
    // UTF-8 estrito já barra a maioria dos binários, mas um .txt com NUL passa
    // pela decodificação e viraria uma descrição cheia de caracteres invisíveis
    // que o scorer contaria como palavras.
    const comNulo = new Uint8Array([...bytes(corpo), 0, ...bytes(corpo)]);

    const erro = await extractJobDocument({ name: "vaga.txt", data: comNulo }).catch(
      (e: unknown) => e,
    );

    expect(erro).toBeInstanceOf(JobDocumentError);
    expect((erro as JobDocumentError).code).toBe("file-not-text");
  });

  it("recusa sequência de bytes que não é UTF-8 válido", async () => {
    // Um .txt salvo em Latin-1 com acento chega assim. Decodificar "por
    // aproximação" gravaria mojibake como descrição da vaga.
    const latin1 = new Uint8Array([...bytes("Descrição ".repeat(20)), 0xff, 0xfe]);

    await expect(
      extractJobDocument({ name: "vaga.txt", data: latin1 }),
    ).rejects.toMatchObject({ code: "file-not-text" });
  });

  it("reporta falha de extração de PDF sem vazar o erro da biblioteca", async () => {
    // A mensagem interna do extrator não diz nada útil para quem subiu o
    // arquivo. O código estável é o que a interface consegue traduzir.
    const naoEhPdf = bytes("%PDF-1.4 mas o resto é lixo".repeat(20));

    const erro = await extractJobDocument({ name: "vaga.pdf", data: naoEhPdf }).catch(
      (e: unknown) => e,
    );

    expect(erro).toBeInstanceOf(JobDocumentError);
    expect((erro as JobDocumentError).code).toBe("extraction-failed");
    // A causa fica anexada para o log, sem ir para a tela.
    expect((erro as JobDocumentError).cause).toBeDefined();
  });

  it("recusa arquivo vazio e arquivo grande demais antes de tentar decodificar", async () => {
    // A ordem importa: checar tamanho primeiro evita alocar 10 MB de string para
    // descobrir no fim que o arquivo era grande demais.
    await expect(
      extractJobDocument({ name: "vaga.txt", data: new Uint8Array(0) }),
    ).rejects.toMatchObject({ code: "file-empty" });

    await expect(
      extractJobDocument({
        name: "vaga.txt",
        data: new Uint8Array(MAX_JOB_DOCUMENT_BYTES + 1),
      }),
    ).rejects.toMatchObject({ code: "file-too-large" });
  });

  it("recusa descrição curta demais para ser um anúncio", async () => {
    // Abaixo do mínimo é quase certamente um recorte errado da página. Aceitar
    // produziria uma vaga com keyword zerada e fit artificialmente baixo.
    await expect(
      extractJobDocument({ name: "vaga.txt", data: bytes("Vaga boa.") }),
    ).rejects.toMatchObject({ code: "description-too-short" });
  });

  it("aceita ArrayBuffer além de Uint8Array", async () => {
    // O `File` do navegador entrega `ArrayBuffer`; o `readFile` do Node entrega
    // `Uint8Array`. As duas superfícies chamam esta mesma função.
    const origem = bytes(corpo);
    const buffer = origem.buffer.slice(origem.byteOffset, origem.byteOffset + origem.byteLength);

    const r = await extractJobDocument({ name: "vaga.markdown", data: buffer });

    expect(r.format).toBe("markdown");
    expect(r.text.length).toBeGreaterThan(100);
  });
});
