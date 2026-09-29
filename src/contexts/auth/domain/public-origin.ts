/**
 * A origem pública (esquema + host) usada para montar o link de recuperação
 * de senha.
 *
 * **Nunca confia no cabeçalho `Host` da requisição em deployment.** Atrás de
 * qualquer proxy — Vercel, Fly.io, o que vier depois —, quem manda a
 * requisição controla esse cabeçalho. Um link de recuperação montado a partir
 * dele é host poisoning: o e-mail sai do remetente certo, mas o link aponta
 * para o domínio de quem atacou, e o token de uso único (G18) vaza para lá no
 * clique de quem está recuperando a senha de verdade (G17).
 *
 * `JHO_PUBLIC_URL` é a fonte confiável, cadastrada uma vez por deployment
 * (Vercel Production/Preview e o plano B no Fly —
 * `docs/engineering/deploy.md`). Sem ela, e fora da máquina do dono, a
 * função falha fechado: devolve `null`, e quem chama não constrói link
 * nenhum a partir do `Host` do cliente — o mesmo espírito de
 * `JHO_STORAGE_DRIVER` desconhecido (ADR 0029) e de `sslmode` fora da lista de
 * permissão (`src/core/db/config.ts`).
 */
import { isLocalProcess, type AuthEnvironment } from "./open-mode.ts";

export type RequestOrigin = {
  /** `headers().get("host")` — não confiável fora da máquina local. */
  readonly host: string | null;
  readonly proto: "http" | "https";
};

/** `origin` de uma URL válida (esquema + host, sem caminho); `null` se malformada. */
function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * `null` significa "não construa o link" — nunca uma string vazia
 * concatenada, que produziria um link relativo e ainda assim atravessaria a
 * checagem de tipos.
 *
 * `JHO_PUBLIC_URL` configurada e malformada também devolve `null`: nunca cai
 * de volta para o `Host` do cliente só porque a variável está quebrada.
 */
export function resolvePublicOrigin(env: AuthEnvironment, request: RequestOrigin): string | null {
  const configured = env.JHO_PUBLIC_URL?.trim();
  if (configured) return originOf(configured);
  if (isLocalProcess(env)) return `${request.proto}://${request.host ?? "127.0.0.1:3000"}`;
  return null;
}
