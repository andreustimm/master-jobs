/**
 * O pipeline de ingestão de e-mail, de ponta a ponta (ADR 0008).
 *
 *   arquivo .eml -> parse -> classify -> { alerta -> vagas, ATS -> sugestão }
 *
 * A invariante que dá sentido a este arquivo inteiro: **importar e-mail nunca
 * escreve em `application`**. Todo o resto aqui é contagem; isso é o que não
 * pode quebrar. Um parser de rejeição que erra uma vez e fecha em silêncio um
 * processo vivo destrói o único dado que o sistema não sabe regenerar (ADR
 * 0005) — por isso cada teste de e-mail de ATS confere que o que apareceu foi
 * uma linha em `mail_suggestion`, e que a candidatura continuou onde estava.
 */
import { eq } from "drizzle-orm";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureCandidate } from "../src/core/candidate.ts";
import type { DB } from "../src/core/db/client.ts";
import { setApplicationStatus } from "../src/core/db/repo.ts";
import {
  application,
  job,
  mailMessage,
  mailSuggestion,
  source,
} from "../src/core/db/schema.ts";
import { ensureImportSource } from "../src/core/ingest/manual.ts";
import { observeRawJob } from "../src/core/ingest/observe.ts";
import { decideSuggestion, importMail, listSuggestions } from "../src/core/mail/run.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

let db: DB;
let candidateId: number;
let dir: string;

beforeEach(async () => {
  db = await useTestDb();
  candidateId = await ensureCandidate({ name: "Dono da Caixa" });
  dir = await mkdtemp(join(tmpdir(), "jho-mail-"));
});

afterEach(async () => {
  releaseTestDb();
  await rm(dir, { recursive: true, force: true });
});

/** Monta um .eml de uma parte só — é o formato que os ATS realmente mandam. */
async function writeEml(
  name: string,
  opts: {
    from: string;
    subject?: string;
    messageId?: string | null;
    date?: string;
    body: string;
    contentType?: string;
  },
): Promise<string> {
  const headers = [
    `From: ${opts.from}`,
    opts.subject === undefined ? null : `Subject: ${opts.subject}`,
    opts.messageId === undefined ? `Message-ID: <${name}@teste>` : null,
    opts.messageId ? `Message-ID: <${opts.messageId}>` : null,
    `Date: ${opts.date ?? "Mon, 17 Aug 2026 09:15:00 -0300"}`,
    `Content-Type: ${opts.contentType ?? "text/plain"}; charset=UTF-8`,
  ].filter((line): line is string => line !== null);
  const path = join(dir, name);
  await writeFile(path, `${headers.join("\n")}\n\n${opts.body}`);
  return path;
}

/** Alerta do LinkedIn com dois anúncios, no formato de anchor + irmãos. */
function alertHtml(title = "Senior AI Solutions Architect"): string {
  return `<div>
      <a href="https://www.linkedin.com/comm/jobs/view/4231234567/?trackingId=abc">${title}</a>
      <span>Nubank</span> · <span>São Paulo, Brazil (Remote)</span>
    </div>
    <div>
      <a href="https://www.linkedin.com/jobs/view/4239876543">Staff Platform Engineer</a>
      <span>Datadog</span> · <span>Remote - LATAM</span>
    </div>`;
}

/** Uma candidatura viva em "Acme", que é o alvo do casamento por empresa. */
async function applyToAcme(companyName = "Acme"): Promise<number> {
  await ensureImportSource("manual:teste", "manual", "teste", "Teste");
  const observation = await observeRawJob(
    {
      externalId: `acme-${companyName}`,
      companyName,
      title: "Software Architect",
      url: `https://jobs.example.test/${encodeURIComponent(companyName)}`,
      applyUrl: null,
      locationRaw: "Remote",
      remote: null,
      descriptionHtml: null,
      descriptionText: null,
      postedAt: null,
      raw: {},
    },
    "manual:teste",
  );
  await setApplicationStatus(candidateId, observation.jobId, "applied");
  return observation.jobId;
}

/* ------------------------------------------------------ coleta de arquivos */

