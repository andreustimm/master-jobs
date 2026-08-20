import { describe, expect, it } from "vitest";
import {
  SCORE_MESSAGE_CODES,
  evaluateEligibility,
  message,
  scoreMessages,
  type MatchPolicy,
  type ScoreMessage,
} from "../src/contexts/matching/index.ts";

/**
 * `scoreMessages` é o portão de entrada de dados que JÁ estão gravados na
 * coluna `reasons`/`blockers` de `job_score`. Quem escreveu aquelas linhas foi
 * uma versão anterior do scorer, e ninguém vai migrar 6.000 linhas: o parser
 * precisa aceitar o formato antigo, aceitar o novo e recusar lixo sem derrubar
 * a tela que renderiza o breakdown.
 *
 * É por isso que quase todo caso aqui é sobre entrada malformada — a entrada
 * bem formada é a que menos aparece na prática.
 */
describe("scoreMessages: leitura defensiva do que já está no banco", () => {
  it("devolve lista vazia para qualquer coisa que não seja array", () => {
    // A coluna é JSON livre. `null` acontece em linha antiga, string acontece
    // quando alguém gravou sem serializar, e objeto solto acontece por engano.
    // Nenhum dos três pode virar exceção dentro de um Server Component.
    expect(scoreMessages(null)).toEqual([]);
    expect(scoreMessages(undefined)).toEqual([]);
    expect(scoreMessages("keywords.matched")).toEqual([]);
    expect(scoreMessages({ code: "legacy" })).toEqual([]);
    expect(scoreMessages(42)).toEqual([]);
  });

  it("promove a string solta do formato antigo para o código `legacy`", () => {
    // Antes das mensagens estruturadas o scorer gravava a frase pronta em
    // português. Descartá-la apagaria a explicação de todo score já calculado;
    // envolvê-la em `legacy` mantém o texto exibível sem fingir que ele é
    // traduzível como os códigos novos.
    expect(scoreMessages(["Título fora do alvo"])).toEqual([
      { code: "legacy", params: { text: "Título fora do alvo" } },
    ]);
  });

  it("ignora item nulo ou primitivo no meio de uma lista válida", () => {
    // Um item ruim não pode contaminar os vizinhos: a linha continua legível
    // com as razões que sobreviveram.
    expect(scoreMessages([null, 123, true, { code: "geo.latam" }])).toEqual([
      { code: "geo.latam" },
    ]);
  });

  it("descarta código que não pertence ao vocabulário fechado", () => {
    // O código vira chave de tradução. Aceitar um código desconhecido faria a
    // UI procurar chave inexistente no dicionário — falha só visível em
    // produção, e só no idioma que ninguém testou (regra 9 do CLAUDE.md).
    expect(scoreMessages([{ code: "geo.marte" }, { code: "" }])).toEqual([]);
    expect(scoreMessages([{ code: 7 }])).toEqual([]);
  });

  it("mantém apenas parâmetros escalares, que são os únicos interpoláveis", () => {
    // `params` alimenta interpolação de string. Objeto aninhado ou array
    // viraria "[object Object]" na tela; filtrar aqui é mais barato do que
    // defender em cada ponto de renderização.
    const [parsed] = scoreMessages([
      {
        code: "keywords.matched",
        params: { n: 4, term: "kubernetes", nested: { a: 1 }, list: [1, 2], nulo: null },
      },
    ]);
    expect(parsed).toEqual({
      code: "keywords.matched",
      params: { n: 4, term: "kubernetes" },
    });
  });

  it("trata `params` não-objeto como ausência de parâmetros", () => {
    // `params: "x"` não pode virar `{ 0: "x" }`, que é o que Object.entries
    // faria com uma string.
    expect(scoreMessages([{ code: "comp.ideal", params: "x" }])).toEqual([
      { code: "comp.ideal" },
    ]);
    expect(scoreMessages([{ code: "comp.ideal", params: null }])).toEqual([
      { code: "comp.ideal" },
    ]);
  });

  it("faz round-trip de toda mensagem que o scorer sabe emitir", () => {
    // Garante que o vocabulário declarado e o vocabulário aceito são o mesmo
    // conjunto: um código novo em SCORE_MESSAGE_CODES que o parser rejeitasse
    // seria uma razão silenciosamente sumida da tela de breakdown.
    const todas: ScoreMessage[] = SCORE_MESSAGE_CODES.map((code) => message(code));
    expect(scoreMessages(todas)).toEqual(todas);
  });
});

describe("message: `params` opcional não vira chave presente com undefined", () => {
  it("omite `params` quando não há o que interpolar", () => {
    // `{ code, params: undefined }` e `{ code }` não são equivalentes para
    // JSON.stringify — e essa diferença vazaria para o JSON gravado na coluna.
    expect(Object.hasOwn(message("geo.worldwide"), "params")).toBe(false);
    expect(message("freshness.hot", { days: 2 })).toEqual({
      code: "freshness.hot",
      params: { days: 2 },
    });
  });
});

const POLITICA_REMOTO: MatchPolicy = {
  workAuthorization: ["Brazil"],
  needsVisaSponsorshipFor: ["US"],
  contractModels: ["b2b"],
  remoteOnly: true,
  acceptableRegions: ["latam"],
  maxTimezoneOffsetHours: 6,
};

describe("elegibilidade: presencial confirmado é eliminatório", () => {
  it("recusa a vaga quando a fonte diz explicitamente que não é remota", () => {
    // Este é o caso que motiva rubrica em vez de similaridade de cosseno:
    // "W2 on-site em Austin" tem texto parecidíssimo com a vaga ideal e é
    // impossível de aceitar. `remote: false` é evidência estruturada, não
    // ausência de dado — e por isso pode reprovar sem violar a regra 8.
    expect(evaluateEligibility(POLITICA_REMOTO, { remote: false })).toEqual({
      status: "ineligible",
      reasons: ["remote-required"],
    });
  });

  it("não reprova por presencial quando a política não exige remoto", () => {
    // A exigência é da política do candidato, não da vaga. Outro candidato com
    // `remoteOnly: false` vê exatamente a mesma vaga como não-verificável.
    expect(
      evaluateEligibility({ ...POLITICA_REMOTO, remoteOnly: false }, { remote: false }),
    ).toEqual({ status: "unverifiable", reasons: ["data-unavailable"] });
  });

  it("acumula o bloqueio de presencial junto com os demais", () => {
    // Quando há mais de um motivo, todos precisam aparecer: a tela de
    // breakdown existe para explicar por que a vaga caiu, e mostrar só
    // "remoto" esconderia que a região também não serve.
    const resultado = evaluateEligibility(POLITICA_REMOTO, {
      remote: false,
      regions: ["Japan"],
    });
    expect(resultado.status).toBe("ineligible");
    expect(resultado.reasons).toEqual(["remote-required", "region-rejected"]);
  });
});
