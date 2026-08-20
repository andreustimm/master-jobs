/**
 * Suíte: os comandos de correio de `src/cli.ts` que dependem de credencial —
 * `mail auth`, `mail fetch` — mais os ramos de `mail import` que só aparecem
 * quando o e-mail é um alerta de vaga.
 *
 * ## Por que o módulo do Gmail é dublado, e só ele
 *
 * `cov-mail-gmail.test.ts` já cobre o fluxo OAuth de verdade: PKCE, o servidor
 * de callback em 127.0.0.1, o `state` divergente, a troca do código, o modo 600
 * do arquivo de token. Repetir isso aqui não acrescentaria nada e traria dois
 * problemas concretos: `authorize()` abre uma porta e FICA ESPERANDO um
 * navegador que nunca vem, e `readToken()` lê `<cwd>/.gmail.token.json` — quer
 * dizer, dentro do repositório, num teste.
 *
 * O que pertence a `cli.ts` é a casca em volta:
 *
 *  - a ordem das duas guardas (credencial primeiro, token depois) e o texto de
 *    cada uma, que é o que diz à pessoa qual dos dois passos falta;
 *  - o código de saída, que é o que um script de operação observa;
 *  - a tradução das flags (`-q`, `-n`, `-o`) para as opções da função, com o
 *    `Number()` no meio;
 *  - o `catch` que transforma exceção de rede em mensagem, em vez de rastro
 *    de pilha.
 *
 * Nada disso é verificável sem substituir as duas funções que falam com o
 * Google. `credentialsFromEnv` continua sendo a de produção, porque ela é
 * justamente parte do que está sendo testado.
 *
 * Fronteira DENTRO: guardas, flags, código de saída, texto de orientação.
 * Fronteira FORA: OAuth, MIME, classificação — suítes próprias.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCandidateFromProfile } from "../src/core/candidate.ts";
import { job, mailMessage } from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";

/**
 * Estado do dublê do Gmail.
 *
 * Precisa ser `vi.hoisted` porque a fábrica de `vi.mock` é içada para antes de
 * qualquer declaração do arquivo — uma `const` comum ainda estaria na zona
 * morta temporal quando a fábrica rodasse.
 */
const gmail = vi.hoisted(() => ({
  autorizar: null as
    | null
    | ((creds: unknown, onUrl: (url: string) => void) => Promise<{ email?: string; savedTo: string }>),
  baixar: null as
    | null
    | ((
      creds: unknown,
      token: unknown,
      opts: { query?: string; max?: number; outDir?: string },
    ) => Promise<{ found: number; written: number; skipped: number; dir: string }>),
  /** O que `readToken()` devolve. `null` = Gmail nunca conectado. */
  token: null as { refresh_token: string } | null,
}));

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

vi.mock("../src/core/mail/gmail.ts", async () => {
  const real = await vi.importActual<typeof import("../src/core/mail/gmail.ts")>(
    "../src/core/mail/gmail.ts",
  );
  return {
    ...real,
    authorize: (creds: unknown, onUrl: (url: string) => void) => gmail.autorizar!(creds, onUrl),
    fetchToDir: (
      creds: unknown,
      token: unknown,
      opts: { query?: string; max?: number; outDir?: string },
    ) => gmail.baixar!(creds, token, opts),
    readToken: async () => gmail.token,
  };
});

const CREDENCIAIS = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"] as const;
const originais: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const chave of CREDENCIAIS) originais[chave] = process.env[chave];
  await carregarCli();
});

beforeEach(async () => {
  await useTestDb();
  for (const chave of CREDENCIAIS) delete process.env[chave];
  gmail.autorizar = null;
  gmail.baixar = null;
  gmail.token = null;
});

afterEach(() => {
  for (const chave of CREDENCIAIS) {
    if (originais[chave] === undefined) delete process.env[chave];
    else process.env[chave] = originais[chave];
  }
  releaseTestDb();
});

