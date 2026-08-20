/**
 * Suíte: os cantos puros de `analytics/` que nenhum caminho feliz alcança.
 *
 * Fronteira DENTRO: `stats.ts`, `funnel.ts` e `scorer-diagnostics.ts` — funções
 * puras, sem banco, sem relógio, sem rede.
 * Fronteira FORA: a composição contra o banco, coberta por
 * `cov-analytics-db.test.ts`.
 *
 * O que estes casos protegem é a promessa central do módulo: **recusar-se a
 * fabricar conclusão**. Cada guarda aqui existe porque, sem ela, o sistema
 * responderia com um número em vez de responder "não dá para saber".
 */
import { describe, expect, it } from "vitest";
import { analyzeFunnel, hasReplied, type Outcome } from "../src/core/analytics/funnel.ts";
import { diagnoseScorer } from "../src/core/analytics/scorer-diagnostics.ts";
import {
  coefficientOfVariation,
  pearson,
  sampleSizeFor,
} from "../src/core/analytics/stats.ts";

/* -------------------------------------------------------------------------- */
/* stats.ts                                                                    */
/* -------------------------------------------------------------------------- */

describe("stats: guardas que devolvem 'indefinido' em vez de um número inventado", () => {
  it("recusa correlação quando as duas séries não têm o mesmo tamanho", () => {
    // Cenário real: um componente sem valor gravado para parte do acervo. Zipar
    // séries de tamanhos diferentes produziria um ρ calculado sobre pares que
    // não existem — pior que não responder, porque parece resposta.
    expect(pearson([1, 2, 3], [1, 2])).toBeNull();
  });

  it("recusa correlação com menos de três pontos", () => {
    // Com dois pontos qualquer reta passa exatamente pelos dois: ρ=1 sempre.
    // Devolver 1 aqui seria afirmar correlação perfeita a partir de nada.
    expect(pearson([1, 2], [3, 4])).toBeNull();
    expect(pearson([], [])).toBeNull();
  });

  it("trata dispersão relativa a média zero como zero, não como divisão por zero", () => {
    // Um componente que deu 0 para toda vaga tem média 0. Sem esta guarda o
    // coeficiente sairia NaN e contaminaria o veredito do diagnóstico.
    expect(coefficientOfVariation([0, 0, 0])).toBe(0);
  });

  it("devolve infinito para margem impossível em vez de estourar a conta", () => {
    // Margem zero é "quero certeza absoluta": nenhum tamanho de amostra entrega
    // isso. Infinity é a resposta honesta; um número seria promessa falsa.
    expect(sampleSizeFor(0)).toBe(Infinity);
    expect(sampleSizeFor(-0.1)).toBe(Infinity);
  });
});

/* -------------------------------------------------------------------------- */
/* funnel.ts                                                                   */
/* -------------------------------------------------------------------------- */

const outcome = (over: Partial<Outcome> = {}): Outcome => ({
  jobId: 1,
  status: "applied",
  replied: false,
  fit: 70,
  cluster: "architect",
  sourceKind: "lever",
  channel: "direct",
  components: { Cargo: 20, "Palavras-chave": 10 },
  ...over,
});

const many = (n: number, over: (i: number) => Partial<Outcome>): Outcome[] =>
  Array.from({ length: n }, (_, i) => {
    const patch = over(i);
    const status = patch.status ?? "applied";
    return outcome({ ...patch, status, replied: hasReplied(status) });
  });

