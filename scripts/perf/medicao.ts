/**
 * Regras puras da medição de produção (#221): percentis, leitura do
 * `x-vercel-id` e agregação das linhas `perf` do log. Sem rede, sem relógio,
 * sem ambiente — o comando em `medir-producao.ts` só coleta e chama isto.
 *
 * O que sai daqui é número, nome de estágio, rota SEM query string e região.
 * Nunca o valor de um filtro, o termo buscado, o cookie ou a mensagem bruta do
 * log: a URL de `/jobs` carrega o filtro da pessoa, e o relatório é feito para
 * ser colado numa issue.
 */

export type Resumo = { n: number; p50: number; p95: number; min: number; max: number };

/**
 * Percentil pelo posto mais próximo: devolve sempre um valor que foi medido.
 * Interpolar inventaria uma latência que nenhuma requisição teve; com dez
 * amostras o p95 é o maior valor, e o relatório diz quantas foram.
 */
export function percentil(valores: readonly number[], p: number): number {
  if (valores.length === 0) throw new Error("percentil de lista vazia");
  if (!(p > 0 && p <= 100)) throw new Error(`percentil fora de (0, 100]: ${p}`);
  const ordenados = [...valores].sort((a, b) => a - b);
  const posto = Math.ceil((p / 100) * ordenados.length);
  return ordenados[posto - 1]!;
}

const arredonda = (ms: number) => Math.round(ms * 10) / 10;

export function resumir(valores: readonly number[]): Resumo | null {
  if (valores.length === 0) return null;
  return {
    n: valores.length,
    p50: arredonda(percentil(valores, 50)),
    p95: arredonda(percentil(valores, 95)),
    min: arredonda(Math.min(...valores)),
    max: arredonda(Math.max(...valores)),
  };
}

/** Nome de região da Vercel (`gru1`, `iad1`): o que não tiver essa forma não entra no relatório. */
const REGIAO = /^[a-z]{3}\d$/;

/**
 * `x-vercel-id` tem a borda de quem pediu no primeiro trecho e, quando uma
 * função rodou, a região dela no segundo: `gru1::gru1::abc`. Resposta de CDN
 * (arquivo estático) tem só dois trechos, `gru1::abc`, e nenhuma função.
 * Ler o primeiro trecho como região da função foi o erro que escondeu a
 * `iad1` longe do banco.
 */
export function regiaoDaResposta(vercelId: string | null | undefined): { borda: string; funcao: string | null } | null {
  if (!vercelId) return null;
  const partes = vercelId.split("::");
  const valido = (s: string | undefined) => (s !== undefined && REGIAO.test(s) ? s : null);
  const borda = valido(partes[0]);
  if (!borda) return null;
  return { borda, funcao: partes.length >= 3 ? valido(partes[1]) : null };
}

export type LinhaPerf = {
  rota: string;
  totalMs: number;
  regiao: string | null;
  estagios: Record<string, number>;
};

const numeroFinito = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * Lê a linha que `registrarTempo` escreve (`timingLogLine`). Qualquer outra
 * mensagem devolve `null` — inclusive uma que mencione "perf" por acaso. A
 * rota perde a query string e o estágio precisa ter nome de identificador:
 * nada que venha do log entra no relatório sem passar por aqui.
 */