function comCredenciais(): void {
  process.env.GMAIL_CLIENT_ID = "id-de-teste.apps.googleusercontent.com";
  process.env.GMAIL_CLIENT_SECRET = "segredo-de-teste";
}

/* --------------------------------- auth ----------------------------------- */

describe("jho mail auth", () => {
  it("sem GMAIL_CLIENT_ID/SECRET, sai com 1 e aponta a documentação", async () => {
    const r = await rodar("mail", "auth");

    // Sai com 1 porque isto é pré-requisito não atendido, não escolha do
    // usuário — um script de instalação precisa parar aqui.
    expect(r.code).toBe(1);
    expect(r.err).toContain("GMAIL_CLIENT_ID");
    expect(r.err).toContain("GMAIL_CLIENT_SECRET");
    expect(r.out).toContain("docs/email-ingestion.md");
  });

  it("imprime a URL de consentimento e confirma a caixa conectada", async () => {
    comCredenciais();
    let urlRecebida: string | undefined;
    gmail.autorizar = async (_creds, onUrl) => {
      onUrl("https://accounts.google.com/o/oauth2/v2/auth?client_id=id-de-teste");
      urlRecebida = "chamou";
      return { email: "eu@exemplo.test", savedTo: "/tmp/jho/.gmail.token.json" };
    };

    const r = await rodar("mail", "auth");

    expect(r.code).toBeUndefined();
    expect(urlRecebida).toBe("chamou");
    // A URL tem de aparecer inteira: ela é o único caminho para o consentimento,
    // e truncá-la deixaria o fluxo sem saída.
    expect(r.out).toContain("https://accounts.google.com/o/oauth2/v2/auth?client_id=id-de-teste");
    expect(r.out).toContain("Gmail conectado como eu@exemplo.test");
    expect(r.out).toContain("/tmp/jho/.gmail.token.json");
    // Dizer o escopo depois de conectar é o que torna a Trava do ADR 0008
    // visível para quem autorizou: o token não consegue enviar nem apagar.
    expect(r.out).toContain("somente leitura");
  });

  it("conecta mesmo quando o Google não devolve o endereço da caixa", async () => {
    comCredenciais();
    gmail.autorizar = async () => ({ savedTo: "/tmp/jho/.gmail.token.json" });

    const r = await rodar("mail", "auth");

    expect(r.code).toBeUndefined();
    // O token já está salvo e funciona; falhar aqui por causa de um rótulo
    // seria descartar uma autorização inteira por nada.
    expect(r.out).toContain("Gmail conectado");
    expect(r.out).not.toContain("conectado como");
  });

  it("autorização negada vira mensagem e código 1, não rastro de pilha", async () => {
    comCredenciais();
    gmail.autorizar = async () => {
      throw new Error("Autorização negada: access_denied");
    };

    const r = await rodar("mail", "auth");

    expect(r.code).toBe(1);
    expect(r.err).toContain("Autorização negada: access_denied");
    // Um `throw` escapando daqui subiria até o `catch` do topo do módulo e
    // apareceria como falha do programa, e não como recusa do usuário.
    expect(r.erro).toBeUndefined();
  });
});

/* --------------------------------- fetch ---------------------------------- */

