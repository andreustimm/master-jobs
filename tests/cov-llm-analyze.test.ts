/**
 * Suíte: `src/core/llm/analyze.ts` — a leitura qualitativa de um anúncio.
 *
 * Duas promessas sustentam este arquivo e são o que os casos verificam:
 *
 *  1. **O prompt é arquivo, não código.** Ele mora em
 *     `docs/prompts/system/*.md` justamente para o usuário poder ajustar o
 *     critério sem editar TypeScript. Se o carregamento falhar em silêncio, o
 *     ajuste dele deixa de existir sem aviso.
 *  2. **Só o anúncio sai da máquina.** Currículo, perfil e funil ficam. A
 *     função que monta o payload é a única fronteira onde isso pode vazar, e é
 *     por isso que ela é explícita e mensurável antes do envio.
 *
 * Fronteira DENTRO: montagem do payload e orquestração da chamada.
 * Fronteira FORA: rede — a porta LLM é um dublê em memória.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  analyzeJob,
  buildAnalysisInput,
  loadSystemPrompt,
  payloadSize,
} from "../src/core/llm/analyze.ts";
import type { LlmPort, LlmRequest, LlmResponse } from "../src/core/llm/port.ts";
import type { Dossier } from "../src/core/apply/dossier.ts";

const dossie = {
  job: {
    id: 1,
    title: "Staff AI Engineer",
    companyName: "Acme",
    url: "https://exemplo.test/1",
    applyUrl: null,
    locationRaw: "Remote — LATAM",
    ageDays: 4,
  },
  requirements: ["Oito anos construindo sistemas distribuídos em produção"],
} as unknown as Dossier;

/** Porta LLM que grava o que recebeu e devolve resposta fixa. */
function portaDublê(resposta: Partial<LlmResponse> = {}): LlmPort & { pedidos: LlmRequest[] } {
  const pedidos: LlmRequest[] = [];
  return {
    pedidos,
    name: "dublê",
    model: "modelo-de-teste",
    async complete(req: LlmRequest): Promise<LlmResponse> {
      pedidos.push(req);
      return {
        text: "  Análise com espaço sobrando.  ",
        inputTokens: 900,
        outputTokens: 210,
        model: "modelo-que-respondeu",
        ...resposta,
      };
    },
  };
}

let temporario: string;

beforeEach(() => {
  temporario = mkdtempSync(join(tmpdir(), "jho-prompt-"));
  mkdirSync(join(temporario, "docs", "prompts", "system"), { recursive: true });
});

afterEach(() => {
  rmSync(temporario, { recursive: true, force: true });
});

describe("loadSystemPrompt", () => {
  it("lê apenas o primeiro bloco cercado, deixando a justificativa de fora", async () => {
    // O arquivo é escrito para dois leitores: o modelo lê o bloco, a pessoa lê a
    // prosa em volta. Mandar a prosa junto mudaria o comportamento do modelo a
    // cada vez que alguém melhorasse a explicação.
    writeFileSync(
      join(temporario, "docs", "prompts", "system", "exemplo.md"),
      [
        "# Por que este prompt existe",
        "",
        "Explicação para humanos que não deve ser enviada.",
        "",
        "```text",
        "Instrução de verdade.",
        "```",
        "",
        "```text",
        "Segundo bloco, ignorado.",
        "```",
      ].join("\n"),
    );

    const prompt = await loadSystemPrompt("exemplo", temporario);

    expect(prompt).toBe("Instrução de verdade.");
    expect(prompt).not.toContain("Explicação para humanos");
    expect(prompt).not.toContain("Segundo bloco");
  });

  it("falha alto quando o markdown existe mas não tem bloco de prompt", async () => {
    // Modo de falha que isto evita: mandar o arquivo inteiro — cabeçalhos,
    // comentários e tudo — como instrução de sistema, e ninguém perceber porque
    // o modelo responde alguma coisa mesmo assim.
    writeFileSync(
      join(temporario, "docs", "prompts", "system", "sem-bloco.md"),
      "# Só prosa\n\nAlguém apagou as cercas por engano.\n",
    );

    await expect(loadSystemPrompt("sem-bloco", temporario)).rejects.toThrow(
      /Nenhum bloco de prompt/,
    );
    await expect(loadSystemPrompt("sem-bloco", temporario)).rejects.toThrow(/sem-bloco\.md/);
  });

  it("falha quando o arquivo não existe, em vez de rodar sem instrução", async () => {
    await expect(loadSystemPrompt("nao-existe", temporario)).rejects.toThrow();
  });
});

