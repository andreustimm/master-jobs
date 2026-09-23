/**
 * Mede a produção de fora e lê os estágios de dentro (#221).
 *
 *   pnpm perf:producao                       # rotas públicas, sem sessão
 *   JHO_PERF_SESSION=<cookie> pnpm perf:producao --amostras 20
 *   pnpm perf:producao --logs --since 1h     # agrega as linhas `perf` do log da Vercel
 *
 * Só lê: GET em páginas e leitura de log. Nada é gravado em produção, e o
 * cookie nunca sai do processo — nem para disco, nem para a saída, nem para
 * erro. Procedimento e leitura dos números em
 * `docs/engineering/performance-buscas.md` → "Medir a produção".
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Agent, request } from "node:https";
import { request as requestHttp, Agent as AgentHttp } from "node:http";
import { parseArgs } from "node:util";
import {
  agregarLinhasPerf,
  CENARIO_VALIDA_SESSAO,
  cookieValido,
  destinoAceitaCookie,
  lerLinhaPerf,
  montarCenarios,
  regiaoDaResposta,
  resumir,
  type Cenario,
  type LinhaPerf,
} from "./medicao.ts";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "https://jobs.mastertimm.com.br" },
    amostras: { type: "string", default: "10" },
    rodadas: { type: "string", default: "1" },
    pausa: { type: "string", default: "0" },
    logs: { type: "boolean", default: false },
    since: { type: "string", default: "1h" },
    limit: { type: "string", default: "500" },
    projeto: { type: "string", default: "master-jobs" },
    json: { type: "string" },
  },
});

function inteiro(nome: string, valor: string | undefined, minimo: number): number {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < minimo) throw new Error(`--${nome} precisa ser inteiro >= ${minimo}`);
  return n;
}

type Medida = { ttfbMs: number; totalMs: number; status: number; vercelId: string | null; cache: string | null; destino: string | null };

/**
 * Uma requisição, sem seguir redirecionamento. TTFB é até o cabeçalho chegar
 * — é o que o servidor gastou mais a rede; `total` inclui o corpo. A conexão
 * é reaproveitada entre amostras (keep-alive), como no navegador: sem isso o
 * número mediria o aperto de mão TLS, não a função.
 */
function medir(base: URL, cenario: Cenario, cookie: string | null, agente: AgentHttp): Promise<Medida> {
  const url = new URL(cenario.caminho, base);
  const enviar = url.protocol === "https:" ? request : requestHttp;
  const cabecalhos: Record<string, string> = { "user-agent": "master-jobs-perf/1", accept: "text/html" };
  if (cenario.sessao && cookie) cabecalhos.cookie = `jho_session=${cookie}`;
  return new Promise((resolve, reject) => {
    const inicio = performance.now();
    const req = enviar(url, { method: "GET", headers: cabecalhos, agent: agente }, (res) => {
      const ttfbMs = performance.now() - inicio;
      res.on("data", () => {});
      res.on("end", () => {
        const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
        const location = um(res.headers.location);
        resolve({
          ttfbMs,
          totalMs: performance.now() - inicio,
          status: res.statusCode ?? 0,
          vercelId: um(res.headers["x-vercel-id"]),
          cache: um(res.headers["x-vercel-cache"]),
          // Só o caminho do destino: a query de um redirect não interessa aqui.
          destino: location ? new URL(location, url).pathname : null,
        });
      });
      res.on("error", reject);
    });
    req.setTimeout(60_000, () => req.destroy(new Error("tempo esgotado (60 s)")));
    req.on("error", reject);
    req.end();
  });
}

const AQUECE_CONEXAO: Cenario = { nome: "conexão", caminho: "/offline.html", sessao: false };
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (ms: number | undefined) => (ms === undefined ? "—" : ms.toFixed(0));

