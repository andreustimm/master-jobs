import type { DispatchRequest, DispatchResult, WorkflowDispatchPort } from "../ports.ts";

/**
 * Os insumos do `workflow_dispatch`, que só aceita string. A rotina inteira de
 * antes continua saindo como `{ rotina }`, sem chave nova. Uma execução de
 * `source_run` sai como a rotina `execucao`, que nenhum passo da varredura
 * inteira casa: o workflow roda só aquela execução (`acao` diz se é captura
 * ou verificação) e nada mais.
 */
function inputsOf(request: DispatchRequest): Record<string, string> {
  if (request.run == null) return { rotina: request.routine };
  const inputs: Record<string, string> = {
    rotina: "execucao",
    acao: request.routine === "recheck" ? "recheck" : "sync",
    execucao: String(request.run),
  };
  if (request.source) inputs.fonte = request.source;
  return inputs;
}

/**
 * Quem executa hoje: o workflow `varredura.yml` no GitHub Actions.
 *
 * O runner precisa de minutos e de tempo — o sync levou 18 a 27 minutos na
 * última medição — e a função da Vercel tem 30 segundos. Repositório público,
 * então minutos são grátis; é por isso que a cron do projeto mora lá e não num
 * plano pago.
 *
 * O token vem de variável de ambiente e o **nome** da variável é o que este
 * módulo conhece (regra 16): nada de credencial em banco, e nada de credencial
 * em texto de erro. `workflow_dispatch` exige `actions:write` e só existe sobre
 * a branch padrão, que aqui é `main`.
 */

const WORKFLOW = "varredura.yml";
const TOKEN_ENV = "GITHUB_DISPATCH_TOKEN";
const REPO_ENV = "GITHUB_DISPATCH_REPO";
const DEFAULT_REPO = "andreustimm/master-jobs";

export type GithubDispatchOptions = {
  /** Injetável para o teste não falar com a rede. */
  fetchImpl?: typeof fetch;
  token?: string | undefined;
  repo?: string | undefined;
};

export function githubDispatch(options: GithubDispatchOptions = {}): WorkflowDispatchPort {
  const token = () => options.token ?? process.env[TOKEN_ENV];
  const repo = () => options.repo ?? process.env[REPO_ENV] ?? DEFAULT_REPO;
  const send = options.fetchImpl ?? fetch;

  return {
    configured(): boolean {
      return Boolean(token());
    },

    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      const credential = token();
      // Sem token o pedido não sai, e isso não é erro de sistema: a varredura
      // diária continua rodando pela cron. A tela diz o que falta configurar.
      if (!credential) return { ok: false, code: "no_token" };

      const response = await send(
        `https://api.github.com/repos/${repo()}/actions/workflows/${WORKFLOW}/dispatches`,
        {
          method: "POST",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${credential}`,
            "content-type": "application/json",
            "x-github-api-version": "2022-11-28",
          },
          body: JSON.stringify({ ref: "main", inputs: inputsOf(request) }),
        },
      );

      // 204 é o aceite documentado. Corpo de resposta não entra em log nem em
      // mensagem: numa configuração errada ele pode ecoar o que foi enviado.
      return response.ok ? { ok: true } : { ok: false, code: "rejected", status: response.status };
    },
  };
}
