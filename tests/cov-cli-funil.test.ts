/**
 * Suíte: os comandos de `src/cli.ts` que mexem no **funil** — `track`,
 * `mail accept`, `mail dismiss` — mais o `db prune`, que apaga linha.
 *
 * ## Por que estes, e não a CLI inteira
 *
 * O item E-08 do backlog fecha o corte assim: cobrir o que **escreve**, deixar
 * de fora o que só imprime. A razão não é preguiça de asserir texto; é que
 * efeito colateral errado não volta atrás, e a regra 2 do CLAUDE.md diz que a
 * candidatura é o único dado que um `jobs sync` não reconstrói. Um relatório
 * mal formatado se conserta na próxima execução; uma transição gravada no
 * candidato errado, não.
 *
 * ## O que estes casos procuram, especificamente
 *
 * Não que `program.command("track").action(fn)` chame `fn` — isso testaria o
 * Commander. Procuram a faixa entre o argumento cru que a pessoa digitou e a
 * chamada da função de domínio: qual valor cada flag vira, qual default vale
 * quando a flag não vem, o que acontece com entrada inválida, e se o comando
 * sinaliza fracasso pelo `process.exitCode`. É exatamente onde `cli.ts` tem
 * lógica própria — e é onde ele hoje tem zero cobertura.
 *
 * Fronteira DENTRO: análise de argumento, defaults, validação, persistência.
 * Fronteira FORA: rede (nenhum caso aqui abre socket) e formatação de tabela.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCandidateFromProfile } from "../src/core/candidate.ts";
import {
  application,
  applicationEvent,
  job,
  mailMessage,
  mailSuggestion,
  source,
} from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

let bootDaCli: Awaited<ReturnType<typeof carregarCli>>;

beforeAll(async () => {
  bootDaCli = await carregarCli();
});

beforeEach(async () => {
  await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

/** Candidato "default", derivado do `profile.yaml` real — como no uso normal. */
async function semearCandidato(): Promise<number> {
  return syncCandidateFromProfile();
}

/** Uma vaga mínima, do jeito que o ingestor a deixaria. */
async function semearVaga(opts: { id: string; fechadaEm?: string } = { id: "v1" }): Promise<number> {
  const db = banco();
  await db
    .insert(source)
    .values({ id: "manual:teste", kind: "manual", handle: "teste", label: "Teste" })
    .onConflictDoNothing();
  const [row] = await db
    .insert(job)
    .values({
      fingerprint: `fp-${opts.id}`,
      contentHash: `hash-${opts.id}`,
      sourceId: "manual:teste",
      externalId: opts.id,
      companyName: "Acme",
      title: "Senior AI Software Architect",
      url: `https://exemplo.test/${opts.id}`,
      closedAt: opts.fechadaEm ?? null,
      raw: {},
    })
    .returning({ id: job.id });
  return row!.id;
}

describe("carga do módulo — `jho` sem subcomando", () => {
  /**
   * O `catch` da última linha de `cli.ts` é o único trecho que nenhum reparse
   * alcança: a partir da carga é o teste, e não o módulo, quem chama
   * `parseAsync`. Cobri-lo custa uma carga com `process.argv = ["node","jho"]`,
   * que é o que uma pessoa digita ao errar o comando — e o contrato é que isso
   * não sai com 0. Um script de operação que encadeia `jho ... && próximo`
   * depende disso para não continuar em cima de um erro.
   */
  it("imprime a ajuda e termina com código diferente de zero", () => {
    expect(bootDaCli.code).toBe(1);
  });
});