describe("coleta de arquivos", () => {
  it("avisa em vez de silenciar quando o diretório não tem e-mail nenhum", async () => {
    // Zero silencioso é o pior resultado possível aqui: o usuário concluiria
    // que a caixa não trouxe nada, quando na verdade apontou para a pasta
    // errada.
    await writeFile(join(dir, "leiame.pdf"), "não é e-mail");

    const result = await importMail(dir, { candidateId });

    expect(result.files).toBe(0);
    expect(result.warnings.join(" ")).toContain("Nenhum arquivo .eml/.txt/.html");
  });

  it("aceita .eml, .txt e .html e ignora o resto", async () => {
    await writeEml("a.eml", { from: "x@acme.com", body: "oi" });
    await writeEml("b.txt", { from: "y@acme.com", body: "oi" });
    await writeEml("c.html", { from: "z@acme.com", body: "oi" });
    await writeFile(join(dir, "d.pdf"), "binário");

    const result = await importMail(dir, { candidateId });

    expect(result.files).toBe(3);
    expect(result.parsed).toBe(3);
  });

  it("aceita um arquivo único, e não só um diretório", async () => {
    // O usuário salva um e-mail solto do cliente de e-mail com muito mais
    // frequência do que monta uma pasta.
    const path = await writeEml("unico.eml", { from: "x@acme.com", body: "oi" });

    await expect(importMail(path, { candidateId })).resolves.toMatchObject({
      files: 1,
      parsed: 1,
    });
  });
});

/* ------------------------------------------------------------ deduplicação */

describe("deduplicação", () => {
  it("reimportar a mesma mensagem não cria uma segunda linha", async () => {
    await writeEml("um.eml", {
      from: "Acme Careers <careers@acme.com>",
      subject: "Update",
      messageId: "estavel@acme.com",
      body: "we have received your application",
    });

    await importMail(dir, { candidateId });
    const second = await importMail(dir, { candidateId });

    expect(second).toMatchObject({ files: 1, parsed: 0, duplicates: 1 });
    const rows = await db.select().from(mailMessage);
    expect(rows).toHaveLength(1);
  });

  it("dedupe pelo caminho do arquivo quando não há Message-ID", async () => {
    // Export feito à mão pelo cliente de e-mail costuma perder o Message-ID.
    // Sem o fallback, cada reimportação duplicaria a mesma mensagem.
    await writeEml("sem-id.eml", {
      from: "careers@acme.com",
      messageId: null,
      body: "we have received your application",
    });

    await importMail(dir, { candidateId });
    const second = await importMail(dir, { candidateId });

    expect(second.duplicates).toBe(1);
  });

  it("mas o mesmo conteúdo em outro arquivo, sem Message-ID, entra de novo", async () => {
    // Consequência honesta do fallback: sem identidade na mensagem, o arquivo é
    // a única identidade disponível. Documentado aqui para não virar surpresa.
    await writeEml("copia-1.eml", { from: "a@acme.com", messageId: null, body: "oi" });
    await writeEml("copia-2.eml", { from: "a@acme.com", messageId: null, body: "oi" });

    await expect(importMail(dir, { candidateId })).resolves.toMatchObject({
      parsed: 2,
      duplicates: 0,
    });
  });
});

/* -------------------------------------------------------- alertas de vagas */

