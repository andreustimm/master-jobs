import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  analyseGap,
  ensureCandidate,
  getCandidate,
  getCandidateById,
  restoreDocument,
  saveDocument,
} from "../src/core/candidate.ts";
import type { DB } from "../src/core/db/client.ts";
import { company, job, jobScore, source } from "../src/core/db/schema.ts";
import { SCORER_VERSION } from "../src/core/scoring/score.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * A análise de lacuna responde a pergunta que nada mais aqui responde: quais
 * palavras as vagas usam que o meu currículo nunca diz?
 *
 * > Invariante: este módulo NUNCA edita o currículo. Ele relata. Ferramenta que
 * > reescreve as palavras do candidato para casar com a vaga é como se acaba
 * > afirmando experiência que não se tem — regra 7 do CLAUDE.md.
 *
 * Os termos usados abaixo saem do `profile.yaml` real, e foram escolhidos por
 * não serem subcadeia de nenhum outro termo do perfil: um casamento acidental
 * inverteria "faltante" e "confirmado" sem quebrar teste nenhum.
 */
const TERMO_CONFIRMADO = "kubernetes"; // no currículo E nas vagas
const TERMO_FALTANTE = "guardrails"; // só nas vagas — a lista acionável
const TERMO_OCIOSO = "laravel"; // só no currículo — possível peso morto

let db: DB;
let candidatoId: number;
let sequencia = 0;

beforeEach(async () => {
  sequencia = 0;
  db = await useTestDb();
  candidatoId = await ensureCandidate({ name: "Candidato da Lacuna" });
  await db.insert(source).values({
    id: "manual:lacuna",
    kind: "manual",
    handle: "lacuna",
    label: "Lacuna",
  });
});

afterEach(() => {
  releaseTestDb();
});

async function criarVagaPontuada(input: {
  descricao: string;
  fit: number;
  fechada?: boolean;
  paraCandidato?: number;
}): Promise<number> {
  sequencia += 1;
  const [empresa] = await db
    .insert(company)
    .values({ slug: `empresa-${sequencia}`, name: `Empresa ${sequencia}` })
    .returning({ id: company.id });
  const [vaga] = await db
    .insert(job)
    .values({
      sourceId: "manual:lacuna",
      companyId: empresa!.id,
      companyName: `Empresa ${sequencia}`,
      externalId: `vaga-${sequencia}`,
      // Título deliberadamente neutro: ele entra no corpus junto com a
      // descrição, então qualquer termo do perfil ali contaminaria a medição.
      title: `Oportunidade tecnica ${sequencia}`,
      descriptionText: input.descricao,
      url: `https://exemplo.test/vaga-${sequencia}`,
      fingerprint: `fp-lacuna-${sequencia}`,
      contentHash: `ch-lacuna-${sequencia}`,
      raw: "{}",
      closedAt: input.fechada ? "2026-08-01T00:00:00.000Z" : null,
    })
    .returning({ id: job.id });

  await db.insert(jobScore).values({
    candidateId: input.paraCandidato ?? candidatoId,
    jobId: vaga!.id,
    fit: input.fit,
    titleScore: 0,
    keywordScore: 0,
    seniorityScore: 0,
    geoScore: 0,
    compScore: 0,
    freshnessScore: 0,
    benefitScore: 0,
    penalty: 0,
    cluster: "architect",
    matchedKeywords: [],
    missingKeywords: [],
    detectedBenefits: [],
    ageDays: null,
    reasons: [],
    blockers: [],
    scorerVersion: SCORER_VERSION,
    profileHash: "teste",
  });
  return vaga!.id;
}

const salvarCv = (conteudo: string) =>
  saveDocument({ candidateId: candidatoId, label: "CV", content: conteudo });