describe("analyzeFunnel: o que acontece entre 'nada' e 'confiável'", () => {
  it("explica que a taxa geral já serve mas o recorte por grupo ainda não", () => {
    // A faixa 10–29 é a mais perigosa: já dá para calcular uma taxa geral, e é
    // exatamente aí que o usuário começaria a comparar canais com n=4 cada.
    const r = analyzeFunnel(many(12, (i) => ({ status: i < 3 ? "screening" : "applied" })));

    expect(r.applied).toBe(12);
    expect(r.trustworthy).toBe(false);
    expect(r.power).toContain("suficiente para uma taxa geral grosseira");
    expect(r.power).toContain("comparar grupos de 3 é ler ruído");
    // A taxa geral existe, mas os recortes continuam ocultos.
    expect(r.overall.point).toBeCloseTo(0.25, 5);
    expect(r.byCluster).toEqual([]);
    expect(r.byChannel).toEqual([]);
  });

  it("ignora candidatura sem grupo em vez de criar um balde 'null'", () => {
    // Vaga importada de e-mail costuma chegar sem cluster e sem canal. Um balde
    // com rótulo vazio apareceria no recorte como se fosse uma fonte real.
    const r = analyzeFunnel(
      many(40, (i) => ({
        cluster: i < 10 ? null : "architect",
        channel: i < 10 ? null : "referral",
        sourceKind: i < 10 ? null : "lever",
        status: i % 4 === 0 ? "rejected" : "applied",
      })),
    );

    expect(r.trustworthy).toBe(true);
    expect(r.byCluster.map((g) => g.group)).toEqual(["architect"]);
    expect(r.byChannel.map((g) => g.group)).toEqual(["referral"]);
    expect(r.bySource.map((g) => g.group)).toEqual(["lever"]);
    // As 30 restantes é que formam o grupo — as 10 sem rótulo saíram fora.
    expect(r.byCluster[0]!.applied).toBe(30);
  });

  it("ordena os componentes pelo tamanho da correlação, sinal ignorado", () => {
    // O que interessa é a força do sinal: um componente que prevê rejeição é
    // tão informativo quanto um que prevê resposta. Ordenar por valor com sinal
    // enterraria o preditor negativo no fim da lista.
    const r = analyzeFunnel(
      many(40, (i) => ({
        status: i % 2 === 0 ? "screening" : "applied",
        components: { Ruído: 5, Preditor: i % 2 === 0 ? 30 : 0 },
      })),
    );

    expect(r.componentSignal).toHaveLength(2);
    expect(r.componentSignal[0]!.key).toBe("Preditor");
    expect(Math.abs(r.componentSignal[0]!.rho!)).toBeGreaterThan(0.9);
    // "Ruído" é constante: correlação indefinida, não zero disfarçado de dado.
    expect(r.componentSignal[1]!.rho).toBeNull();
  });

  it("trata componente ausente numa candidatura como zero, sem quebrar a série", () => {
    // Vagas pontuadas por versões diferentes do scorer não têm o mesmo conjunto
    // de componentes. Descartar a candidatura inteira perderia o desfecho, que
    // é o dado caro; assumir zero mantém as séries do mesmo tamanho.
    const r = analyzeFunnel(
      many(40, (i) => ({
        status: i % 3 === 0 ? "offer" : "applied",
        // Anotado porque a ternária infere duas formas distintas e a união
        // delas não satisfaz `Record<string, number>`: o ramo sem `Benefícios`
        // ganha a propriedade como `undefined`.
        components: (i < 20 ? { Cargo: 20 } : { Cargo: 20, Benefícios: 4 }) as Record<
          string,
          number
        >,
      })),
    );

    const beneficios = r.componentSignal.find((c) => c.key === "Benefícios");
    expect(beneficios).toBeDefined();
    expect(beneficios!.rho).not.toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* scorer-diagnostics.ts                                                       */
/* -------------------------------------------------------------------------- */

const sample = (label: string, weight: number, values: number[]) => ({
  key: label,
  label,
  weight,
  values,
});

describe("diagnoseScorer: vereditos que o caminho feliz nunca produz", () => {
  it("chama de flag o componente que só dá zero ou o teto", () => {
    // Metade em zero, metade no teto: dispersão alta (não é peso morto) e teto
    // abaixo de 80% (não é saturado). É uma flag binária vestida de escala —
    // legítimo quando intencional, e por isso a nota diz "só é problema se".
    const binario = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 0 : 10));
    const d = diagnoseScorer([sample("geo", 10, binario)], binario);

    const geo = d.components[0]!;
    expect(geo.verdict).toBe("all-or-nothing");
    expect(geo.note).toContain("é uma flag, não uma escala");
    expect(geo.zeroShare).toBeCloseTo(0.5, 2);
    expect(geo.ceilingShare).toBeCloseTo(0.5, 2);
  });

  it("ordena os pares redundantes do mais colado para o menos", () => {
    // Com três componentes medindo quase a mesma coisa saem três pares, e a
    // ordem é o que diz qual remover primeiro. Sem ordenação, a recomendação
    // sairia na ordem acidental do laço.
    const base = Array.from({ length: 60 }, (_, i) => (i % 20) + 1);
    const gemeo = base.map((v) => v * 2);
    const quaseGemeo = base.map((v, i) => v * 2 + (i % 7 === 0 ? 3 : 0));
    const d = diagnoseScorer(
      [sample("a", 30, base), sample("b", 30, gemeo), sample("c", 30, quaseGemeo)],
      base,
    );

    expect(d.redundant.length).toBeGreaterThanOrEqual(2);
    const forcas = d.redundant.map((p) => Math.abs(p.rho));
    expect(forcas).toEqual([...forcas].sort((x, y) => y - x));
    expect(d.warnings.join(" ")).toContain("contada duas vezes");
  });

  it("não divide por zero ao calcular aproveitamento de componente sem peso", () => {
    // Um componente pode ser zerado no profile.yaml para desligá-lo sem removê-lo
    // do scorer. Aproveitamento é valor/peso: com peso 0 a conta é indefinida, e
    // NaN vazaria direto para a tela de diagnóstico.
    const valores = Array.from({ length: 40 }, (_, i) => i % 5);
    const d = diagnoseScorer([sample("desligado", 0, valores)], valores);

    expect(d.components[0]!.utilisation).toBe(0);
    expect(Number.isNaN(d.components[0]!.utilisation)).toBe(false);
  });
});
