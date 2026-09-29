import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixedClock, resetClock, setClock } from "../src/core/clock.ts";
import { clientKey, createRateLimiter } from "../src/core/rate-limit.ts";

/**
 * Limite de requisição do perfil público.
 *
 * Contrato em
 * `.compozy/tasks/_archived/1787413356948-b5a25d70-perfil-publico-limite/_tests.md`;
 * cada caso aqui carrega o identificador de lá, para o contrato e o teste não
 * divergirem em silêncio.
 */

let now = Date.parse("2026-08-20T12:00:00.000Z");

function avancar(ms: number) {
  now += ms;
  setClock(fixedClock(new Date(now).toISOString()));
}

beforeEach(() => {
  now = Date.parse("2026-08-20T12:00:00.000Z");
  setClock(fixedClock(new Date(now).toISOString()));
});

afterEach(() => {
  resetClock();
  vi.unstubAllEnvs();
});

describe("janela deslizante", () => {
  it("T1 · abaixo do limite, tudo passa", () => {
    // Quem chega pelo link que o candidato mandou não pode ser barrado: a
    // barreira precisa ser invisível para o uso legítimo.
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("1.2.3.4").allowed).toBe(true);
    }
  });

  it("T2 · acima do limite, a seguinte é recusada", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) limiter.check("1.2.3.4");

    const decision = limiter.check("1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
  });

  it("T3 · a janela DESLIZA e o acesso volta", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    limiter.check("1.2.3.4");
    limiter.check("1.2.3.4");
    expect(limiter.check("1.2.3.4").allowed).toBe(false);

    // Bloqueio permanente puniria para sempre quem divide IP — escritório,
    // operadora móvel, VPN.
    avancar(61_000);
    expect(limiter.check("1.2.3.4").allowed).toBe(true);
  });

  it("T3b · deslizante, e não fixa por intervalo", () => {
    // Janela fixa deixa passar o dobro do limite na virada: o fim de um
    // intervalo e o começo do seguinte. É onde um varredor bate.
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    limiter.check("ip");
    avancar(59_000);
    limiter.check("ip");

    avancar(2_000); // a primeira saiu da janela, a segunda não
    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(false);
  });

  it("T4 · IPs diferentes têm baldes independentes", () => {
    // Sem isso, um varredor derrubaria o acesso de todo mundo — negação de
    // serviço barata contra o portfólio de outra pessoa.
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.check("1.1.1.1").allowed).toBe(true);
    expect(limiter.check("1.1.1.1").allowed).toBe(false);
    expect(limiter.check("2.2.2.2").allowed).toBe(true);
  });

  it("T8 · não vaza memória: baldes velhos são descartados", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxEntries: 3 });
    for (let i = 0; i < 50; i++) limiter.check(`ip-${i}`);

    // O mais recente continua contado...
    expect(limiter.check("ip-49").allowed).toBe(false);
    // ...e o mais antigo foi esquecido, que é inofensivo: quem parou de bater é
    // sempre o que envelhece primeiro.
    expect(limiter.check("ip-0").allowed).toBe(true);
  });

  it("T9 · a recusa diz quando voltar", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.check("ip");
    avancar(20_000);

    const decision = limiter.check("ip");
    expect(decision.allowed).toBe(false);
    // Sem `Retry-After` o cliente não sabe quando voltar e tenta em laço. Nunca
    // zero: mandaria tentar imediatamente para ser recusado de novo.
    expect(decision.retryAfterSeconds).toBe(40);
  });
});