describe("analyseGap: o mercado contra o currículo", () => {
  it("devolve null quando não há currículo para comparar", async () => {
    // Sem currículo a resposta correta é "não sei", não "faltam todos os
    // termos" — que é o que uma lista vazia produziria na tela.
    await criarVagaPontuada({ descricao: `Precisa de ${TERMO_FALTANTE}`, fit: 80 });
    expect(await analyseGap({ candidateId: candidatoId })).toBeNull();
  });

  it("separa faltante, confirmado e ocioso", async () => {
    await salvarCv(
      `Operei clusters ${TERMO_CONFIRMADO} em producao e mantive sistemas em ${TERMO_OCIOSO}.`,
    );
    for (let i = 0; i < 3; i++) {
      await criarVagaPontuada({
        descricao: `Vaga que pede ${TERMO_CONFIRMADO} e ${TERMO_FALTANTE} na plataforma.`,
        fit: 80,
      });
    }

    const relatorio = await analyseGap({ candidateId: candidatoId });
    expect(relatorio?.jobsAnalysed).toBe(3);
    expect(relatorio?.minFit).toBe(60);
    expect(relatorio?.cvLength).toBeGreaterThan(0);

    // Faltante: o mercado pede e o currículo não diz. É a única lista sobre a
    // qual vale agir.
    expect(relatorio?.missing.map((t) => t.term)).toEqual([TERMO_FALTANTE]);
    expect(relatorio?.missing[0]).toMatchObject({ inJobs: 3, coverage: 1, inCv: false });

    // Confirmado: o vocabulário que já está funcionando.
    expect(relatorio?.confirmed.map((t) => t.term)).toEqual([TERMO_CONFIRMADO]);
    expect(relatorio?.confirmed[0]?.inCv).toBe(true);

    // Ocioso: está no currículo e quase nenhuma vaga-alvo pede. Não é ordem
    // para remover — é candidato a peso morto, e a decisão é do usuário.
    expect(relatorio?.unused.map((t) => t.term)).toEqual([TERMO_OCIOSO]);
    expect(relatorio?.unused[0]).toMatchObject({ inJobs: 0, coverage: 0 });
  });

  it("ordena a lista faltante por impacto: cobertura vezes peso", async () => {
    // Ordenar só por frequência colocaria um termo onipresente e de baixo
    // valor comercial acima de "ai architect". O produto do peso pela
    // cobertura é o que torna a lista uma fila de trabalho.
    await salvarCv("Currículo sem nenhum dos termos abaixo.");
    // "ai architect" pesa 10; "etl" pesa 3. Ambos em todas as vagas.
    for (let i = 0; i < 2; i++) {
      await criarVagaPontuada({ descricao: "Buscamos ai architect com etl.", fit: 90 });
    }

    const faltantes = (await analyseGap({ candidateId: candidatoId }))?.missing ?? [];
    expect(faltantes.findIndex((t) => t.term === "ai architect")).toBeLessThan(
      faltantes.findIndex((t) => t.term === "etl"),
    );
  });

  it("compara só contra as vagas que realmente dão match", async () => {
    // Comparar contra o acervo inteiro traria o vocabulário de papéis que o
    // candidato não quer — é assim que um currículo se dilui em vez de afiar.
    await salvarCv("Currículo neutro.");
    await criarVagaPontuada({ descricao: `Vaga alvo com ${TERMO_FALTANTE}.`, fit: 80 });
    await criarVagaPontuada({ descricao: "Vaga fora do alvo com wordpress.", fit: 20 });

    const relatorio = await analyseGap({ candidateId: candidatoId });
    expect(relatorio?.jobsAnalysed).toBe(1);
    expect(relatorio?.missing.map((t) => t.term)).toEqual([TERMO_FALTANTE]);
  });

  it("respeita um corte de fit informado", async () => {
    await salvarCv("Currículo neutro.");
    await criarVagaPontuada({ descricao: `Vaga com ${TERMO_FALTANTE}.`, fit: 50 });

    expect((await analyseGap({ candidateId: candidatoId }))?.jobsAnalysed).toBe(0);
    const frouxo = await analyseGap({ candidateId: candidatoId, minFit: 45 });
    expect(frouxo).toMatchObject({ jobsAnalysed: 1, minFit: 45 });
  });

  it("ignora vaga fechada — vocabulário de vaga morta não orienta nada", async () => {
    await salvarCv("Currículo neutro.");
    await criarVagaPontuada({ descricao: `Vaga com ${TERMO_FALTANTE}.`, fit: 90, fechada: true });
    expect((await analyseGap({ candidateId: candidatoId }))?.jobsAnalysed).toBe(0);
  });

  it("usa a pontuação DESTE candidato, não a de outro", async () => {
    // `job_score` é por candidato: ler sem filtrar traria as vagas boas de
    // outra pessoa e produziria conselho de currículo para o perfil errado.
    await salvarCv("Currículo neutro.");
    const outro = await ensureCandidate({ slug: "outro", name: "Outro" });
    await criarVagaPontuada({
      descricao: `Vaga com ${TERMO_FALTANTE}.`,
      fit: 90,
      paraCandidato: outro,
    });

    expect((await analyseGap({ candidateId: candidatoId }))?.jobsAnalysed).toBe(0);
  });

  it("cobertura é zero, não divisão por zero, quando não há corpus", async () => {
    await salvarCv(`Currículo com ${TERMO_CONFIRMADO}.`);
    const relatorio = await analyseGap({ candidateId: candidatoId });

    expect(relatorio?.jobsAnalysed).toBe(0);
    expect(relatorio?.missing).toEqual([]);
    expect(relatorio?.confirmed).toEqual([]);
    // Todo termo do currículo cai em "ocioso" quando não há vaga alguma — e
    // nenhuma cobertura é NaN.
    expect(relatorio?.unused.map((t) => t.term)).toContain(TERMO_CONFIRMADO);
    expect(relatorio?.unused.every((t) => t.coverage === 0)).toBe(true);
  });

  it("limita quantas vagas entram no corpus", async () => {
    await salvarCv("Currículo neutro.");
    for (let i = 0; i < 4; i++) {
      await criarVagaPontuada({ descricao: `Vaga ${i} com ${TERMO_FALTANTE}.`, fit: 80 });
    }
    expect((await analyseGap({ candidateId: candidatoId, limit: 2 }))?.jobsAnalysed).toBe(2);
  });
});

