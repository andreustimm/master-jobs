import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