describe("jho track <id> <status>", () => {
  it("cria a candidatura e registra o evento da transição", async () => {
    const candidatoId = await semearCandidato();
    const vagaId = await semearVaga();

    const r = await rodar("track", String(vagaId), "shortlisted");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain(`job ${vagaId} → shortlisted`);

    const [linha] = await banco()
      .select()
      .from(application)
      .where(eq(application.jobId, vagaId));
    expect(linha?.status).toBe("shortlisted");
    expect(linha?.candidateId).toBe(candidatoId);

    // O evento é o que torna a métrica de funil reconstruível; sem ele a
    // transição existiria só como estado atual, e o histórico morre.
    const eventos = await banco()
      .select()
      .from(applicationEvent)
      .where(eq(applicationEvent.applicationId, linha!.id));
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.fromStatus).toBeNull();
    expect(eventos[0]?.toStatus).toBe("shortlisted");
  });

  /**
   * A validação de status roda ANTES de `withDb`, e é por isso que este caso
   * não precisa nem de candidato semeado. A ordem importa: um comando que
   * abrisse o banco, resolvesse o candidato e só então recusasse a entrada
   * gastaria trabalho para nada e, pior, criaria a chance de um efeito parcial.
   */
  it("recusa status desconhecido com código 1, sem tocar no banco", async () => {
    const vagaId = await semearVaga();

    const r = await rodar("track", String(vagaId), "entrevistado");

    expect(r.code).toBe(1);
    expect(r.err).toContain('Unknown status "entrevistado"');
    // A mensagem lista o vocabulário aceito. Sem isso a pessoa fica adivinhando
    // qual das dez palavras o sistema usa para o mesmo conceito.
    expect(r.err).toContain("shortlisted");
    expect(await banco().select().from(application)).toHaveLength(0);
  });

  it("leva `--note` para o detalhe do evento, não para a linha da candidatura", async () => {
    await semearCandidato();
    const vagaId = await semearVaga();

    await rodar("track", String(vagaId), "shortlisted", "--note", "indicado pelo Rafael");

    const [linha] = await banco().select().from(application);
    const [evento] = await banco().select().from(applicationEvent);
    expect(evento?.detail).toBe("indicado pelo Rafael");
    // `notes` da candidatura continua vazio: a nota descreve a TRANSIÇÃO, e
    // sobrescrever a nota do registro perderia o que foi escrito antes.
    expect(linha?.notes).toBeNull();
  });

  it("aceita `-n` como forma curta de `--note`", async () => {
    await semearCandidato();
    const vagaId = await semearVaga();

    await rodar("track", String(vagaId), "shortlisted", "-n", "forma curta");

    const [evento] = await banco().select().from(applicationEvent);
    expect(evento?.detail).toBe("forma curta");
  });

  /**
   * CARACTERIZAÇÃO DE DEFEITO — `--channel` é aceito e descartado.
   *
   * `application.channel` existe no schema, `/pipeline` renderiza a coluna, o
   * CLAUDE.md documenta `jho track <id> applied --channel referral` e o próprio
   * `jho prep` imprime essa linha como próximo passo. Mas o handler chama
   * `setApplicationStatus(candidateId, jobId, status, opts.note)` — cuja
   * assinatura tem quatro parâmetros e nenhum deles é canal. A opção some sem
   * aviso.
   *
   * O caso trava o comportamento de HOJE de propósito. Quando alguém corrigir,
   * é este teste que vai falhar e apontar para a correção — que é o serviço que
   * um teste de caracterização presta.
   */
  it("aceita `--channel` mas não o grava — coluna continua nula (defeito conhecido)", async () => {
    await semearCandidato();
    const vagaId = await semearVaga();

    const r = await rodar("track", String(vagaId), "shortlisted", "--channel", "referral");

    expect(r.code).toBeUndefined();
    const [linha] = await banco().select().from(application);
    expect(linha?.channel).toBeNull();
  });

  it("propaga o erro quando não há candidato cadastrado", async () => {
    const vagaId = await semearVaga();

    const r = await rodar("track", String(vagaId), "shortlisted");

    // Sem `jho db seed` não existe candidato "default" e o comando não tem em
    // nome de quem gravar. A mensagem diz o comando que resolve — orientação
    // que vale mais que o stack trace.
    expect((r.erro as Error).message).toContain("jho db seed");
  });

  it("recusa transição ilegal em vez de sobrescrever o estado", async () => {
    await semearCandidato();
    const vagaId = await semearVaga();
    await rodar("track", String(vagaId), "rejected");

    const r = await rodar("track", String(vagaId), "offer");

    expect((r.erro as Error).message).toContain("rejected -> offer");
    const [linha] = await banco().select().from(application);
    expect(linha?.status).toBe("rejected");
  });

  it("carimba `appliedAt` quando — e só quando — o destino é `applied`", async () => {
    await semearCandidato();
    const vagaId = await semearVaga();

    await rodar("track", String(vagaId), "shortlisted");
    const [antes] = await banco().select().from(application);
    expect(antes?.appliedAt).toBeNull();

    await rodar("track", String(vagaId), "preparing");
    await rodar("track", String(vagaId), "applied");
    const [depois] = await banco().select().from(application);
    expect(depois?.appliedAt).not.toBeNull();
  });
});

