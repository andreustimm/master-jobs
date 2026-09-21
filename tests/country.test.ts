import { describe, expect, it } from "vitest";
import {
  countryName,
  countryOf,
  countryRow,
  flagOf,
  groupByCountry,
  MARCAS_VISIVEIS,
} from "../src/core/country.ts";

/**
 * Os casos vêm do acervo, não da imaginação: são as formas que as fontes
 * realmente escrevem, medidas nos grupos de vagas repetidas por país.
 */
describe("país de uma localização livre", () => {
  it("UT-083 lê os nomes que as fontes escrevem", () => {
    const esperado: Record<string, string> = {
      Netherlands: "NL",
      France: "FR",
      Spain: "ES",
      Switzerland: "CH",
      Germany: "DE",
      Ireland: "IE",
      Brazil: "BR",
      India: "IN",
      Canada: "CA",
      Portugal: "PT",
      Romania: "RO",
      Mexico: "MX",
      "South Africa": "ZA",
      Australia: "AU",
      "Saudi Arabia": "SA",
      Turkey: "TR",
      "United Arab Emirates": "AE",
      Colombia: "CO",
      Israel: "IL",
      Czechia: "CZ",
      Croatia: "HR",
      Luxembourg: "LU",
    };
    for (const [texto, code] of Object.entries(esperado)) {
      expect(countryOf(texto), texto).toBe(code);
    }
  });

  it("UT-084 aceita as formas curtas e os nomes populares", () => {
    // `US` é código ISO e resolve sozinho; `UK` não é, e precisa do apelido.
    expect(countryOf("US")).toBe("US");
    expect(countryOf("UK")).toBe("GB");
    expect(countryOf("United States")).toBe("US");
    expect(countryOf("United Kingdom")).toBe("GB");
    expect(countryOf("USA")).toBe("US");
    expect(countryOf("UAE")).toBe("AE");
    expect(countryOf("The Netherlands")).toBe("NL");
    expect(countryOf("Czech Republic")).toBe("CZ");
    // Caixa e espaço sobrando não decidem nada.
    expect(countryOf("  netherlands  ")).toBe("NL");
    // Acento no original não impede o casamento.
    expect(countryOf("Türkiye")).toBe("TR");
  });

  it("UT-085 recusa localização que não nomeia país", () => {
    for (const texto of [
      "Remote",
      "Anywhere",
      "LATAM",
      "Homeoffice",
      "Europe",
      "Worldwide",
      "London",
      "São Paulo",
      "San Francisco, CA | New York City, NY · Apply",
      "Michigan",
      "",
      "   ",
    ]) {
      expect(countryOf(texto), texto).toBeNull();
    }
    expect(countryOf(null)).toBeNull();
    expect(countryOf(undefined)).toBeNull();
  });

  it("UT-088 lê a localização composta do fim para o começo", () => {
    expect(countryOf("São Paulo, State of São Paulo, Brazil")).toBe("BR");
    expect(countryOf("Remote / Brazil")).toBe("BR");
    expect(countryOf("Remote / USA")).toBe("US");
    expect(countryOf("Belo Horizonte, Minas Gerais, Brazil")).toBe("BR");

    // Nos trechos só vale nome por extenso: "Ontario, CA" é cidade da
    // Califórnia, e aceitar o código ali a mandaria para o Canadá.
    expect(countryOf("Ontario, CA")).toBeNull();
    expect(countryOf("San Francisco, CA | New York City, NY · Apply")).toBeNull();

    // O hífen não divide: são nomes de país.
    expect(countryOf("Guinea-Bissau")).toBe("GW");
    expect(countryOf("Timor-Leste")).toBe("TL");
  });

  it("UT-086 a bandeira é o par de indicadores regionais do código", () => {
    expect(flagOf("BR")).toBe("🇧🇷");
    expect(flagOf("nl")).toBe("🇳🇱");
    // Windows não desenha bandeira e mostra as letras: a degradação certa.
    expect([...flagOf("GB")].length).toBe(2);
    expect(flagOf("XYZ")).toBe("");
  });

  it("UT-087 o nome do país vem traduzido, e o código é a saída de emergência", () => {
    expect(countryName("NL", "pt-BR")).toBe("Países Baixos");
    expect(countryName("NL", "en")).toBe("Netherlands");
    expect(countryName("BR", "pt-BR")).toBe("Brasil");
    // O ICU conhece `ZZ` e o chama de "Unknown Region"; a saída de emergência
    // é para o que ele recusa, como um código mal formado.
    expect(countryName("1", "en")).toBe("1");
  });

  it("UT-089 uma marca por país, apontando para a primeira publicação", () => {
    const marcas = groupByCountry(
      [
        { id: 10, location: "Netherlands" },
        { id: 11, location: "France" },
        { id: 12, location: "Germany" },
      ],
      "pt-BR",
    );
    expect(marcas.map((m) => [m.code, m.id, m.postings])).toEqual([
      ["NL", 10, 1],
      ["FR", 11, 1],
      ["DE", 12, 1],
    ]);
    expect(marcas[0]!.name).toBe("Países Baixos");
  });

  it("UT-090 cidades do mesmo país viram uma marca só", () => {
    // Três bandeiras do Brasil lado a lado é ruído, não informação.
    const marcas = groupByCountry(
      [
        { id: 30, location: "São Paulo, State of São Paulo, Brazil" },
        { id: 20, location: "Rio de Janeiro, Rio de Janeiro, Brazil" },
        { id: 40, location: "Belo Horizonte, Minas Gerais, Brazil" },
      ],
      "pt-BR",
    );
    expect(marcas).toHaveLength(1);
    // A marca leva para a de menor id, a mesma escolha da linha canônica.
    expect(marcas[0]).toMatchObject({ code: "BR", id: 20, postings: 3 });
  });

  it("UT-091 localização sem país vira marca própria, pela própria string", () => {
    const marcas = groupByCountry(
      [
        { id: 1, location: "Bogota" },
        { id: 2, location: "bogota" },
        { id: 3, location: "Remote" },
        { id: 4, location: null },
      ],
      "en",
    );
    expect(marcas.map((m) => [m.code, m.name, m.postings])).toEqual([
      [null, "Bogota", 2],
      [null, "Remote", 1],
      [null, "", 1],
    ]);
  });
});

