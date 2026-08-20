/**
 * Suíte: as bordas de `src/core/llm/registry.ts` — o cadastro curado de
 * provedores e modelos (BYOK).
 *
 * O caminho feliz já está em `llm-registry.test.ts`. Aqui ficam as decisões que
 * só aparecem quando o cadastro está incompleto ou o usuário pediu algo que não
 * existe: escolher modelo sem padrão marcado, pedir um modelo inexistente, e
 * montar a porta de um serviço "compatível" — que é como Groq, OpenRouter e
 * NVIDIA entram sem adapter novo.
 *
 * Fronteira DENTRO: libSQL real e `process.env`.
 * Fronteira FORA: rede — nenhuma porta construída aqui chega a ser chamada.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/core/db/client.ts";
import { llmModel, llmProvider } from "../src/core/db/schema.ts";
import {
  chooseModel,
  listModels,
  portFor,
  seedProviders,
  setDefaultModel,
} from "../src/core/llm/registry.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";

/**
 * Toda variável de chave que um provedor semeado pode ler.
 *
 * Limpas em bloco porque a máquina do desenvolvedor legitimamente tem algumas
 * delas exportadas, e um teste cujo resultado depende de quais é um teste que
 * passa pelo motivo errado.
 */
const VARIAVEIS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "NVIDIA_API_KEY",
  "OPENCODE_ZEN_API_KEY",
  "OPENCODE_API_KEY",
];

let db: DB;
let salvas: Record<string, string | undefined> = {};

beforeEach(async () => {
  db = await useTestDb();
  salvas = Object.fromEntries(VARIAVEIS.map((k) => [k, process.env[k]]));
  for (const k of VARIAVEIS) delete process.env[k];
});