describe("alertas de vaga viram vagas", () => {
  it("cria as vagas do alerta e registra a contagem na mensagem", async () => {
    await writeEml("alerta.eml", {
      from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
      subject: "4 novas vagas",
      contentType: "text/html",
      body: alertHtml(),
    });

    const result = await importMail(dir, { candidateId });

    expect(result.byKind).toMatchObject({ job_alert: 1 });
    expect(result.jobsCreated).toBe(2);
    const jobs = await db.select().from(job);
    expect(jobs.map((j) => j.title).sort()).toEqual([
      "Senior AI Solutions Architect",
      "Staff Platform Engineer",
    ]);
    // Ponteiro, não vaga completa: o alerta não traz descrição, e é por isso
    // que a Trava 2 do ADR 0008 proíbe seguir o link automaticamente.
    expect(jobs[0]?.descriptionText).toBeNull();
    const [message] = await db.select().from(mailMessage);
    expect(message?.extractedJobs).toBe(2);
  });

  it("cria a fonte manual do alerta uma única vez, desabilitada", async () => {
    // Fonte de alerta não pode ser varrida por `jobs sync`: não há API atrás
    // dela, só e-mail que já chegou.
    await writeEml("a1.eml", {
      from: "jobalerts-noreply@linkedin.com",
      contentType: "text/html",
      body: alertHtml(),
    });
    await writeEml("a2.eml", {
      from: "jobalerts-noreply@linkedin.com",
      contentType: "text/html",
      body: alertHtml("Outro Cargo Totalmente Diferente"),
    });

    await importMail(dir, { candidateId });

    const sources = await db
      .select()
      .from(source)
      .where(eq(source.id, "manual:linkedin-alert"));
    expect(sources).toHaveLength(1);
    expect(sources[0]?.enabled).toBe(false);
  });

  it("dry-run não escreve nada, nem vaga nem mensagem", async () => {
    // O dry-run é o que permite o usuário ler antes de deixar tocar o banco.
    await writeEml("alerta.eml", {
      from: "jobalerts-noreply@linkedin.com",
      contentType: "text/html",
      body: alertHtml(),
    });

    const result = await importMail(dir, { candidateId, dryRun: true });

    expect(result).toMatchObject({ parsed: 1, jobsCreated: 0 });
    await expect(db.select().from(job)).resolves.toHaveLength(0);
    await expect(db.select().from(mailMessage)).resolves.toHaveLength(0);
  });

  it("reimportar o mesmo alerta reconhece a vaga como inalterada", async () => {
    await writeEml("a1.eml", {
      from: "jobalerts-noreply@linkedin.com",
      messageId: "alerta-1@linkedin.com",
      contentType: "text/html",
      body: alertHtml(),
    });
    await importMail(dir, { candidateId });

    await writeEml("a2.eml", {
      from: "jobalerts-noreply@linkedin.com",
      messageId: "alerta-2@linkedin.com",
      contentType: "text/html",
      body: alertHtml(),
    });
    const second = await importMail(dir, { candidateId });

    expect(second).toMatchObject({ jobsCreated: 0, jobsUnchanged: 2 });
    await expect(db.select().from(job)).resolves.toHaveLength(2);
  });

  it("o mesmo cargo com outra grafia conta como alteração, não como vaga nova", async () => {
    // A impressão digital normaliza caixa e pontuação de propósito: senão a
    // mesma vaga entraria duas vezes só porque o template mudou de estilo.
    await writeEml("a1.eml", {
      from: "jobalerts-noreply@linkedin.com",
      messageId: "alerta-1@linkedin.com",
      contentType: "text/html",
      body: alertHtml(),
    });
    await importMail(dir, { candidateId });

    await writeEml("a2.eml", {
      from: "jobalerts-noreply@linkedin.com",
      messageId: "alerta-2@linkedin.com",
      contentType: "text/html",
      body: alertHtml("SENIOR AI SOLUTIONS ARCHITECT"),
    });
    const second = await importMail(dir, { candidateId });

    expect(second.jobsChanged).toBe(1);
    expect(second.jobsCreated).toBe(0);
  });

  it("uma vaga fechada volta a abrir quando o alerta a traz de novo", async () => {
    // Regra 3: vaga que some é fechada, nunca deletada — e um 404 passageiro
    // não pode sumir com ela para sempre.
    await writeEml("a1.eml", {
      from: "jobalerts-noreply@linkedin.com",
      messageId: "alerta-1@linkedin.com",
      contentType: "text/html",
      body: alertHtml(),
    });
    await importMail(dir, { candidateId });
    await db.update(job).set({ closedAt: new Date().toISOString() });

    await writeEml("a2.eml", {
      from: "jobalerts-noreply@linkedin.com",
      messageId: "alerta-2@linkedin.com",
      contentType: "text/html",
      body: alertHtml(),
    });
    const second = await importMail(dir, { candidateId });

    expect(second.jobsReopened).toBe(2);
    const jobs = await db.select().from(job);
    expect(jobs.every((j) => j.closedAt === null)).toBe(true);
  });

  it("carrega o aviso de template quebrado com o nome do arquivo", async () => {
    // Sem o prefixo do arquivo o usuário recebe "o template pode ter mudado" e
    // não sabe qual dos 40 e-mails da pasta produziu isso.
    await writeEml("suspeito.eml", {
      from: "jobalerts-noreply@linkedin.com",
      subject: "job alert",
      contentType: "text/html",
      body: '<a href="https://www.linkedin.com/jobs/view/999">View job</a>',
    });

    const result = await importMail(dir, { candidateId });

    expect(result.warnings.join(" ")).toContain("suspeito.eml");
    expect(result.warnings.join(" ")).toContain("template");
    expect(result.jobsCreated).toBe(0);
  });
});