describe("nome de lugar americano que também é nome de país", () => {
  // A tabela do ICU é a lista completa de países, então dentro de uma localização
  // composta qualquer trecho cujo nome por extenso esteja nela vencia: a vaga
  // americana saía com a bandeira do Peru, do Líbano ou do México.
  it("UT-096 outro trecho nomeando estado americano prova os EUA", () => {
    expect(countryOf("Peru, Indiana")).toBe("US");
    expect(countryOf("Mexico, Missouri")).toBe("US");
    expect(countryOf("Lebanon, NH")).toBe("US");
    expect(countryOf("China, Texas")).toBe("US");
    expect(countryOf("Cuba, New Mexico")).toBe("US");
  });

  it("UT-097 sem prova nenhuma dos EUA, o país continua sendo o país", () => {
    // O que importa aqui é não estragar o caso legítimo, que é o comum: o nome
    // do país no fim de uma localização composta.
    expect(countryOf("Lima, Peru")).toBe("PE");
    expect(countryOf("Beirut, Lebanon")).toBe("LB");
    expect(countryOf("Mexico City, Mexico")).toBe("MX");
    expect(countryOf("Remote / Poland")).toBe("PL");
  });

  it("UT-098 país no fim continua vencendo o estado que aparece antes", () => {
    // `"Atlanta, Georgia, United States"` é a forma que já acertava, e a leitura
    // de trás para frente tem de continuar acertando: "United States" é o último
    // trecho, e a prova de estado não pode desviá-la.
    expect(countryOf("Atlanta, Georgia, United States")).toBe("US");
    expect(countryOf("Austin, Texas, USA")).toBe("US");
  });
});

describe("a fileira de marcas de um grupo", () => {
  const rotulos = {
    semLocal: "sem localização",
    comContagem: (name: string, count: number) => `${name} · ${count} vagas`,
  };

  it("UT-092 publicação sem localização recebe rótulo, nunca âncora vazia", () => {
    // O `name: ""` que UT-091 fixa como saída certa do domínio chegava cru na
    // apresentação: a âncora saía com zero caractere, `title=""` e
    // `aria-label=""` — sem nada para ver e sem nome acessível para ouvir — e
    // ainda gastava um dos lugares visíveis, empurrando um país real para o
    // transbordo.
    const { marcas } = countryRow(
      7,
      [
        { id: 7, location: null },
        { id: 8, location: "Brazil" },
      ],
      "pt-BR",
      rotulos,
    );

    const semLocal = marcas.find((m) => m.id === 7)!;
    expect(semLocal.rotulo).toBe("sem localização");
    expect(semLocal.marca).toBe("sem localização");
    expect(semLocal.marca.length).toBeGreaterThan(0);
    // Rótulo do dicionário não é dado do usuário: a verificação da tela em
    // inglês tem de enxergá-lo.
    expect(semLocal.doUsuario).toBe(false);
    // E a marca de país de verdade continua sendo dado do usuário.
    expect(marcas.find((m) => m.id === 8)!.doUsuario).toBe(true);
  });

  it("UT-093 o transbordo leva ao hub, não à publicação canônica", () => {
    // `+N` apontava para `/jobs/<id>` — o id da linha canônica, que é o menor do
    // grupo e portanto o MESMO destino da primeira bandeira. Clicar em "+2"
    // abria um país sorteado pela ordenação, que é o defeito que o hub existiu
    // para remover do link do título.
    const paises = [
      "Netherlands", "France", "Germany", "Spain", "Portugal",
      "Italy", "Poland", "Ireland", "Brazil", "Mexico",
    ];
    const postings = paises.map((location, i) => ({ id: 100 + i, location }));

    const { marcas, restantes, maisHref } = countryRow(100, postings, "en", rotulos);

    expect(marcas).toHaveLength(MARCAS_VISIVEIS);
    expect(restantes).toBe(paises.length - MARCAS_VISIVEIS);
    expect(maisHref).toBe("/jobs/100/paises");
    // A primeira bandeira leva à publicação dela; o transbordo, a outro lugar.
    expect(maisHref).not.toBe(`/jobs/${marcas[0]!.id}`);
  });

  it("UT-094 grupo pequeno não tem transbordo", () => {
    const { marcas, restantes } = countryRow(
      1,
      [
        { id: 1, location: "Brazil" },
        { id: 2, location: "France" },
      ],
      "en",
      rotulos,
    );
    expect(marcas).toHaveLength(2);
    expect(restantes).toBe(0);
  });

  it("UT-095 país com várias publicações mostra a contagem no rótulo", () => {
    const { marcas } = countryRow(
      1,
      [
        { id: 1, location: "São Paulo, Brazil" },
        { id: 2, location: "Rio de Janeiro, Brazil" },
        { id: 3, location: "France" },
      ],
      "pt-BR",
      rotulos,
    );
    expect(marcas.find((m) => m.id === 1)!.rotulo).toBe("Brasil · 2 vagas");
    expect(marcas.find((m) => m.id === 3)!.rotulo).toBe("França");
  });
});