describe("payloadSize", () => {
  it("mede exatamente o que será enviado, não uma estimativa", async () => {
    // O número aparece na confirmação que o comando mostra antes de sair da
    // máquina. Uma estimativa faria o usuário consentir com um tamanho que não é
    // o real, o que esvazia o propósito da confirmação.
    expect(payloadSize(dossie, "Descrição da vaga.")).toBe(
      buildAnalysisInput(dossie, "Descrição da vaga.").length,
    );
    expect(payloadSize(dossie, "")).toBeLessThan(payloadSize(dossie, "x".repeat(500)));
  });
});

describe("analyzeJob", () => {
  it("manda o anúncio como mensagem do usuário e a rubrica como sistema", async () => {
    // A separação não é cosmética: o que está no system é instrução estável, o
    // que está na mensagem é o dado sob análise. Misturar os dois deixa o
    // anúncio capaz de reescrever o critério de avaliação.
    const porta = portaDublê();

    const r = await analyzeJob(porta, dossie, "Descrição completa da vaga.");

    const pedido = porta.pedidos[0]!;
    expect(pedido.system).toContain("recrutador sênior");
    expect(pedido.messages).toHaveLength(1);
    expect(pedido.messages[0]!.role).toBe("user");
    expect(pedido.messages[0]!.content).toContain("Staff AI Engineer");
    expect(pedido.messages[0]!.content).toContain("Descrição completa da vaga.");
    // O que ficou na máquina: nada de perfil, evidência ou funil.
    expect(pedido.messages[0]!.content).not.toContain("evidence");
    expect(r.text).toBe("Análise com espaço sobrando.");
    expect(r.model).toBe("modelo-que-respondeu");
    expect(r.inputTokens).toBe(900);
    expect(r.outputTokens).toBe(210);
  });

  it("usa temperatura baixa porque invenção aqui custa uma candidatura", async () => {
    // Não é preferência de estilo. O trabalho é relatar o que o anúncio diz; uma
    // invenção confiante manda a pessoa se preparar para uma vaga que não existe
    // daquele jeito.
    const porta = portaDublê();

    await analyzeJob(porta, dossie, "x");

    expect(porta.pedidos[0]!.temperature).toBe(0.1);
    expect(porta.pedidos[0]!.maxTokens).toBe(1600);
    expect(porta.pedidos[0]!.effort).toBeUndefined();
  });

  it("repassa esforço e teto de saída escolhidos pelo chamador", async () => {
    // Esses dois são dinheiro do usuário. Quem paga decide, e o padrão só vale
    // quando ninguém decidiu.
    const porta = portaDublê();

    await analyzeJob(porta, dossie, "x", process.cwd(), { effort: "max", maxTokens: 4096 });

    expect(porta.pedidos[0]!.effort).toBe("max");
    expect(porta.pedidos[0]!.maxTokens).toBe(4096);
  });

  it("propaga a falha do provedor sem devolver análise vazia", async () => {
    // Devolver texto vazio faria a tela mostrar "sem observações" para uma vaga
    // que nunca foi analisada — indistinguível de uma análise que não achou nada.
    const quebrada: LlmPort = {
      name: "quebrada",
      model: "m",
      async complete(): Promise<LlmResponse> {
        throw new Error("provedor fora do ar");
      },
    };

    await expect(analyzeJob(quebrada, dossie, "x")).rejects.toThrow("provedor fora do ar");
  });

  it("falha antes de gastar chamada quando o prompt não pode ser carregado", async () => {
    // A ordem importa: carregar o prompt primeiro significa que um arquivo
    // quebrado custa zero token.
    const porta = portaDublê();

    await expect(analyzeJob(porta, dossie, "x", temporario)).rejects.toThrow();
    expect(porta.pedidos).toHaveLength(0);
  });
});
