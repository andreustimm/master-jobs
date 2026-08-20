/**
 * Suíte: os dois adapters de provedor em `src/core/llm/providers.ts`.
 *
 * Invariante do módulo: a chave é do usuário. Ela sai da máquina só no cabeçalho
 * da requisição, nunca em log, nunca em mensagem de erro, nunca no banco. O
 * segundo invariante é de portabilidade: `effort` é intenção, e cada vendor a
 * traduz — trocar de modelo não pode quebrar uma chamada que funcionava.
 *
 * Fronteira DENTRO: a montagem da requisição e a leitura da resposta.
 * Fronteira FORA: rede real — `globalThis.fetch` é substituído por dublê e
 * nenhum caso abre socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmError } from "../src/core/llm/port.ts";
import { anthropicProvider, openaiProvider } from "../src/core/llm/providers.ts";

type Requisicao = { url: string; init: RequestInit };

let chamadas: Requisicao[] = [];
let modeloDoAmbiente: string | undefined;

/** Responde uma vez com o corpo dado, guardando o que foi pedido. */
function responder(status: number, body: unknown): void {
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    chamadas.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
}

function corpoEnviado(): Record<string, unknown> {
  return JSON.parse(String(chamadas.at(-1)!.init.body)) as Record<string, unknown>;
}

function cabecalhos(): Record<string, string> {
  return (chamadas.at(-1)!.init.headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  chamadas = [];
  modeloDoAmbiente = process.env.JHO_LLM_MODEL;
  delete process.env.JHO_LLM_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (modeloDoAmbiente === undefined) delete process.env.JHO_LLM_MODEL;
  else process.env.JHO_LLM_MODEL = modeloDoAmbiente;
});

const pedido = { system: "Você é um recrutador.", messages: [{ role: "user" as const, content: "Analise." }] };

/* -------------------------------------------------------------------------- */
/* Anthropic                                                                   */
/* -------------------------------------------------------------------------- */