async function medirRotas() {
  const base = new URL(values.base!);
  const amostras = inteiro("amostras", values.amostras, 1);
  const rodadas = inteiro("rodadas", values.rodadas, 1);
  const pausaS = inteiro("pausa", values.pausa, 0);
  const cookie = process.env.JHO_PERF_SESSION?.trim() || null;
  if (cookie !== null) {
    if (!cookieValido(cookie)) throw new Error("JHO_PERF_SESSION não parece um valor de cookie jho_session (sem ';', espaço ou quebra de linha).");
    if (!destinoAceitaCookie(base)) throw new Error("O cookie só é enviado por HTTPS ou para 127.0.0.1/localhost.");
  }
  // O termo é filtro da pessoa quando vem dela: vale na requisição, nunca na saída.
  const termo = process.env.JHO_PERF_TERMO?.trim() || "typescript";
  const cenarios = montarCenarios({ comSessao: cookie !== null, termo });
  const agente = base.protocol === "https:" ? new Agent({ keepAlive: true, maxSockets: 1 }) : new AgentHttp({ keepAlive: true, maxSockets: 1 });

  const primeiras = new Map<string, number[]>();
  const quentes = new Map<string, number[]>();
  const totais = new Map<string, number[]>();
  const regioes = new Map<string, string[]>();
  const status = new Map<string, string[]>();
  const anota = <T>(m: Map<string, T[]>, k: string, v: T) => void (m.get(k) ?? m.set(k, []).get(k)!).push(v);

  // No `finally`: com keep-alive, um erro no meio deixaria o socket aberto e o
  // processo pendurado até o servidor fechar a conexão.
  try {
    for (let rodada = 1; rodada <= rodadas; rodada++) {
      if (rodada > 1 && pausaS > 0) {
        console.error(`rodada ${rodada}/${rodadas}: aguardando ${pausaS} s ociosos…`);
        await esperar(pausaS * 1000);
      }
      // Abre a conexão num arquivo estático, fora da conta: sem isto a primeira
      // amostra da rodada somaria DNS e aperto de mão TLS ao tempo da função.
      await medir(base, AQUECE_CONEXAO, null, agente);
      for (const cenario of cenarios) {
        for (let i = 0; i < amostras; i++) {
          const m = await medir(base, cenario, cookie, agente);
          if (cenario.sessao && m.status >= 300 && m.status < 400 && m.destino === "/login") {
            throw new Error("A sessão foi recusada (redirecionou para /login): cookie vencido ou inválido. Nada foi gravado.");
          }
          anota(i === 0 ? primeiras : quentes, cenario.nome, m.ttfbMs);
          anota(totais, cenario.nome, m.totalMs);
          const r = regiaoDaResposta(m.vercelId);
          anota(regioes, cenario.nome, r ? `${r.borda}::${r.funcao ?? "sem função"}` : "?");
          anota(status, cenario.nome, `${m.status}${m.cache ? ` ${m.cache}` : ""}`);
        }
      }
      // Depois das amostras, e não antes: conferir antes aqueceria a função e a
      // "primeira" deixaria de medir a partida a frio. Nada é gravado até o fim.
      if (cookie !== null) {
        const sessao = await medir(base, CENARIO_VALIDA_SESSAO, cookie, agente);
        if (sessao.status >= 300 && sessao.status < 400 && sessao.destino === "/login") {
          throw new Error("A sessão foi recusada (redirecionou para /login): cookie vencido ou inválido. Nada foi gravado.");
        }
      }
    }
  } finally {
    agente.destroy();
  }

  const linhas = cenarios.map((c) => ({
    cenario: c.nome,
    sessao: c.sessao,
    primeira: resumir(primeiras.get(c.nome) ?? []),
    quente: resumir(quentes.get(c.nome) ?? []),
    total: resumir(totais.get(c.nome) ?? []),
    regiao: [...new Set(regioes.get(c.nome))],
    status: [...new Set(status.get(c.nome))],
  }));

  const quando = new Date().toISOString();
  console.log(`\nTTFB em ms — ${base.origin}, ${quando}, ${rodadas} rodada(s) × ${amostras} amostra(s)`);
  console.log("'primeira' = 1ª requisição do cenário na rodada (fria só se a instância estava ociosa); 'quente' = as seguintes.\n");
  console.log("| cenário | primeira p50 | primeira max | quente n | quente p50 | quente p95 | total p50 | borda::função | status |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---|---|");
  for (const l of linhas) {
    console.log(
      `| ${l.cenario} | ${fmt(l.primeira?.p50)} | ${fmt(l.primeira?.max)} | ${l.quente?.n ?? 0} | ${fmt(l.quente?.p50)} | ${fmt(l.quente?.p95)} | ${fmt(l.total?.p50)} | ${l.regiao.join(", ")} | ${l.status.join(", ")} |`,
    );
  }
  if (cookie === null) console.log("\nSem JHO_PERF_SESSION: só rotas públicas. Ver docs/engineering/performance-buscas.md.");
  return { base: base.origin, quando, rodadas, amostras, cenarios: linhas };
}