describe("jho mail fetch", () => {
  it("sem credencial, recusa antes de olhar o token", async () => {
    gmail.token = { refresh_token: "existe" };

    const r = await rodar("mail", "fetch");

    // A ordem das guardas é a ordem em que a pessoa resolve: sem credencial, o
    // token nem faz sentido ainda.
    expect(r.code).toBe(1);
    expect(r.err).toContain("Credenciais ausentes");
  });

  it("com credencial e sem token, manda rodar `mail auth`", async () => {
    comCredenciais();

    const r = await rodar("mail", "fetch");

    expect(r.code).toBe(1);
    expect(r.err).toContain("jho mail auth");
  });

  it("usa os padrões documentados: 100 mensagens em data/mail, consulta padrão", async () => {
    comCredenciais();
    gmail.token = { refresh_token: "t" };
    let recebido: { query?: string; max?: number; outDir?: string } | undefined;
    gmail.baixar = async (_c, _t, opts) => {
      recebido = opts;
      return { found: 3, written: 2, skipped: 1, dir: "/tmp/jho/data/mail" };
    };

    const r = await rodar("mail", "fetch");

    expect(r.code).toBeUndefined();
    // `Number(opts.max)`: sem a conversão, `Math.min("100", 500)` devolve a
    // string e o parâmetro `maxResults` da API vira texto.
    expect(recebido).toEqual({ query: undefined, max: 100, outDir: "data/mail" });
    expect(r.out).toContain("2 novo(s)");
    expect(r.out).toContain("1 já baixado(s)");
    expect(r.out).toContain("3 encontrado(s)");
    expect(r.out).toContain("/tmp/jho/data/mail");
  });

  it("deixa claro que baixar não é importar, e diz o comando seguinte", async () => {
    comCredenciais();
    gmail.token = { refresh_token: "t" };
    gmail.baixar = async () => ({ found: 1, written: 1, skipped: 0, dir: "/tmp/caixa" });

    const r = await rodar("mail", "fetch", "-o", "/tmp/caixa");

    // A separação entre baixar e importar é o que permite conferir o .eml antes
    // de qualquer coisa tocar o banco. O comando precisa dizer isso, senão a
    // separação vira só um passo extra sem propósito aparente.
    expect(r.out).toContain("Nada entrou no banco ainda");
    expect(r.out).toContain("jho mail import /tmp/caixa --dry-run");
  });

  it("`-q`, `-n` e `-o` chegam convertidos à função de download", async () => {
    comCredenciais();
    gmail.token = { refresh_token: "t" };
    let recebido: { query?: string; max?: number; outDir?: string } | undefined;
    gmail.baixar = async (_c, _t, opts) => {
      recebido = opts;
      return { found: 0, written: 0, skipped: 0, dir: "/tmp/x" };
    };

    await rodar("mail", "fetch", "-q", "from:acme.test newer_than:7d", "-n", "25", "-o", "/tmp/x");

    expect(recebido).toEqual({
      query: "from:acme.test newer_than:7d",
      max: 25,
      outDir: "/tmp/x",
    });
  });

  it("erro do Gmail vira mensagem e código 1", async () => {
    comCredenciais();
    gmail.token = { refresh_token: "t" };
    gmail.baixar = async () => {
      throw new Error("Gmail respondeu 401 ao listar mensagens");
    };

    const r = await rodar("mail", "fetch");

    expect(r.code).toBe(1);
    expect(r.err).toContain("Gmail respondeu 401");
    expect(r.erro).toBeUndefined();
  });
});

/* -------------------------------- import ---------------------------------- */