describe("casamento por borda de palavra, não por subcadeia", () => {
  it("não conta um termo grudado dentro de outra palavra", async () => {
    // Subcadeia é o defeito clássico: "go" casando em "golang" e "algorithm"
    // transformaria a análise em ruído. A borda é o que torna a contagem
    // confiável o bastante para orientar uma reescrita de currículo.
    await salvarCv(`Trabalhei com ${TERMO_CONFIRMADO}xyz e nada mais.`);
    await criarVagaPontuada({ descricao: `Vaga pedindo ${TERMO_CONFIRMADO}.`, fit: 80 });

    const relatorio = await analyseGap({ candidateId: candidatoId });
    expect(relatorio?.missing.map((t) => t.term)).toContain(TERMO_CONFIRMADO);
    expect(relatorio?.confirmed).toEqual([]);
  });

  it("aceita pontuação e hífen como borda", async () => {
    // "kubernetes-native" e "(kubernetes)" são grafias reais em descrição de
    // vaga; tratá-las como palavra diferente perderia o casamento.
    await salvarCv(`Rodei (${TERMO_CONFIRMADO}) e ${TERMO_CONFIRMADO}-native.`);
    await criarVagaPontuada({ descricao: `Vaga com ${TERMO_CONFIRMADO}-native.`, fit: 80 });

    expect(
      (await analyseGap({ candidateId: candidatoId }))?.confirmed.map((t) => t.term),
    ).toContain(TERMO_CONFIRMADO);
  });

  it("escapa metacaracteres do termo antes de virar expressão regular", async () => {
    // "next.js" tem um ponto, que numa regex casaria qualquer caractere:
    // "nextxjs" no currículo passaria por evidência de Next.js. É também o
    // motivo de "c++" e "c#" precisarem de tratamento explícito na borda.
    await salvarCv("Escrevi nextxjs por engano no currículo.");
    await criarVagaPontuada({ descricao: "Vaga que exige next.js no front.", fit: 80 });

    const relatorio = await analyseGap({ candidateId: candidatoId });
    expect(relatorio?.missing.map((t) => t.term)).toContain("next.js");
    expect(relatorio?.confirmed.map((t) => t.term)).not.toContain("next.js");
  });

  it("ignora diferença de caixa nos dois lados", async () => {
    await salvarCv(`Operei ${TERMO_CONFIRMADO.toUpperCase()} em produção.`);
    await criarVagaPontuada({ descricao: "Vaga com Kubernetes gerenciado.", fit: 80 });
    expect(
      (await analyseGap({ candidateId: candidatoId }))?.confirmed.map((t) => t.term),
    ).toContain(TERMO_CONFIRMADO);
  });
});