describe("anthropicProvider", () => {
  it("envia a chave no cabeçalho e nada dela no corpo", async () => {
    // A chave viaja em `x-api-key` e ponto. Qualquer cópia dela no corpo viraria
    // parte de um payload que pode ser logado por proxy, gravado em replay de
    // teste, ou ecoado numa mensagem de erro.
    responder(200, { content: [{ type: "text", text: "ok" }], model: "claude-sonnet-5" });
    const porta = anthropicProvider("sk-ant-api03-CHAVESECRETA0000000");

    await porta.complete(pedido);

    expect(cabecalhos()["x-api-key"]).toBe("sk-ant-api03-CHAVESECRETA0000000");
    expect(cabecalhos()["anthropic-version"]).toBe("2023-06-01");
    expect(String(chamadas[0]!.init.body)).not.toContain("CHAVESECRETA");
    expect(chamadas[0]!.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("manda temperatura quando não há esforço, e pensamento quando há", async () => {
    // Nesta API os dois são mutuamente exclusivos: mandar ambos é 400. O adapter
    // escolhe, e é por isso que `effort` pode ser omitido sem quebrar nada.
    responder(200, { content: [] });
    const porta = anthropicProvider("sk-ant-x");

    await porta.complete({ ...pedido, temperature: 0.7 });
    expect(corpoEnviado()).toMatchObject({ temperature: 0.7 });
    expect(corpoEnviado()).not.toHaveProperty("thinking");

    await porta.complete({ ...pedido, effort: "high" });
    expect(corpoEnviado()).toMatchObject({
      thinking: { type: "enabled", budget_tokens: 12_000 },
    });
    expect(corpoEnviado()).not.toHaveProperty("temperature");
  });

  it("gradua o orçamento de pensamento, sem deixar 'max' virar ilimitado", async () => {
    // Token de pensamento é cobrado como saída: é dinheiro do usuário. `max`
    // existe para ser o teto conhecido, não para ser sem teto.
    responder(200, { content: [] });
    const porta = anthropicProvider("sk-ant-x");
    const orcamentos: number[] = [];

    for (const nivel of ["low", "medium", "high", "xhigh", "max"] as const) {
      await porta.complete({ ...pedido, effort: nivel });
      orcamentos.push(
        (corpoEnviado().thinking as { budget_tokens: number }).budget_tokens,
      );
    }

    expect(orcamentos).toEqual([1024, 4096, 12_000, 24_000, 32_000]);
    expect(orcamentos).toEqual([...orcamentos].sort((a, b) => a - b));
  });

  it("descarta os blocos de pensamento e devolve só a resposta", async () => {
    // Com pensamento ligado a resposta vem misturada. Concatenar tudo entregaria
    // o rascunho do modelo como se fosse a análise da vaga.
    responder(200, {
      content: [
        { type: "thinking", thinking: "hmm, será que…" },
        { type: "text", text: "Parte um. " },
        { type: "text" },
        { type: "text", text: "Parte dois." },
      ],
      usage: { input_tokens: 120, output_tokens: 45 },
      model: "claude-opus-5",
    });

    const r = await anthropicProvider("sk-ant-x").complete(pedido);

    expect(r.text).toBe("Parte um. Parte dois.");
    expect(r.inputTokens).toBe(120);
    expect(r.outputTokens).toBe(45);
    expect(r.model).toBe("claude-opus-5");
  });

  it("relata custo desconhecido como nulo em vez de zero", async () => {
    // Zero é uma afirmação: "esta chamada não consumiu nada". Nulo é o que a
    // resposta realmente disse quando não trouxe `usage`.
    responder(200, {});

    const r = await anthropicProvider("sk-ant-x", "modelo-explicito").complete(pedido);

    expect(r.text).toBe("");
    expect(r.inputTokens).toBeNull();
    expect(r.outputTokens).toBeNull();
    // Sem `model` na resposta, o modelo pedido é o melhor palpite honesto.
    expect(r.model).toBe("modelo-explicito");
  });

  it("resolve o modelo por argumento, depois por ambiente, depois pelo padrão", async () => {
    // A ordem importa: `--model` na CLI tem que vencer o `.env`, senão a flag
    // não serve para experimentar um modelo sem editar arquivo.
    responder(200, { content: [] });
    expect(anthropicProvider("k").model).toBe("claude-sonnet-5");

    process.env.JHO_LLM_MODEL = "claude-haiku-4-5-20251001";
    expect(anthropicProvider("k").model).toBe("claude-haiku-4-5-20251001");
    expect(anthropicProvider("k", "claude-opus-5").model).toBe("claude-opus-5");
  });

  it("aceita base URL com barra no fim sem gerar caminho duplo", async () => {
    // O usuário cola a URL do serviço com barra tanto quanto sem. `//v1/messages`
    // dá 404 em alguns gateways e 301 em outros — nenhum dos dois é um erro que
    // se lê com facilidade.
    responder(200, { content: [] });

    await anthropicProvider("k", undefined, "https://proxy.interno.test/").complete(pedido);

    expect(chamadas[0]!.url).toBe("https://proxy.interno.test/v1/messages");
  });

  it("transforma erro do provedor em LlmError com a chave já apagada", async () => {
    // O jeito mais fácil de vazar credencial é um 401 que ecoa a requisição.
    // A limpeza acontece dentro do tipo de erro, para nenhum chamador precisar
    // lembrar de fazê-la.
    responder(401, {
      error: { message: "invalid x-api-key: sk-ant-api03-VAZOU0000000000000" },
    });

    const erro = await anthropicProvider("sk-ant-x")
      .complete(pedido)
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(LlmError);
    expect((erro as LlmError).status).toBe(401);
    expect((erro as LlmError).provider).toBe("anthropic");
    expect((erro as LlmError).message).not.toContain("VAZOU");
    expect((erro as LlmError).message).toContain("sk-ant-***");
  });

  it("relata o código HTTP quando o provedor não explica o erro", async () => {
    // Gateways intermediários devolvem 502 com corpo vazio. "HTTP 502" é pouco,
    // mas é verdade; inventar uma causa seria pior.
    responder(502, {});

    await expect(anthropicProvider("k").complete(pedido)).rejects.toThrow("HTTP 502");
  });
});

/* -------------------------------------------------------------------------- */
/* OpenAI e compatíveis                                                        */
/* -------------------------------------------------------------------------- */

describe("openaiProvider", () => {
  it("põe o system como primeira mensagem, que é onde esta API o espera", async () => {
    // A Anthropic tem campo próprio para o system; aqui ele é a primeira
    // mensagem. É a única diferença estrutural entre os dois protocolos, e é
    // exatamente ela que a porta esconde do chamador.
    responder(200, { choices: [{ message: { content: "ok" } }] });

    await openaiProvider("sk-x").complete(pedido);

    expect(corpoEnviado().messages).toEqual([
      { role: "system", content: "Você é um recrutador." },
      { role: "user", content: "Analise." },
    ]);
    expect(cabecalhos()["authorization"]).toBe("Bearer sk-x");
    expect(chamadas[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("achata os dois níveis extras de esforço, em vez de recusar a chamada", async () => {
    // Não existe equivalente a `xhigh`/`max` aqui. Recusar faria uma chamada que
    // funciona na Anthropic quebrar só por trocar de modelo — que é o oposto do
    // que a porta promete.
    responder(200, { choices: [] });
    const porta = openaiProvider("sk-x");
    const niveis: unknown[] = [];

    for (const nivel of ["low", "medium", "high", "xhigh", "max"] as const) {
      await porta.complete({ ...pedido, effort: nivel });
      niveis.push(corpoEnviado().reasoning_effort);
    }

    expect(niveis).toEqual(["low", "medium", "high", "high", "high"]);
  });

  it("omite o esforço quando o chamador não pediu nenhum", async () => {
    responder(200, { choices: [] });

    await openaiProvider("sk-x").complete(pedido);

    expect(corpoEnviado()).not.toHaveProperty("reasoning_effort");
    expect(corpoEnviado()).toMatchObject({ max_completion_tokens: 2000 });
  });

  it("serve qualquer serviço compatível pela base URL, com a chave daquele serviço", async () => {
    // É o que faz Groq, OpenRouter, NVIDIA e Ollama funcionarem sem adapter
    // novo. Sem a base URL, a chave de um serviço iria para api.openai.com.
    responder(200, { choices: [{ message: { content: "oi" } }], model: "kimi-k2" });

    const r = await openaiProvider("nvapi-x", "moonshotai/kimi-k2-instruct", "https://integrate.api.nvidia.com/")
      .complete({ ...pedido, maxTokens: 512 });

    expect(chamadas[0]!.url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(corpoEnviado()).toMatchObject({
      model: "moonshotai/kimi-k2-instruct",
      max_completion_tokens: 512,
    });
    expect(r.text).toBe("oi");
    expect(r.model).toBe("kimi-k2");
  });

  it("lê custo do formato desta API e devolve nulo quando ele falta", async () => {
    responder(200, {
      choices: [{ message: { content: "texto" } }],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    });
    const comUso = await openaiProvider("sk-x").complete(pedido);
    expect([comUso.inputTokens, comUso.outputTokens]).toEqual([10, 3]);

    responder(200, { choices: [{}] });
    const semUso = await openaiProvider("sk-x").complete(pedido);
    expect(semUso.text).toBe("");
    expect([semUso.inputTokens, semUso.outputTokens]).toEqual([null, null]);
    // Modelo ausente na resposta cai para o pedido, nunca para string vazia.
    expect(semUso.model).toBe("gpt-5-mini");

    // Serviço compatível pode devolver 200 com corpo praticamente vazio; isso é
    // uma resposta sem conteúdo, não um erro — e não pode virar exceção.
    responder(200, {});
    const vazio = await openaiProvider("sk-x").complete(pedido);
    expect(vazio.text).toBe("");
    expect([vazio.inputTokens, vazio.outputTokens]).toEqual([null, null]);
  });

  it("transforma erro do provedor em LlmError com a chave já apagada", async () => {
    responder(429, {
      error: { message: "rate limit for key sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA" },
    });

    const erro = await openaiProvider("sk-x").complete(pedido).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(LlmError);
    expect((erro as LlmError).status).toBe(429);
    expect((erro as LlmError).provider).toBe("openai");
    expect((erro as LlmError).message).not.toContain("AAAAAAAAAAAA");
    expect((erro as LlmError).message).toContain("sk-***");
  });

  it("relata o código HTTP quando o provedor não explica o erro", async () => {
    responder(500, {});

    await expect(openaiProvider("sk-x").complete(pedido)).rejects.toThrow("HTTP 500");
  });
});
