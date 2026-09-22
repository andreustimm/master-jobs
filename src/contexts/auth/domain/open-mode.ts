/**
 * Quando o modo aberto pode valer. Função pura sobre o ambiente recebido.
 *
 * `JHO_AUTH_MODE=open` sintetiza uma sessão de admin+candidato para qualquer
 * requisição: currículo, funil, piso e o export inteiro. É ferramenta de
 * desenvolvimento local, e num endereço público é o vazamento todo. A
 * documentação de deploy já proibia a variável em produção; a proibição agora
 * é do código, porque variável Sensitive na Vercel não se relê depois de
 * gravada, e ninguém confere a tempo o que foi cadastrado.
 *
 * **Lista de permissão, não de proibição.** O modo aberto só vale quando o
 * processo se declara local (`JHO_ENV=local`) ou não se declara deployment
 * nenhum — nem `JHO_ENV`, nem `VERCEL_ENV`, nem `VERCEL`. Produção, preview,
 * staging, dev e qualquer valor inventado depois recusam: o valor desconhecido
 * cai no lado seguro por omissão, e não por uma lista que alguém esqueceu de
 * aumentar.
 *
 * Recusar aqui não derruba o sistema: o pedido de modo aberto é ignorado e a
 * autenticação continua exigida, como se a variável não existisse. Quem pediu
 * menos segurança recebe a mesma de sempre.
 *
 * Mora no domínio, e não em `app/session.ts`, porque o `proxy.ts` também
 * decide sobre o modo aberto e não pode puxar a composição do banco para a
 * borda. Uma regra, dois chamadores, nenhuma cópia.
 */
export type AuthEnvironment = Readonly<Record<string, string | undefined>>;

/** Ambientes em que o modo aberto é aceito. Só a máquina de quem desenvolve. */
const OPEN_MODE_ENVIRONMENTS: readonly string[] = ["local"];

export function openModeRequested(env: AuthEnvironment): boolean {
  return env.JHO_AUTH_MODE === "open";
}

export function openModeAllowedIn(env: AuthEnvironment): boolean {
  // `VERCEL=1` existe em build e runtime da Vercel mesmo quando `VERCEL_ENV`
  // não chega a um script. Presença dele é prova de deployment.
  if (env.VERCEL !== undefined && env.VERCEL !== "") return false;
  // As duas declarações são conferidas, e não a primeira que existir: na
  // ingestão `JHO_ENV` tem precedência sobre `VERCEL_ENV`, mas aqui precedência
  // abriria um furo — `JHO_ENV=local` num deployment com `VERCEL_ENV=production`
  // não pode transformá-lo em máquina de desenvolvimento.
  return [env.JHO_ENV, env.VERCEL_ENV].every(
    (declared) =>
      declared === undefined ||
      declared === "" ||
      OPEN_MODE_ENVIRONMENTS.includes(declared.trim().toLowerCase()),
  );
}

/** O modo aberto vale: foi pedido E o ambiente o admite. */
export function openModeActive(env: AuthEnvironment): boolean {
  return openModeRequested(env) && openModeAllowedIn(env);
}
