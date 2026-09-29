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
 * **Lista de permissão, não de proibição (G27, #378).** O modo aberto só
 * vale quando o processo se declara local — `JHO_ENV=local`, explícito — e
 * nada da Vercel (`VERCEL`, `VERCEL_ENV`) diz o contrário. Produção, preview,
 * staging, dev, qualquer valor inventado depois **e a ausência de declaração**
 * recusam. Até a #378 a ausência contava como "máquina do dono": um deployment
 * em que nenhuma variável chegasse (a Vercel sem as variáveis de sistema, um
 * destino novo que ainda não declara nada) abria o modo aberto, imprimia o
 * link de recuperação no log e devolvia o `Host` do cliente como origem.
 * Ambiente que não diz o que é não é tratado como seguro.
 *
 * A conveniência local vem de declarar, não de omitir: `pnpm dev` declara
 * `JHO_ENV=local` no próprio script e a suíte declara em
 * `tests/support/ingestion-env.ts`. `pnpm jho` e `pnpm start` locais leem o
 * `.env`, que precisa trazer `JHO_ENV=local` para o modo aberto e o mailer
 * de terminal.
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

function present(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

function openModeRequested(env: AuthEnvironment): boolean {
  return env.JHO_AUTH_MODE === "open";
}

/**
 * O processo roda na máquina de quem desenvolve, e não num deployment.
 *
 * Exportada à parte porque não é só o modo aberto que depende disto: o
 * adapter de e-mail só imprime o corpo (com link de recuperação) onde o log é
 * o terminal de quem opera. Uma regra, e não duas listas que divergem.
 */
export function isLocalProcess(env: AuthEnvironment): boolean {
  // `VERCEL=1` existe em build e runtime da Vercel mesmo quando `VERCEL_ENV`
  // não chega a um script. Presença dele é prova de deployment.
  // Qualquer valor não vazio conta, inclusive só espaço: na dúvida, deployment.
  if (present(env.VERCEL)) return false;
  // `VERCEL_ENV` é variável de sistema da Vercel e nunca vale `local`; declarada
  // com qualquer valor, é deployment. Não serve de sinal positivo: aceitá-la
  // abriria um segundo caminho de declaração que ninguém cadastra de propósito.
  // E precedência abriria um furo — `JHO_ENV=local` num deployment com
  // `VERCEL_ENV=production` não pode transformá-lo em máquina de desenvolvimento.
  if (present(env.VERCEL_ENV)) return false;
  // O único sinal positivo: `JHO_ENV` declarado, e declarado `local`. Ausente
  // ou vazio nega — a omissão é o lado seguro.
  const declared = env.JHO_ENV?.trim().toLowerCase();
  return declared !== undefined && OPEN_MODE_ENVIRONMENTS.includes(declared);
}

export function openModeAllowedIn(env: AuthEnvironment): boolean {
  return isLocalProcess(env);
}

/**
 * O modo aberto foi pedido e o ambiente o recusou. Existe para quem opera
 * saber por que `JHO_AUTH_MODE=open` "não pegou": a recusa é silenciosa na
 * resposta (a autenticação continua exigida), e sem aviso a única pista seria
 * uma tela de login inesperada.
 */
export function openModeRefused(env: AuthEnvironment): boolean {
  return openModeRequested(env) && !openModeAllowedIn(env);
}

/** Texto do aviso de recusa, para log de servidor e CLI (não é texto de UI). */
export const OPEN_MODE_REFUSED_WARNING =
  "[auth] JHO_AUTH_MODE=open ignorado: o processo não se declara local. " +
  "Declare JHO_ENV=local (só na sua máquina) para liberar o modo aberto; " +
  "a autenticação continua exigida.";

/** O modo aberto vale: foi pedido E o ambiente o admite. */
export function openModeActive(env: AuthEnvironment): boolean {
  return openModeRequested(env) && openModeAllowedIn(env);
}