/**
 * Lê o log da produção pela CLI da Vercel e fica SÓ com as linhas `perf`,
 * relidas por `lerLinhaPerf`. A mensagem bruta, o caminho da requisição e
 * qualquer outro campo do log nunca são impressos.
 */
function lerLogs() {
  const saida = execFileSync(
    "vercel",
    [
      "logs",
      "--project", values.projeto!,
      "--environment", "production",
      "--query", "perf",
      "--since", values.since!,
      "--limit", String(inteiro("limit", values.limit, 1)),
      "--json",
      "--non-interactive",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], timeout: 120_000 },
  );
  const linhas: LinhaPerf[] = [];
  const implantacoes = new Set<string>();
  const instantes: number[] = [];
  for (const bruta of saida.split("\n")) {
    if (!bruta.startsWith("{")) continue;
    let registro: { message?: unknown; deploymentId?: unknown; timestamp?: unknown };
    try {
      registro = JSON.parse(bruta);
    } catch {
      continue;
    }
    const linha = typeof registro.message === "string" ? lerLinhaPerf(registro.message) : null;
    if (!linha) continue;
    linhas.push(linha);
    if (typeof registro.deploymentId === "string" && /^dpl_[A-Za-z0-9]+$/.test(registro.deploymentId)) implantacoes.add(registro.deploymentId);
    if (typeof registro.timestamp === "number" && Number.isFinite(registro.timestamp)) instantes.push(registro.timestamp);
  }
  const agregado = agregarLinhasPerf(linhas);
  const janela = instantes.length
    ? `${new Date(Math.min(...instantes)).toISOString()} → ${new Date(Math.max(...instantes)).toISOString()}`
    : "—";
  console.log(`\nLinhas perf no log de produção (--since ${values.since}): ${linhas.length}; janela ${janela}; implantações: ${[...implantacoes].join(", ") || "—"}`);
  console.log("Uma linha só existe se a leitura passou de 1 s, ou sempre com JHO_PERF_LOG=1: sem ela, a amostra é enviesada para as lentas.\n");
  for (const a of agregado) {
    console.log(`${a.rota} — n=${a.total.n}, região ${a.regioes.join(", ") || "?"}, total p50 ${fmt(a.total.p50)} p95 ${fmt(a.total.p95)} max ${fmt(a.total.max)} ms`);
    console.log("| estágio | n | p50 | p95 | max |");
    console.log("|---|---:|---:|---:|---:|");
    for (const [nome, r] of Object.entries(a.estagios)) console.log(`| ${nome} | ${r.n} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.max)} |`);
    console.log("");
  }
  return { since: values.since, janela, linhas: linhas.length, implantacoes: [...implantacoes], rotas: agregado };
}

try {
  const relatorio = values.logs ? lerLogs() : await medirRotas();
  if (values.json) writeFileSync(values.json, `${JSON.stringify(relatorio, null, 2)}\n`);
} catch (erro) {
  // A mensagem é nossa ou do sistema operacional; nenhuma delas carrega o cookie.
  console.error(`perf:producao falhou: ${erro instanceof Error ? erro.message : String(erro)}`);
  process.exitCode = 1;
}