describe("jho mail accept | dismiss", () => {
  /** Uma sugestão pendente, ligada a uma candidatura existente do candidato. */
  async function semearSugestao(
    candidatoId: number,
    vagaId: number,
    opts: { comCandidatura: boolean; sugere?: string },
  ): Promise<number> {
    const db = banco();
    const [mail] = await db
      .insert(mailMessage)
      .values({
        messageId: `<m-${vagaId}@teste>`,
        fromAddress: "no-reply@acme.test",
        subject: "Update on your application",
        kind: "ats_screening",
      })
      .returning({ id: mailMessage.id });

    let candidaturaId: number | null = null;
    if (opts.comCandidatura) {
      const [app] = await db
        .insert(application)
        .values({ candidateId: candidatoId, jobId: vagaId, status: "applied" })
        .returning({ id: application.id });
      candidaturaId = app!.id;
    }

    const [sug] = await db
      .insert(mailSuggestion)
      .values({
        mailId: mail!.id,
        applicationId: candidaturaId,
        jobId: opts.comCandidatura ? vagaId : null,
        suggestedStatus: opts.sugere ?? "screening",
        rationale: "convite para triagem",
        confidence: 0.9,
      })
      .returning({ id: mailSuggestion.id });
    return sug!.id;
  }

  it("aceitar aplica a mudança de funil e marca a sugestão como decidida", async () => {
    const candidatoId = await semearCandidato();
    const vagaId = await semearVaga();
    const sugestaoId = await semearSugestao(candidatoId, vagaId, { comCandidatura: true });

    const r = await rodar("mail", "accept", String(sugestaoId));

    expect(r.code).toBeUndefined();
    expect(r.out).toContain(`vaga ${vagaId} → screening`);

    const [linha] = await banco().select().from(application);
    expect(linha?.status).toBe("screening");
    const [sug] = await banco().select().from(mailSuggestion);
    expect(sug?.status).toBe("accepted");
    expect(sug?.decidedAt).not.toBeNull();
  });

  /**
   * A regra 2 do CLAUDE.md em uma linha: e-mail SUGERE, o usuário decide.
   * Descartar tem de deixar o funil exatamente como estava — se `dismiss`
   * mexesse na candidatura, a ingestão passaria a escrever decisão.
   */
  it("descartar marca a sugestão e não encosta na candidatura", async () => {
    const candidatoId = await semearCandidato();
    const vagaId = await semearVaga();
    const sugestaoId = await semearSugestao(candidatoId, vagaId, { comCandidatura: true });

    const r = await rodar("mail", "dismiss", String(sugestaoId));

    expect(r.code).toBeUndefined();
    expect(r.out).toContain(`sugestão ${sugestaoId} descartada`);
    const [linha] = await banco().select().from(application);
    expect(linha?.status).toBe("applied");
    const [sug] = await banco().select().from(mailSuggestion);
    expect(sug?.status).toBe("dismissed");
  });

  /**
   * O handler de `accept` tem uma guarda própria — `if (!jobId || !status)
   * throw` — para o caso de a sugestão ser aceita sem candidatura casada. É
   * lógica de `cli.ts`, não do domínio, e por isso vale um caso: sem ela o
   * comando imprimiria "vaga null → null" e diria que deu certo.
   */
  it("falha ao aceitar sugestão sem candidatura casada", async () => {
    const candidatoId = await semearCandidato();
    const vagaId = await semearVaga();
    const sugestaoId = await semearSugestao(candidatoId, vagaId, { comCandidatura: false });

    const r = await rodar("mail", "accept", String(sugestaoId));

    expect(r.erro).toBeInstanceOf(Error);
    expect((r.erro as Error).message).toMatch(/candidatura/i);
  });

  it("converte o id de texto para número — `Number(id)` é a fronteira", async () => {
    await semearCandidato();
    await semearVaga();

    const r = await rodar("mail", "dismiss", "999");

    // Id inexistente vira erro de domínio, e não uma comparação de string com
    // inteiro que nunca casaria e silenciosamente não faria nada.
    expect((r.erro as Error).message).toContain("999");
  });
});

describe("jho db prune", () => {
  it("usa 90 dias como padrão e preserva o que fechou ontem", async () => {
    const ontem = new Date(Date.now() - 86_400_000).toISOString();
    await semearVaga({ id: "recente", fechadaEm: ontem });

    const r = await rodar("db", "prune");

    expect(r.out).toContain("pruned 0 closed job(s)");
    expect(await banco().select().from(job)).toHaveLength(1);
  });

  it("`--days` chega ao domínio como número, não como a string do argv", async () => {
    const dozeDias = new Date(Date.now() - 12 * 86_400_000).toISOString();
    await semearVaga({ id: "velha", fechadaEm: dozeDias });

    const r = await rodar("db", "prune", "--days", "7");

    expect(r.out).toContain("pruned 1 closed job(s)");
    expect(await banco().select().from(job)).toHaveLength(0);
  });

  it("nunca apaga vaga com candidatura, por mais antiga que esteja", async () => {
    const candidatoId = await semearCandidato();
    const antiga = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const vagaId = await semearVaga({ id: "antiga", fechadaEm: antiga });
    await banco()
      .insert(application)
      .values({ candidateId: candidatoId, jobId: vagaId, status: "applied" });

    const r = await rodar("db", "prune", "--days", "1");

    // Regra 3 do CLAUDE.md pelo avesso: apagar quebraria a candidatura por
    // chave estrangeira, e a candidatura é o dado irrecuperável.
    expect(r.out).toContain("pruned 0 closed job(s)");
    expect(await banco().select().from(job)).toHaveLength(1);
  });
});