export function lerLinhaPerf(mensagem: string): LinhaPerf | null {
  const inicio = mensagem.indexOf('{"perf"');
  if (inicio < 0) return null;
  let bruto: unknown;
  try {
    bruto = JSON.parse(mensagem.slice(inicio));
  } catch {
    return null;
  }
  if (typeof bruto !== "object" || bruto === null) return null;
  const { perf, totalMs, region, stages } = bruto as Record<string, unknown>;
  if (typeof perf !== "string" || !perf.startsWith("/") || !numeroFinito(totalMs)) return null;
  if (typeof stages !== "object" || stages === null || Array.isArray(stages)) return null;
  const estagios: Record<string, number> = {};
  for (const [nome, ms] of Object.entries(stages)) {
    if (!/^[a-z][a-z_]{0,31}$/.test(nome) || !numeroFinito(ms)) return null;
    estagios[nome] = ms;
  }
  return {
    rota: perf.split(/[?#]/)[0]!,
    totalMs,
    regiao: typeof region === "string" && REGIAO.test(region) ? region : null,
    estagios,
  };
}

export type AgregadoPerf = {
  rota: string;
  total: Resumo;
  regioes: string[];
  estagios: Record<string, Resumo>;
};

export function agregarLinhasPerf(linhas: readonly LinhaPerf[]): AgregadoPerf[] {
  const porRota = new Map<string, LinhaPerf[]>();
  for (const linha of linhas) porRota.set(linha.rota, [...(porRota.get(linha.rota) ?? []), linha]);
  return [...porRota.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rota, grupo]) => {
      const nomes = [...new Set(grupo.flatMap((l) => Object.keys(l.estagios)))];
      const estagios: Record<string, Resumo> = {};
      for (const nome of nomes) {
        const valores = grupo.flatMap((l) => l.estagios[nome] ?? []);
        estagios[nome] = resumir(valores)!;
      }
      return {
        rota,
        total: resumir(grupo.map((l) => l.totalMs))!,
        regioes: [...new Set(grupo.flatMap((l) => (l.regiao ? [l.regiao] : [])))].sort(),
        estagios,
      };
    });
}

export type Cenario = { nome: string; caminho: string; sessao: boolean };

/**
 * Confere a sessão antes de medir, numa rota autenticada SEM fronteira de
 * carregamento. `/jobs` tem `loading.tsx` (#217): o esboço compromete a
 * resposta em 200 antes de a página decidir, e a sessão vencida vira
 * redirecionamento no cliente — o 307 para `/login` que denunciava o cookie
 * vencido não aparece mais ali. `/account` ainda responde 307.
 */
export const CENARIO_VALIDA_SESSAO: Cenario = { nome: "sessão", caminho: "/account", sessao: true };

/**
 * Os cenários medidos. Sem sessão só existem rotas que não expõem nada: o
 * `/login` (renderiza e toca o banco uma vez, bom sinal de função fria), o
 * estático `/offline.html` (CDN, sem função) e `/jobs` sem cookie, que o proxy
 * responde com 307 sem renderizar. Com sessão, `/jobs` com os filtros comuns.
 */
export function montarCenarios(opcoes: { comSessao: boolean; termo: string }): Cenario[] {
  const publicos: Cenario[] = [
    { nome: "login (função + 1 consulta)", caminho: "/login", sessao: false },
    { nome: "offline.html (estático)", caminho: "/offline.html", sessao: false },
    { nome: "jobs sem cookie (proxy 307)", caminho: "/jobs", sessao: false },
  ];
  if (!opcoes.comSessao) return publicos;
  const termo = encodeURIComponent(opcoes.termo);
  return [
    ...publicos,
    { nome: "jobs padrão", caminho: "/jobs", sessao: true },
    { nome: "jobs fit=45", caminho: "/jobs?fit=45", sessao: true },
    { nome: "jobs fit=45 + remoto", caminho: "/jobs?fit=45&workMode=remote", sessao: true },
    { nome: "jobs fit=45 + termo", caminho: `/jobs?fit=45&q=${termo}`, sessao: true },
  ];
}

/**
 * O cookie só sai por HTTPS, ou para o próprio computador. Mandá-lo em texto
 * claro para outro host seria entregar a sessão a quem estiver no caminho.
 */
export function destinoAceitaCookie(base: URL): boolean {
  if (base.protocol === "https:") return true;
  return base.protocol === "http:" && (base.hostname === "127.0.0.1" || base.hostname === "localhost");
}

/** Valor de cookie com `;`, vírgula, espaço ou quebra de linha injetaria outro cabeçalho ou outro cookie. */
export function cookieValido(valor: string): boolean {
  return /^[A-Za-z0-9._~+/=-]{16,512}$/.test(valor);
}
