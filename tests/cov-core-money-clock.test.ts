import { afterEach, describe, expect, it } from "vitest";
import { clock, fixedClock, resetClock, setClock, systemClock } from "../src/core/clock.ts";
import { formatMoney, money, toPeriod } from "../src/core/money.ts";

/**
 * `toPeriod` é o caminho que a UI usa para mostrar "quanto isso dá por hora"
 * a partir de um anual. Ele delega a normalização a `annualize`, e por isso
 * herda a recusa dela: projeto sem duração não vira taxa nenhuma.
 */
describe("toPeriod: herda a recusa de `annualize` em vez de chutar", () => {
  it("devolve null para projeto sem duração declarada", () => {
    // USD 30k é excelente em dois meses e abaixo do piso em doze. Sem a
    // duração não existe taxa correta, e inventar uma inverteria o veredito
    // da vaga — que é exatamente o defeito que este módulo veio corrigir.
    expect(toPeriod(money(30_000, "USD", "project"), "hour")).toBeNull();
    expect(toPeriod(money(30_000, "USD", "project", 0), "month")).toBeNull();
  });

  it("devolve o próprio anual quando o período pedido é o ano", () => {
    // Atalho que evita dividir e multiplicar por 1 e introduzir erro de ponto
    // flutuante num número que a tela mostra ao usuário.
    const anual = toPeriod(money(240_000, "USD", "month"), "year");
    expect(anual).toEqual({ amount: 240_000 * 12, currency: "USD", period: "year" });
  });

  it("converte projeto COM duração para taxa periódica", () => {
    // 30k em 2 meses = 180k/ano = ~86,54/hora no equivalente de 2080h.
    const hora = toPeriod(money(30_000, "USD", "project", 2), "hour");
    expect(hora?.period).toBe("hour");
    expect(Math.round(hora?.amount ?? 0)).toBe(87);
  });

  it("preserva a moeda de origem ao trocar de período", () => {
    // Trocar período nunca é conversão de moeda: misturar as duas operações
    // foi o que produziu o bug de comparar PHP contra piso em USD.
    expect(toPeriod(money(120_000, "BRL", "year"), "month")?.currency).toBe("BRL");
  });
});

describe("formatMoney: código de moeda que o Intl recusa", () => {
  it("cai no formato manual quando o código não é ISO 4217 bem formado", () => {
    // Fontes reais gravam o SÍMBOLO no campo de moeda ("R$", "US$"). O Intl
    // lança RangeError para qualquer coisa que não sejam três letras, e uma
    // exceção aqui derrubaria a listagem inteira por causa de uma linha suja.
    const saida = formatMoney(money(1234.6, "R$", "month"));
    expect(saida).toContain("R$");
    expect(saida).toContain("/month");
    expect(saida).toContain("1,235");
  });

  it("mantém o sufixo de projeto no caminho degradado", () => {
    // O caminho de exceção precisa produzir a mesma informação do caminho
    // feliz; perder "total (3 meses)" transformaria um fixo em taxa aos olhos
    // de quem lê.
    expect(formatMoney(money(30_000, "US$", "project", 3))).toContain("total (3 meses)");
    expect(formatMoney(money(30_000, "US$", "project"))).toContain("total");
  });

  it("um código de três letras desconhecido NÃO cai no caminho degradado", () => {
    // Registro do comportamento real: o Intl aceita qualquer código bem
    // formado, inclusive inexistente. Só o formato inválido dispara o
    // fallback — quem escrever teste de fallback com "XYZ" não testa nada.
    // (o Intl separa código e número com espaço estreito, não com espaço comum)
    expect(formatMoney(money(1000, "XYZ", "year"))).toMatch(/^XYZ\s1,000$/u);
  });
});

/**
 * O relógio é porta só onde o tempo é DECISÃO (backoff, expiração de claim).
 * Estes casos cobrem o controle manual que os testes de fila usam para
 * atravessar uma janela de espera sem dormir de verdade.
 */
describe("clock: relógio injetável", () => {
  afterEach(() => {
    // Estado de módulo: deixar um relógio congelado ativo contaminaria
    // qualquer teste seguinte no mesmo arquivo.
    resetClock();
  });

  it("começa no relógio do sistema", () => {
    expect(clock()).toBe(systemClock);
    expect(systemClock.iso()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(5_000);
  });

  it("`set` reposiciona o relógio em um instante absoluto", () => {
    // `advance` serve para janelas relativas; `set` serve para reproduzir um
    // instante exato — é o que permite asserir sobre um `scoredAt` gravado.
    const relogio = fixedClock("2026-08-19T12:00:00.000Z");
    relogio.set("2020-01-01T00:00:00.000Z");
    expect(relogio.iso()).toBe("2020-01-01T00:00:00.000Z");
    expect(relogio.now()).toBe(Date.parse("2020-01-01T00:00:00.000Z"));

    // E `advance` continua contando a partir do novo ponto, não do original.
    relogio.advance(86_400_000);
    expect(relogio.iso()).toBe("2020-01-02T00:00:00.000Z");
  });

  it("`advance` atravessa uma janela de backoff sem esperar", () => {
    // O motivo de existir da porta: testar "não pode disparar antes de cinco
    // minutos" contra o relógio real significa dormir ou não asserir nada.
    const relogio = fixedClock("2026-08-19T12:00:00.000Z");
    const inicio = relogio.now();
    relogio.advance(5 * 60_000);
    expect(relogio.now() - inicio).toBe(300_000);
    expect(relogio.iso()).toBe("2026-08-19T12:05:00.000Z");
  });

  it("`setClock` troca o relógio ativo e `resetClock` devolve o do sistema", () => {
    const relogio = fixedClock("2001-02-03T04:05:06.000Z");
    setClock(relogio);
    expect(clock().iso()).toBe("2001-02-03T04:05:06.000Z");
    resetClock();
    expect(clock()).toBe(systemClock);
  });

  it("usa o padrão embutido quando nenhum instante é informado", () => {
    // Um padrão fixo mantém a saída de teste estável entre execuções.
    expect(fixedClock().iso()).toBe("2026-08-19T12:00:00.000Z");
  });
});