describe("leitura do candidato por slug e por id", () => {
  it("encontra pelo slug padrão e devolve null para slug desconhecido", async () => {
    // `getCandidate()` sem argumento é o caminho da CLI, que trabalha sempre
    // no candidato "default".
    expect((await getCandidate())?.id).toBe(candidatoId);
    expect(await getCandidate("nao-existe")).toBeNull();
  });

  it("encontra pelo id e devolve null para id inexistente", async () => {
    // O id chega de rota (`/candidate/[id]`), então "não existe" tem que ser
    // um valor de retorno, não uma exceção que vira erro 500.
    expect((await getCandidateById(candidatoId))?.name).toBe("Candidato da Lacuna");
    expect(await getCandidateById(99_999)).toBeNull();
  });

  it("atualizar o candidato apaga o que não foi reenviado", async () => {
    // `ensureCandidate` grava `?? null` em cada campo opcional. Ela é chamada
    // pelo `syncCandidateFromProfile`, e o profile.yaml é a fonte da verdade
    // da identidade: um campo removido de lá tem que sumir do banco, senão as
    // duas fontes divergem em silêncio.
    await ensureCandidate({
      slug: "default",
      name: "Candidato da Lacuna",
      headline: "Senior AI Software Architect",
      location: "São Paulo",
      email: "eu@empresa.com.br",
      linkedinUrl: "https://www.linkedin.com/in/eu",
      githubUrl: "https://github.com/eu",
    });
    await ensureCandidate({ slug: "default", name: "Só o nome" });

    expect(await getCandidate()).toMatchObject({
      id: candidatoId,
      name: "Só o nome",
      headline: null,
      location: null,
      email: null,
      linkedinUrl: null,
      githubUrl: null,
    });
  });

  it("separa candidatos por slug", async () => {
    await ensureCandidate({ slug: "segundo", name: "Segundo Candidato" });
    expect((await getCandidate("segundo"))?.name).toBe("Segundo Candidato");
    expect((await getCandidate())?.name).toBe("Candidato da Lacuna");
  });
});

describe("restoreDocument: rótulo em branco é recusa, não rótulo vazio", () => {
  it("recusa rótulo que só tem espaço", async () => {
    // A versão restaurada nasce com o rótulo informado, e rótulo é a única
    // alça humana de uma versão. Aceitar "   " criaria uma linha impossível
    // de identificar no histórico — que é justamente o que o histórico serve
    // para responder.
    const antiga = await saveDocument({
      candidateId: candidatoId,
      label: "Versão de julho",
      content: "conteúdo antigo",
    });
    await saveDocument({
      candidateId: candidatoId,
      label: "Versão atual",
      content: "conteúdo novo",
    });

    expect(await restoreDocument(candidatoId, antiga.id, "   ")).toEqual({
      ok: false,
      error: "empty-label",
    });
  });

  it("restaura acrescentando uma versão nova, sem rebobinar o histórico", async () => {
    // Restaurar move o conteúdo para o topo em vez de mover o ponteiro: assim
    // "a última linha" e "o currículo atual" continuam sendo a mesma coisa, e
    // todo código que lê o topo da lista como estado corrente continua certo.
    const antiga = await saveDocument({
      candidateId: candidatoId,
      label: "Versão de julho",
      content: "conteúdo antigo",
    });
    await saveDocument({
      candidateId: candidatoId,
      label: "Versão atual",
      content: "conteúdo novo",
    });

    const restaurada = await restoreDocument(candidatoId, antiga.id, "  Volta de julho  ");
    expect(restaurada.ok).toBe(true);
  });
});