/* --------------------------------------------------------------- sugestões */

describe("e-mail de ATS vira sugestão, nunca mutação", () => {
  it("casa a rejeição com a candidatura viva e NÃO mexe no funil", async () => {
    const jobId = await applyToAcme();
    await writeEml("rejeicao.eml", {
      from: "Acme Careers <careers@acme.com>",
      subject: "Update on your application",
      body: "Unfortunately, we have decided to move forward with other candidates.",
    });

    const result = await importMail(dir, { candidateId });

    expect(result).toMatchObject({ suggestions: 1, unmatched: 0 });
    const [suggestion] = await db.select().from(mailSuggestion);
    expect(suggestion).toMatchObject({
      suggestedStatus: "rejected",
      jobId,
      status: "pending",
    });
    expect(suggestion?.rationale).toContain('casado com "Acme"');

    // O ponto do arquivo inteiro: a candidatura continua onde o usuário a
    // deixou. Só ele move o funil.
    const [tracked] = await db.select().from(application);
    expect(tracked?.status).toBe("applied");
  });

  it("corta a confiança pela metade quando não achou candidatura", async () => {
    // Sem casamento a sugestão é um palpite sobre uma empresa que talvez nem
    // esteja no funil. Mostrar a mesma confiança dos casos casados treinaria o
    // usuário a aceitar no automático.
    await writeEml("orfa.eml", {
      from: "Outra Empresa <careers@outraempresa.com>",
      subject: "Update",
      body: "we have decided to move forward with other candidates",
    });

    const result = await importMail(dir, { candidateId });

    expect(result).toMatchObject({ suggestions: 1, unmatched: 1 });
    const [suggestion] = await db.select().from(mailSuggestion);
    expect(suggestion?.applicationId).toBeNull();
    expect(suggestion?.confidence).toBeCloseTo(0.45, 5);
    expect(suggestion?.rationale).toContain("tentei: Outra Empresa");
  });

  it("não cita tentativa nenhuma quando o remetente não identifica empresa", async () => {
    await writeEml("anonima.eml", {
      from: "<noreply@gmail.com>",
      subject: "Atualização",
      body: "infelizmente, não seguiremos com outros candidatos",
    });

    const result = await importMail(dir, { candidateId });

    const [suggestion] = await db.select().from(mailSuggestion);
    expect(result.unmatched).toBe(1);
    expect(suggestion?.rationale).toContain("nenhuma candidatura ativa correspondente");
    expect(suggestion?.rationale).not.toContain("tentei");
    const [message] = await db.select().from(mailMessage);
    expect(message?.companyGuess).toBeNull();
  });

  it("ignora candidatura já rejeitada ao procurar o casamento", async () => {
    // Rejeitar de novo o que já está rejeitado só produziria ruído a cada
    // reimportação, e sugestão repetida é o que faz o usuário parar de ler.
    const jobId = await applyToAcme();
    await setApplicationStatus(candidateId, jobId, "rejected");

    await writeEml("segunda.eml", {
      from: "Acme Careers <careers@acme.com>",
      body: "we have decided to move forward with other candidates",
    });

    const result = await importMail(dir, { candidateId });

    expect(result.unmatched).toBe(1);
    const [suggestion] = await db.select().from(mailSuggestion);
    expect(suggestion?.applicationId).toBeNull();
  });

  it("descarta um nome de remetente curto demais para identificar empresa", async () => {
    // Duas letras casariam com quase qualquer nome de empresa por substring.
    // "AB" dentro de "Nubank" seria um falso positivo caro.
    await applyToAcme("Nubank");
    await writeEml("curta.eml", {
      from: "AB <ab@gmail.com>",
      subject: "Atualização",
      body: "infelizmente, não seguiremos com outros candidatos",
    });

    const result = await importMail(dir, { candidateId });

    expect(result.unmatched).toBe(1);
  });

  it("casa quando o nome do e-mail é mais longo que o da empresa cadastrada", async () => {
    // "Acme Corporation" no remetente contra "Acme" no banco é o caso comum:
    // o ATS usa a razão social, o usuário cadastrou o nome curto.
    await applyToAcme("Acme");
    await writeEml("longa.eml", {
      from: "Acme Corporation <careers@acmecorporation.com>",
      body: "we have received your application",
    });

    const result = await importMail(dir, { candidateId });

    expect(result.unmatched).toBe(0);
    const [suggestion] = await db.select().from(mailSuggestion);
    expect(suggestion?.rationale).toContain('via "Acme Corporation"');
  });

  it("descasca 'via Greenhouse' do nome do remetente", async () => {
    // O domínio do ATS identifica a ferramenta, nunca o empregador — quem diz
    // a empresa é o display name.
    await applyToAcme();
    await writeEml("greenhouse.eml", {
      from: "Acme via Greenhouse <no-reply@greenhouse.io>",
      body: "please complete the technical assessment",
    });

    const result = await importMail(dir, { candidateId });

    expect(result.unmatched).toBe(0);
    const [message] = await db.select().from(mailMessage);
    expect(message).toMatchObject({ companyGuess: "Acme", provider: "greenhouse" });
  });

  it("descasca 'Recruiting at', sufixos de time e parênteses", async () => {
    await applyToAcme();
    await writeEml("rh.eml", {
      from: "Recruiting at Acme (Talent) <talent@acme.com>",
      body: "we are pleased to offer you the position",
    });

    const result = await importMail(dir, { candidateId });

    expect(result.unmatched).toBe(0);
    const [message] = await db.select().from(mailMessage);
    expect(message?.companyGuess).toBe("Acme");
  });

  it("descarta o display name quando ele é só 'no-reply' e usa o domínio", async () => {
    await applyToAcme();
    await writeEml("noreply.eml", {
      from: '"no-reply" <no-reply@acme.com>',
      body: "we have received your application",
    });

    const [message] = await (async () => {
      await importMail(dir, { candidateId });
      return db.select().from(mailMessage);
    })();
    // "no-reply" não é empresa; "acme.com" é.
    expect(message?.companyGuess).toBe("Acme");
  });

  it("não deduz empresa de provedor gratuito de e-mail", async () => {
    // "Gmail" como palpite de empresa entupiria o casamento com lixo.
    await writeEml("pessoal.eml", {
      from: "Fulano <fulano@hotmail.com>",
      subject: "Oi",
      body: "we have received your application",
    });

    await importMail(dir, { candidateId });

    const [message] = await db.select().from(mailMessage);
    expect(message?.companyGuess).toBe("Fulano");
  });

  it("usa o assunto como último recurso para identificar a empresa", async () => {
    await applyToAcme("Nubank");
    await writeEml("assunto.eml", {
      from: "<jobs@ashbyhq.com>",
      subject: "Your application to Nubank",
      body: "thank you for applying",
    });

    const result = await importMail(dir, { candidateId });

    expect(result.unmatched).toBe(0);
    const [message] = await db.select().from(mailMessage);
    expect(message?.companyGuess).toBe("Nubank");
  });

  it("também lê o padrão 'Empresa - Cargo' do assunto", async () => {
    await applyToAcme("Nubank");
    await writeEml("traco.eml", {
      from: "<jobs@ashbyhq.com>",
      subject: "Nubank - Software Architect",
      body: "let's schedule your interview",
    });

    const result = await importMail(dir, { candidateId });

    expect(result.unmatched).toBe(0);
    const [suggestion] = await db.select().from(mailSuggestion);
    expect(suggestion?.suggestedStatus).toBe("interviewing");
  });

  it("mensagem sem classificação conhecida não gera sugestão nenhuma", async () => {
    // O viés declarado do classificador: na dúvida, `unknown`. Uma sugestão
    // errada custa mais que uma classificação faltando.
    await writeEml("newsletter.eml", {
      from: "news@random.com",
      subject: "Newsletter semanal",
      body: "here is our weekly digest",
    });

    const result = await importMail(dir, { candidateId });

    expect(result.byKind).toMatchObject({ unknown: 1 });
    expect(result.suggestions).toBe(0);
    await expect(db.select().from(mailSuggestion)).resolves.toHaveLength(0);
  });

  it("aceita mensagem sem corpo legível, gravando texto vazio", async () => {
    // Parte html vazia acontece com e-mail gerado por template quebrado. O
    // corpo tem de virar string vazia e não `null`: `bodyText.slice()` logo
    // abaixo estouraria e derrubaria a importação do lote inteiro.
    await writeEml("vazia.eml", {
      from: "careers@acme.com",
      subject: "Sem conteúdo",
      contentType: "text/html",
      body: "",
    });

    const result = await importMail(dir, { candidateId });

    expect(result.parsed).toBe(1);
    const [message] = await db.select().from(mailMessage);
    expect(message?.bodyText).toBe("");
    expect(message?.kind).toBe("unknown");
  });

  it("guarda o corpo truncado, para o banco não virar arquivo de e-mail", async () => {
    await writeEml("gigante.eml", {
      from: "careers@acme.com",
      body: `we have received your application ${"x".repeat(40_000)}`,
    });

    await importMail(dir, { candidateId });

    const [message] = await db.select().from(mailMessage);
    expect(message?.bodyText?.length).toBe(20_000);
  });
});