afterEach(() => {
  releaseTestDb();
  for (const [k, v] of Object.entries(salvas)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("chooseModel", () => {
  it("devolve nada para um modelo que não está no cadastro", async () => {
    // `--model` é texto digitado. Cair no padrão silenciosamente rodaria a
    // análise com um modelo diferente do pedido e cobraria por ele, sem o
    // usuário nunca saber que o nome estava errado.
    await seedProviders();
    process.env.ANTHROPIC_API_KEY = "sk-ant-teste";

    await expect(chooseModel("modelo-que-nao-existe")).resolves.toBeNull();
  });

  it("recusa modelo pedido pelo nome quando a chave dele não está no ambiente", async () => {
    // Escolher assim mesmo empurraria a falha para dentro da API, como 401 sem
    // contexto, em vez de aqui, onde dá para dizer qual variável falta.
    await seedProviders();
    process.env.ANTHROPIC_API_KEY = "sk-ant-teste";

    const escolhido = await chooseModel("gpt-5");

    expect(escolhido!.providerSlug).toBe("openai");
    expect(escolhido!.keyPresent).toBe(false);
    expect(() => portFor(escolhido!)).toThrow(/OPENAI_API_KEY/);
  });

  it("cai para qualquer modelo com chave quando nenhum está marcado como padrão", async () => {
    // Estado real depois de o usuário desmarcar o padrão sem escolher outro. Sem
    // esta queda, `jho analyze` diria "nenhum modelo disponível" com a chave
    // exportada na frente.
    await seedProviders();
    await db.update(llmModel).set({ isDefault: false });
    process.env.NVIDIA_API_KEY = "nvapi-teste";

    const escolhido = await chooseModel();

    expect(escolhido).not.toBeNull();
    expect(escolhido!.providerSlug).toBe("nvidia");
    expect(escolhido!.keyPresent).toBe(true);
  });

  it("ignora o padrão cuja chave sumiu e escolhe um que funciona", async () => {
    // Trocar de provedor costuma ser apagar uma variável do `.env`. O padrão
    // antigo continua marcado no banco, e insistir nele é garantir um 401.
    await seedProviders();
    expect(await setDefaultModel("claude-opus-5")).toBe(true);
    process.env.OPENROUTER_API_KEY = "sk-or-teste";

    const escolhido = await chooseModel();

    expect(escolhido!.providerSlug).toBe("openrouter");
  });

  it("devolve nada quando o provedor inteiro foi desligado", async () => {
    // Desligar o provedor precisa esconder todos os modelos dele, e não só
    // aqueles que alguém lembrou de desligar um a um.
    await seedProviders();
    process.env.ANTHROPIC_API_KEY = "sk-ant-teste";
    await db.update(llmProvider).set({ enabled: false }).where(eq(llmProvider.slug, "anthropic"));

    await expect(chooseModel()).resolves.toBeNull();
    const visiveis = await listModels(true);
    expect(visiveis.some((m) => m.providerSlug === "anthropic")).toBe(false);
    // Sem o filtro de habilitados, o cadastro continua lá para ser reativado.
    expect((await listModels()).some((m) => m.providerSlug === "anthropic")).toBe(true);
  });

  it("põe na frente os modelos cuja chave existe", async () => {
    // A lista é o menu de `jho llm list`. Modelo sem chave no topo faz o usuário
    // escolher justamente o que não vai rodar.
    await seedProviders();
    process.env.OPENCODE_ZEN_API_KEY = "oc-teste";

    const modelos = await listModels();
    const primeiroSemChave = modelos.findIndex((m) => !m.keyPresent);
    const ultimoComChave = modelos.map((m) => m.keyPresent).lastIndexOf(true);

    expect(ultimoComChave).toBeLessThan(primeiroSemChave);
  });
});

describe("portFor", () => {
  it("fala o protocolo da OpenAI com um serviço compatível, na base URL dele", async () => {
    // É o que dispensa um adapter por serviço: o formato de fio é o mesmo, só o
    // host muda. Sem a base URL, a chave da NVIDIA seria enviada para a OpenAI.
    await seedProviders();
    process.env.NVIDIA_API_KEY = "nvapi-teste";
    const modelo = (await listModels()).find((m) => m.providerSlug === "nvidia")!;

    const porta = portFor(modelo);

    expect(modelo.kind).toBe("compatible");
    expect(porta.name).toBe("openai");
    expect(porta.model).toBe(modelo.modelId);
  });

  it("monta a porta compatível mesmo sem base URL cadastrada", async () => {
    // Provedor adicionado à mão pode não ter base URL. O padrão da OpenAI é o
    // comportamento certo aí, e não um erro de cadastro.
    await seedProviders();
    process.env.NVIDIA_API_KEY = "nvapi-teste";
    await db.update(llmProvider).set({ baseUrl: null }).where(eq(llmProvider.slug, "nvidia"));
    const modelo = (await listModels()).find((m) => m.providerSlug === "nvidia")!;

    expect(modelo.baseUrl).toBeNull();
    expect(portFor(modelo).name).toBe("openai");
  });

  it("usa o adapter nativo quando o provedor é da Anthropic", async () => {
    await seedProviders();
    process.env.ANTHROPIC_API_KEY = "sk-ant-teste";
    const modelo = (await listModels()).find((m) => m.providerSlug === "anthropic")!;

    expect(portFor(modelo).name).toBe("anthropic");
  });
});

describe("setDefaultModel", () => {
  it("reabilita o modelo que virou padrão, para não haver padrão inalcançável", async () => {
    // Marcar como padrão um modelo desligado criaria um estado em que
    // `chooseModel` nunca o devolve e o usuário não entende por quê.
    await seedProviders();
    await db.update(llmModel).set({ enabled: false }).where(eq(llmModel.modelId, "gpt-5"));

    expect(await setDefaultModel("gpt-5")).toBe(true);

    const [linha] = await db.select().from(llmModel).where(eq(llmModel.modelId, "gpt-5"));
    expect(linha!.enabled).toBe(true);
    expect(linha!.isDefault).toBe(true);
  });
});
