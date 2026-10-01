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
 * **Ordem de resolução:**
 * 1. `JHO_PUBLIC_URL`, quando configurada e válida — a fonte confiável,
 *    cadastrada por deployment (`docs/engineering/deploy.md`). Malformada,
 *    falha fechado imediatamente: nunca cai para os ramos abaixo só porque a
 *    variável está quebrada.
 * 2. **Na Vercel**, sem `JHO_PUBLIC_URL` cadastrada: `VERCEL_ENV` e
 *    `VERCEL_PROJECT_PRODUCTION_URL`/`VERCEL_BRANCH_URL`/`VERCEL_URL` são
 *    variáveis de **sistema** da plataforma — a build/runtime as recebe da
 *    própria Vercel, nunca do cliente, ao contrário do `Host` da requisição.
 *    Em preview, `VERCEL_BRANCH_URL` (estável por branch) vem antes de
 *    `VERCEL_URL` (único por deployment, muda a cada push). Isso é o que faz
 *    a recuperação de senha continuar funcionando em produção e preview sem
 *    exigir cadastro manual antes desta função existir.
 * 3. **Na máquina do dono** (`isLocalProcess`: `JHO_ENV=local` declarado),
 *    sem nenhuma das duas acima: o `Host` da requisição, como sempre — é
 *    loopback, e só o próprio dono alcança o processo.
 * 4. Nenhuma das três: falha fechada. É o caso do plano B no Fly.io sem
 *    `JHO_PUBLIC_URL` cadastrada — o Fly não declara `VERCEL*`, e o runbook
 *    exige a variável antes do primeiro failover — e o de qualquer processo
 *    que não declara ambiente nenhum (#378): ausência não é prova de local.
 */
import { isLocalProcess, type AuthEnvironment } from "./open-mode.ts";

export type RequestOrigin = {
  /** `headers().get("host")` — não confiável fora da máquina local. */
  readonly host: string | null;
  readonly proto: "http" | "https";
};

/**
 * Primeiro valor de fato presente. `??` só cai para o próximo em `null`/
 * `undefined` — uma variável de sistema declarada como string vazia (regra
 * 17) não pode se passar por "presente" e vencer `VERCEL_URL`.
 */
function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) if (value?.trim()) return value;
  return undefined;
}

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
 */
export function resolvePublicOrigin(env: AuthEnvironment, request: RequestOrigin): string | null {
  const configured = env.JHO_PUBLIC_URL?.trim();
  if (configured) return originOf(configured);

  // `VERCEL` presença = a mesma prova de deployment que `isLocalProcess` usa.
  // As duas variáveis de host abaixo só existem porque a Vercel as escreve no
  // ambiente da função — a pessoa que faz a requisição não as controla.
  if (env.VERCEL !== undefined && env.VERCEL !== "") {
    const host =
      env.VERCEL_ENV === "production"
        ? env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
        : firstNonEmpty(env.VERCEL_BRANCH_URL, env.VERCEL_URL);
    if (host) return originOf(`https://${host}`);
    // Declarado como Vercel, mas sem a variável de host esperada para este
    // VERCEL_ENV: nunca cai para o Host do cliente (isLocalProcess já seria
    // `false` aqui de qualquer forma) — segue direto para a falha fechada.
    return null;
  }

  if (isLocalProcess(env)) return `${request.proto}://${request.host ?? "127.0.0.1:3000"}`;

  return null;
}
