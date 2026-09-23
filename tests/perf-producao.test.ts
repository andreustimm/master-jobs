import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agregarLinhasPerf,
  CENARIO_VALIDA_SESSAO,
  cookieValido,
  destinoAceitaCookie,
  lerLinhaPerf,
  montarCenarios,
  percentil,
  regiaoDaResposta,
  resumir,
  type LinhaPerf,
} from "../scripts/perf/medicao.ts";

// #221: as regras puras da medição de produção. O que o relatório imprime vai
// para uma issue, então o que importa aqui é o que NÃO sai dele.
describe("medição de produção", () => {
  it("percentil pelo posto mais próximo devolve sempre um valor medido", () => {
    const dez = [10, 20, 30, 40, 50, 60, 70, 80, 90, 1000];
    expect(percentil(dez, 50)).toBe(50);
    expect(percentil(dez, 95)).toBe(1000);
    expect(percentil([7], 95)).toBe(7);
    expect(percentil([3, 1, 2], 50)).toBe(2);
    expect(() => percentil([], 50)).toThrow();
    expect(() => percentil([1], 0)).toThrow();
  });

  it("resumo arredonda a um decimal e não inventa amostra", () => {
    expect(resumir([])).toBeNull();
    expect(resumir([1.26, 2.24, 100])).toEqual({ n: 3, p50: 2.2, p95: 100, min: 1.3, max: 100 });
  });

  it("x-vercel-id: a função é o segundo trecho, e estático não tem função", () => {
    expect(regiaoDaResposta("gru1::gru1::hrglv-1790112251799-2dfc8d78450c")).toEqual({ borda: "gru1", funcao: "gru1" });
    expect(regiaoDaResposta("gru1::iad1::abc")).toEqual({ borda: "gru1", funcao: "iad1" });
    expect(regiaoDaResposta("gru1::92hnw-1790112324774-9fcb5de95158")).toEqual({ borda: "gru1", funcao: null });
    expect(regiaoDaResposta(null)).toBeNull();
    expect(regiaoDaResposta("<script>::gru1::x")).toBeNull();
  });

  it("lê a linha de registrarTempo e tira a query string da rota", () => {
    const linha = lerLinhaPerf(
      '{"perf":"/jobs?q=segredo","totalMs":5291.3,"region":"gru1","stages":{"auth":168.5,"prelude":71,"board":1571,"facets":3479.2,"tail":0.1}}',
    );
    expect(linha).toEqual({
      rota: "/jobs",
      totalMs: 5291.3,
      regiao: "gru1",
      estagios: { auth: 168.5, prelude: 71, board: 1571, facets: 3479.2, tail: 0.1 },
    });
    expect(JSON.stringify(linha)).not.toContain("segredo");
  });

  it("recusa qualquer mensagem que não seja a linha perf", () => {
    expect(lerLinhaPerf("GET /jobs 200")).toBeNull();
    expect(lerLinhaPerf('{"perf":"/jobs","totalMs":"lento","stages":{}}')).toBeNull();
    expect(lerLinhaPerf('{"perf":"jobs","totalMs":1,"stages":{}}')).toBeNull();
    expect(lerLinhaPerf('{"perf":"/jobs","totalMs":1,"stages":{"email=a@b.c":1}}')).toBeNull();
    expect(lerLinhaPerf('{"perf":"/jobs","totalMs":1,"stages":[1]}')).toBeNull();
    expect(lerLinhaPerf('{"perf":"/jobs","totalMs":1,"stages":{"__proto__":1}}')).toBeNull();
    expect(lerLinhaPerf('{"perf":"/jobs"')).toBeNull();
    expect(lerLinhaPerf('{"perf":"/jobs","totalMs":1,"region":"x y","stages":{}}')?.regiao).toBeNull();
  });

  it("agrega por rota e por estágio, só com números", () => {
    const linhas: LinhaPerf[] = [
      { rota: "/jobs", totalMs: 100, regiao: "gru1", estagios: { auth: 10, board: 50 } },
      { rota: "/jobs", totalMs: 300, regiao: "gru1", estagios: { auth: 30, board: 150, queue: 5 } },
      { rota: "/", totalMs: 80, regiao: null, estagios: { cockpit: 60 } },
    ];
    const [raiz, jobs] = agregarLinhasPerf(linhas);
    expect(raiz!.rota).toBe("/");
    expect(raiz!.regioes).toEqual([]);
    expect(jobs!.total).toEqual({ n: 2, p50: 100, p95: 300, min: 100, max: 300 });
    expect(jobs!.estagios.queue).toEqual({ n: 1, p50: 5, p95: 5, min: 5, max: 5 });
    expect(jobs!.regioes).toEqual(["gru1"]);
  });

  it("sem sessão só mede rotas públicas; com sessão, os filtros comuns de /jobs", () => {
    const publicos = montarCenarios({ comSessao: false, termo: "typescript" });
    expect(publicos.every((c) => !c.sessao)).toBe(true);
    const todos = montarCenarios({ comSessao: true, termo: "c++ & go" });
    expect(todos.filter((c) => c.sessao).map((c) => c.caminho)).toEqual([
      "/jobs",
      "/jobs?fit=45",
      "/jobs?fit=45&workMode=remote",
      "/jobs?fit=45&q=c%2B%2B%20%26%20go",
    ]);
    // O nome do cenário vai para o relatório; o termo nunca.
    expect(todos.map((c) => c.nome).join(" ")).not.toContain("c++");
  });

  it("confere a sessão numa rota autenticada sem fronteira de carregamento", () => {
    // Com `loading.tsx` a sessão vencida vira 200 + redirecionamento no
    // cliente, e o 307 que a denuncia some (#217).
    expect(CENARIO_VALIDA_SESSAO.sessao).toBe(true);
    const segmento = CENARIO_VALIDA_SESSAO.caminho.slice(1);
    expect(existsSync(`app/${segmento}/page.tsx`)).toBe(true);
    expect(existsSync(`app/${segmento}/loading.tsx`)).toBe(false);
    expect(existsSync("app/loading.tsx")).toBe(false);
  });

  it("o cookie só sai por HTTPS ou para a própria máquina, e sem caractere de cabeçalho", () => {
    expect(destinoAceitaCookie(new URL("https://jobs.mastertimm.com.br"))).toBe(true);
    expect(destinoAceitaCookie(new URL("http://127.0.0.1:3000"))).toBe(true);
    expect(destinoAceitaCookie(new URL("http://localhost:3000"))).toBe(true);
    expect(destinoAceitaCookie(new URL("http://jobs.mastertimm.com.br"))).toBe(false);
    expect(cookieValido("Zq3Jd0aXc9w8y7v6u5t4s3r2q1p0o9n8m7l6k5j4i3h")).toBe(true);
    expect(cookieValido("abc")).toBe(false);
    expect(cookieValido("Zq3Jd0aXc9w8y7v6u5t4; admin=1")).toBe(false);
    expect(cookieValido("Zq3Jd0aXc9w8y7v6u5t4\r\nX-Evil: 1")).toBe(false);
  });
});