/* ------------------------------------------------------------- listagem --- */

describe("listSuggestions", () => {
  it("devolve só as pendentes, mais recentes primeiro, com o contexto do e-mail", async () => {
    await applyToAcme();
    await writeEml("antiga.eml", {
      from: "Acme Careers <careers@acme.com>",
      subject: "Recebido",
      date: "Mon, 10 Aug 2026 09:00:00 -0300",
      body: "we have received your application",
    });
    await writeEml("nova.eml", {
      from: "Acme Careers <careers@acme.com>",
      subject: "Entrevista",
      date: "Mon, 17 Aug 2026 09:00:00 -0300",
      body: "let's schedule your interview",
    });
    await importMail(dir, { candidateId });

    const pending = await listSuggestions();
    expect(pending.map((s) => s.subject)).toEqual(["Entrevista", "Recebido"]);
    expect(pending[0]).toMatchObject({
      status: "pending",
      suggestedStatus: "interviewing",
      kind: "ats_interview",
      fromAddress: "careers@acme.com",
    });

    await decideSuggestion(candidateId, pending[1]!.id, "dismissed");
    // Decidida some da fila: a lista é uma caixa de entrada, não um histórico.
    await expect(listSuggestions()).resolves.toHaveLength(1);
  });
});

/* ------------------------------------------------------------- decisões --- */