describe("jho mail import <path> — alertas de vaga", () => {
  /** Alerta do LinkedIn: dois anúncios legíveis e um link sem título. */
  const ALERTA = `<div>
      <a href="https://www.linkedin.com/comm/jobs/view/4231234567/?trackingId=abc">Senior AI Solutions Architect</a>
      <span>Nubank</span> · <span>São Paulo, Brazil (Remote)</span>
    </div>
    <div>
      <a href="https://www.linkedin.com/jobs/view/4239876543">Staff Platform Engineer</a>
      <span>Datadog</span> · <span>Remote - LATAM</span>
    </div>
    <div>
      <a href="https://www.linkedin.com/jobs/view/4230000009">Apply</a>
    </div>`;

  async function pastaCom(
    arquivos: Array<{ nome: string; de: string; assunto: string; corpo: string; html?: boolean }>,
  ): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "jho-cli-mail-rede-"));
    for (const a of arquivos) {
      const cabecalho = [
        `Message-ID: <${a.nome}@teste>`,
        `From: ${a.de}`,
        "To: eu@exemplo.test",
        `Subject: ${a.assunto}`,
        "Date: Mon, 17 Aug 2026 10:00:00 +0000",
        `Content-Type: text/${a.html ? "html" : "plain"}; charset=utf-8`,
      ].join("\n");
      await writeFile(join(dir, a.nome), `${cabecalho}\n\n${a.corpo}`);
    }
    return dir;
  }

  it("cria as vagas do alerta e as pontua na mesma passada", async () => {
    await syncCandidateFromProfile();
    const dir = await pastaCom([
      {
        nome: "alerta.eml",
        de: "jobalerts-noreply@linkedin.com",
        assunto: "Senior AI Solutions Architect: 3 new jobs",
        corpo: ALERTA,
        html: true,
      },
    ]);

    const r = await rodar("mail", "import", dir);

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("2 vaga(s) nova(s) dos alertas");
    // Pontuar no mesmo comando é o que faz a vaga do alerta aparecer no quadro
    // já ranqueada; sem isso ela entraria sem nota e ficaria invisível.
    expect(r.out).toContain("Scoring");
    expect(await banco().select().from(job)).toHaveLength(2);
  });

  it("avisa quando um link do alerta veio sem título legível", async () => {
    await syncCandidateFromProfile();
    const dir = await pastaCom([
      {
        nome: "alerta.eml",
        de: "jobalerts-noreply@linkedin.com",
        assunto: "3 new jobs",
        corpo: ALERTA,
        html: true,
      },
    ]);

    const r = await rodar("mail", "import", dir);

    // O aviso é o detector de mudança de template do LinkedIn: sem ele, o dia
    // em que a extração parar de funcionar seria só um dia com menos vagas.
    expect(r.out).toContain("sem título legível");
    expect(r.out).toContain("o template do e-mail pode ter mudado");
  });

  it("`--dry-run` classifica o alerta e não cria vaga nem mensagem", async () => {
    await syncCandidateFromProfile();
    const dir = await pastaCom([
      {
        nome: "alerta.eml",
        de: "jobalerts-noreply@linkedin.com",
        assunto: "3 new jobs",
        corpo: ALERTA,
        html: true,
      },
    ]);

    const r = await rodar("mail", "import", dir, "--dry-run");

    expect(r.out).toContain("job_alert");
    expect(r.out).toContain("nada foi gravado");
    expect(await banco().select().from(job)).toHaveLength(0);
    expect(await banco().select().from(mailMessage)).toHaveLength(0);
    // Sem gravação não há vaga nova, e sem vaga nova não há por que pontuar.
    expect(r.out).not.toContain("Scoring");
  });

  it("resume por tipo, distinguindo alerta, ATS e desconhecido", async () => {
    await syncCandidateFromProfile();
    const dir = await pastaCom([
      {
        nome: "alerta.eml",
        de: "jobalerts-noreply@linkedin.com",
        assunto: "3 new jobs",
        corpo: ALERTA,
        html: true,
      },
      {
        nome: "ats.eml",
        de: "no-reply@acme.greenhouse.io",
        assunto: "We received your application",
        corpo: "We have received your application and will review it shortly.",
      },
      {
        nome: "qualquer.eml",
        de: "amiga@exemplo.test",
        assunto: "Almoço quinta?",
        corpo: "Você tem agenda quinta ao meio-dia?",
      },
    ]);

    const r = await rodar("mail", "import", dir);

    // O resumo por tipo é o que diz se a caixa está sendo lida como deveria —
    // uma pilha de `unknown` significa classificador cego, não caixa vazia.
    expect(r.out).toContain("3 arquivo(s) · 3 novo(s)");
    expect(r.out).toContain("job_alert");
    expect(r.out).toMatch(/ats_\w+/);
    expect(r.out).toContain("unknown");
  });
});