describe("de quem é a requisição", () => {
  it("T7 · usa o PRIMEIRO valor de x-forwarded-for", () => {
    // O primeiro é o cliente; os demais são a cadeia de proxies. Pegar o último
    // limitaria o proxy, ou seja, todo mundo junto.
    expect(clientKey(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" })))
      .toBe("203.0.113.7");
  });

  it("T6 · sem cabeçalho, todos caem no mesmo balde", () => {
    // Degradação conservadora: limita demais em vez de limitar de menos. Em
    // desenvolvimento não há proxy, e confiar num cabeçalho ausente seria
    // aceitar qualquer valor forjado.
    expect(clientKey(new Headers())).toBe("sem-proxy");
    expect(clientKey(new Headers({ "x-forwarded-for": "  " }))).toBe("sem-proxy");
  });

  it("T6b · aceita x-real-ip quando é o que existe", () => {
    expect(clientKey(new Headers({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });

  describe("no Fly (sinal POSITIVO: FLY_APP_NAME, e sem VERCEL) — Fly-Client-IP vence o x-forwarded-for que o cliente escolhe", () => {
    it("usa fly-client-ip quando FLY_APP_NAME está presente, mesmo com x-forwarded-for também presente", () => {
      const headers = new Headers({
        "fly-client-ip": "203.0.113.9",
        "x-forwarded-for": "1.2.3.4, 10.0.0.1",
      });
      expect(clientKey(headers, { FLY_APP_NAME: "master-jobs" })).toBe("203.0.113.9");
    });

    it("sem FLY_APP_NAME, ignora fly-client-ip mesmo forjado — a ausência de VERCEL não basta (G27)", () => {
      // Este é o defeito que a revisão da PR #373 pegou: confiar na AUSÊNCIA
      // de `VERCEL` (lista de proibição) em vez de exigir um sinal POSITIVO
      // de estar no Fly. Sem `FLY_APP_NAME`, um cliente falando direto com
      // qualquer deployment sem `VERCEL` poderia forjar `fly-client-ip` e
      // escolher o próprio balde — exatamente o que este cabeçalho existe
      // para evitar.
      const headers = new Headers({
        "fly-client-ip": "203.0.113.9",
        "x-forwarded-for": "1.2.3.4, 10.0.0.1",
      });
      expect(clientKey(headers, {})).toBe("1.2.3.4");
    });

    it("REPRODUZ o risco: sem fly-client-ip nem FLY_APP_NAME, o cliente escolhe o balde pelo primeiro x-forwarded-for", () => {
      // `x-forwarded-for` é o cabeçalho que o próprio cliente pode mandar; o
      // primeiro item da lista é o que ele escreveu, não o que um proxy
      // confiável verificou. Isto é aceito de propósito na Vercel (a borda
      // dela sobrescreve o valor recebido do cliente antes de repassar à
      // função) — no Fly, sem `fly-client-ip`, o mesmo valor decide o balde.
      const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
      expect(clientKey(headers, { FLY_APP_NAME: "master-jobs" })).toBe("1.2.3.4");
    });

    it("FLY_APP_NAME vazio conta como ausente (regra 17) — ignora fly-client-ip", () => {
      // Sem nenhum outro cabeçalho, cair no balde comum prova que
      // `fly-client-ip` foi mesmo ignorado (não usado, e não confundido com
      // um x-forwarded-for/x-real-ip presente).
      const headers = new Headers({ "fly-client-ip": "203.0.113.9" });
      expect(clientKey(headers, { FLY_APP_NAME: "" })).toBe("sem-proxy");
    });
  });

  describe("na Vercel, fly-client-ip nunca é confiável, mesmo com FLY_APP_NAME presente por acidente", () => {
    it("ignora fly-client-ip quando VERCEL está declarado", () => {
      const headers = new Headers({
        "fly-client-ip": "203.0.113.9",
        "x-forwarded-for": "198.51.100.9, 10.0.0.1",
      });
      expect(clientKey(headers, { VERCEL: "1", FLY_APP_NAME: "master-jobs" })).toBe("198.51.100.9");
    });

    it("VERCEL vazio conta como ausente (regra 17) — ainda confia em fly-client-ip, com FLY_APP_NAME presente", () => {
      const headers = new Headers({ "fly-client-ip": "203.0.113.9" });
      expect(clientKey(headers, { VERCEL: "", FLY_APP_NAME: "master-jobs" })).toBe("203.0.113.9");
    });
  });

  it("sem segundo argumento, lê o ambiente real do processo (o default de clientKey)", () => {
    // m3 da revisão: exercitar o parâmetro default (`= process.env`), não só
    // o valor passado explicitamente — é a única forma de provar que a
    // chamada de produção (`clientKey(request.headers)`, em `proxy.ts`, sem
    // segundo argumento) realmente lê `FLY_APP_NAME`/`VERCEL` do processo.
    vi.stubEnv("FLY_APP_NAME", "master-jobs");
    vi.stubEnv("VERCEL", "");
    const headers = new Headers({ "fly-client-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" });
    expect(clientKey(headers)).toBe("203.0.113.9");
  });
});
