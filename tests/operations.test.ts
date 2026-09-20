/**
 * Suíte: pedir manutenção sem executá-la aqui.
 *
 * O que estes casos defendem:
 *
 *  1. **Nome de rotina é lista de permissão.** Valor fora dela recusa, e não
 *     cai em "tudo" — rodar a varredura inteira por causa de lixo no formulário
 *     é caro e é surpresa.
 *  2. **Falta de credencial é resposta, não exceção.** Sem token a tela precisa
 *     explicar o que configurar; a cron diária continua de pé.
 *  3. **Credencial não vaza.** Nem para o resultado, nem para a mensagem de
 *     recusa (regra 16).
 */
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { ROUTINES, ROUTINE_LABEL_KEYS, parseRoutine } from "../src/contexts/operations/domain/routine.ts";
import { requestRoutine } from "../src/contexts/operations/app/request-routine.ts";
import { githubDispatch } from "../src/contexts/operations/infra/github-dispatch.ts";
import type { WorkflowDispatchPort } from "../src/contexts/operations/ports.ts";
import { dictionary } from "../src/core/i18n/index.ts";

const aceita: WorkflowDispatchPort = { configured: () => true, dispatch: async () => ({ ok: true }) };

describe("rotina", () => {
  it("aceita só os nomes da lista", () => {
    for (const routine of ROUTINES) expect(parseRoutine(routine)).toEqual({ ok: true, routine });
  });

  it("recusa nome desconhecido em vez de rodar tudo", () => {
    for (const valor of ["", "SYNC", "varredura", " sync", 1, null, undefined, {}]) {
      expect(parseRoutine(valor)).toEqual({ ok: false, code: "routine_unknown" });
    }
  });

  it("cada rotina tem rótulo no dicionário", () => {
    for (const routine of ROUTINES) {
      const [section, key] = ROUTINE_LABEL_KEYS[routine].split(".");
      const bloco = (dictionary() as unknown as Record<string, Record<string, string>>)[section!];
      expect(typeof bloco?.[key!], routine).toBe("string");
    }
  });
});

describe("requestRoutine", () => {
  it("entrega a rotina válida a quem executa", async () => {
    const pedidas: string[] = [];
    const resultado = await requestRoutine(
      { routine: "recheck" },
      { runner: { configured: () => true, dispatch: async (r) => { pedidas.push(r); return { ok: true }; } } },
    );
    expect(resultado).toEqual({ ok: true });
    expect(pedidas).toEqual(["recheck"]);
  });

  it("não chama quem executa quando o nome não vale", async () => {
    let chamou = false;
    const resultado = await requestRoutine(
      { routine: "apagar-tudo" },
      { runner: { configured: () => true, dispatch: async () => { chamou = true; return { ok: true }; } } },
    );
    expect(resultado).toEqual({ ok: false, code: "routine_unknown" });
    expect(chamou).toBe(false);
  });

  it("repassa a recusa de quem executa", async () => {
    const resultado = await requestRoutine(
      { routine: "sync" },
      { runner: { configured: () => true, dispatch: async () => ({ ok: false, code: "rejected", status: 403 }) } },
    );
    expect(resultado).toEqual({ ok: false, code: "rejected", status: 403 });
  });

  it("aceita o caminho feliz com a porta mínima", async () => {
    await expect(requestRoutine({ routine: "tudo" }, { runner: aceita })).resolves.toEqual({ ok: true });
  });
});

describe("disparo no GitHub", () => {
  const SEGREDO = "token-de-teste-nao-deve-aparecer";

  it("sem token responde no_token e não toca na rede", async () => {
    let chamadas = 0;
    const runner = githubDispatch({
      token: undefined,
      fetchImpl: async () => { chamadas += 1; return new Response(null, { status: 204 }); },
    });
    expect(runner.configured()).toBe(false);
    await expect(runner.dispatch("sync")).resolves.toEqual({ ok: false, code: "no_token" });
    expect(chamadas).toBe(0);
  });

  it("dispara o workflow da branch padrão com a rotina pedida", async () => {
    let url = "";
    let body: unknown;
    let autorizacao = "";
    const runner = githubDispatch({
      token: SEGREDO,
      repo: "dono/repo",
      fetchImpl: async (input, init) => {
        url = String(input);
        autorizacao = String((init?.headers as Record<string, string>).authorization);
        body = JSON.parse(String(init?.body));
        return new Response(null, { status: 204 });
      },
    });

    await expect(runner.dispatch("termos")).resolves.toEqual({ ok: true });
    expect(url).toBe("https://api.github.com/repos/dono/repo/actions/workflows/varredura.yml/dispatches");
    // `workflow_dispatch` só existe sobre a branch padrão.
    expect(body).toEqual({ ref: "main", inputs: { rotina: "termos" } });
    expect(autorizacao).toContain(SEGREDO);
  });

  it("recusa do GitHub vira código e status, sem corpo nem credencial", async () => {
    const runner = githubDispatch({
      token: SEGREDO,
      fetchImpl: async () => new Response(JSON.stringify({ message: SEGREDO }), { status: 403 }),
    });
    const resultado = await runner.dispatch("rescore");
    expect(resultado).toEqual({ ok: false, code: "rejected", status: 403 });
    expect(JSON.stringify(resultado)).not.toContain(SEGREDO);
  });
});

describe("varredura.yml aceita o pedido", () => {
  const workflow = parse(readFileSync(".github/workflows/varredura.yml", "utf8")) as {
    on: { workflow_dispatch: { inputs: Record<string, { default?: string; options?: string[] }> } };
    jobs: { varrer: { steps: { name?: string; if?: string; run?: string }[] } };
  };

  it("oferece as rotinas e roda tudo por omissão", () => {
    const input = workflow.on.workflow_dispatch.inputs.rotina;
    expect(input?.options).toEqual([...ROUTINES]);
    // Disparo sem escolha não pode significar menos que a execução agendada.
    expect(input?.default).toBe("tudo");
  });

  it("cada passo de trabalho sabe a qual rotina pertence", () => {
    const porNome = new Map(workflow.jobs.varrer.steps.filter((s) => s.name).map((s) => [s.name!, s]));
    const esperado: [string, string][] = [
      ["Sincronizar as fontes", "sync"],
      ["Buscar os termos salvos", "termos"],
      ["Enfileirar captura", "termos"],
      ["Capturar", "termos"],
      ["Enfileirar reconferência", "recheck"],
      ["Reconferir", "recheck"],
      ["Repontuar a fila", "rescore"],
      ["Pontuar as vagas novas", "rescore"],
    ];
    for (const [nome, rotina] of esperado) {
      const condicao = porNome.get(nome)?.if ?? "";
      expect(condicao, nome).toContain(`inputs.rotina == '${rotina}'`);
      // Execução agendada não tem input: ela roda tudo.
      expect(condicao, nome).toContain("github.event_name != 'workflow_dispatch'");
      expect(condicao, nome).toContain("inputs.rotina == 'tudo'");
    }
  });
});