describe("decideSuggestion", () => {
  async function pendingSuggestion(): Promise<number> {
    await applyToAcme();
    await writeEml("triagem.eml", {
      from: "Acme Careers <careers@acme.com>",
      body: "please complete the technical assessment",
    });
    await importMail(dir, { candidateId });
    const [suggestion] = await db.select().from(mailSuggestion);
    return suggestion!.id;
  }

  it("descartar fecha a sugestão sem tocar na candidatura", async () => {
    const id = await pendingSuggestion();

    await expect(decideSuggestion(candidateId, id, "dismissed")).resolves.toEqual({
      jobId: null,
      status: null,
    });

    const [suggestion] = await db.select().from(mailSuggestion);
    expect(suggestion).toMatchObject({ status: "dismissed" });
    expect(suggestion?.decidedAt).toBeTruthy();
    const [tracked] = await db.select().from(application);
    expect(tracked?.status).toBe("applied");
  });

  it("descartar duas vezes é inofensivo", async () => {
    // A UI pode reenviar o clique; a decisão precisa ser idempotente para o
    // usuário não ver erro por algo que já está do jeito que ele quis.
    const id = await pendingSuggestion();

    await decideSuggestion(candidateId, id, "dismissed");
    await expect(decideSuggestion(candidateId, id, "dismissed")).resolves.toEqual({
      jobId: null,
      status: null,
    });
  });

  it("recusa trocar uma decisão já tomada", async () => {
    // Reverter em silêncio apagaria a decisão anterior do usuário — o único
    // dado que ADR 0005 protege.
    const id = await pendingSuggestion();
    await decideSuggestion(candidateId, id, "dismissed");

    await expect(decideSuggestion(candidateId, id, "accepted")).rejects.toThrow(
      "já foi decidida como dismissed",
    );
  });

  it("estoura quando a sugestão não existe", async () => {
    await expect(decideSuggestion(candidateId, 4242, "accepted")).rejects.toThrow(
      "Sugestão 4242 não existe",
    );
  });

  it("não deixa outro candidato decidir uma sugestão que não é dele", async () => {
    // A sugestão aponta para uma candidatura; aceitar por procuração moveria o
    // funil de outra pessoa.
    const id = await pendingSuggestion();
    const intruso = await ensureCandidate({ slug: "intruso", name: "Intruso" });

    await expect(decideSuggestion(intruso, id, "accepted")).rejects.toThrow(
      "pertence a outro candidato",
    );
    const [tracked] = await db.select().from(application);
    expect(tracked?.status).toBe("applied");
  });
});
