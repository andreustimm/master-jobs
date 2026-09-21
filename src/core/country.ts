/**
 * O país de uma localização escrita à mão, e a bandeira dele.
 *
 * Existe porque a mesma vaga chega repetida por país: "Engineering Manager"
 * publicada em sete linhas que só diferem em Netherlands, UK, France… Para
 * juntar as sete numa linha é preciso dizer, de cada uma, qual país é.
 *
 * Puro de propósito: sem banco, sem rede, sem relógio. A tabela de nomes vem do
 * ICU do próprio Node em vez de uma lista escrita à mão, que envelheceria na
 * primeira fonte nova — e o ICU também dá o nome traduzido de graça.
 *
 * Localização que não resolve devolve `null`, e quem chama mostra o texto como
 * veio. "Remote", "LATAM" e "Anywhere" são localizações honestas que não são
 * países; inventar uma bandeira para elas seria pior que não ter nenhuma.
 */

/** ISO 3166-1 alfa-2, sempre em maiúsculas. */
export type CountryCode = string;

/** Palavras que são localização de verdade, mas não são país. */
const NAO_E_PAIS = new Set([
  "remote",
  "remoto",
  "anywhere",
  "worldwide",
  "global",
  "homeoffice",
  "home office",
  "hybrid",
  "onsite",
  "on-site",
  "latam",
  "latin america",
  "emea",
  "apac",
  "europe",
  "european union",
  "eu",
  "americas",
  "africa",
  "asia",
  "north america",
  "south america",
  "middle east",
]);

/**
 * Formas curtas e nomes populares que o ICU não devolve.
 *
 * `US` não entra aqui porque já é o código ISO; `UK` entra porque o código é
 * `GB` e ninguém escreve GB.
 */
const APELIDOS: Record<string, CountryCode> = {
  uk: "GB",
  "u.k.": "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  america: "US",
  uae: "AE",
  holland: "NL",
  russia: "RU",
  "south korea": "KR",
  "north korea": "KP",
  vietnam: "VN",
  "czech republic": "CZ",
  turkey: "TR",
  "ivory coast": "CI",
  "cape verde": "CV",
  "east timor": "TL",
  swaziland: "SZ",
  burma: "MM",
  syria: "SY",
  laos: "LA",
  moldova: "MD",
  bolivia: "BO",
  venezuela: "VE",
  tanzania: "TZ",
  macedonia: "MK",
};

/** Sem acento, sem artigo, sem espaço sobrando — a forma que o mapa usa. */
function chave(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Códigos que o ICU ainda nomeia e que não são mais o país.
 *
 * Esta lista existe porque o CLDR guarda o passado: ele chama `DD` de
 * "Germany" e `FX` de "France", e uma varredura alfabética entrega `DD` antes
 * de `DE`. Não dá para distinguir pelo ICU — um código retirado tem o mesmo
 * formato de um vivo —, então a fronteira é escrita.
 *
 * Junto vão os "excepcionalmente reservados", que são vivos mas não são o país:
 * `UK` é reservado para o Reino Unido e o CLDR o nomeia "United Kingdom", então
 * sem ele na lista "United Kingdom" resolvia para `UK` em vez de `GB` — e a
 * bandeira de `UK` não existe.
 *
 * É uma lista que quase não cresce: código de país morto não nasce.
 */
const RETIRADOS = new Set([
  "AC", // Ilha de Ascensão: reservado, território
  "AN", // Antilhas Neerlandesas
  "BU", // Birmânia → MM
  "CS", // Sérvia e Montenegro
  "CP", // Ilha de Clipperton: reservado
  "CT", // Ilhas Canton e Enderbury
  "DD", // Alemanha Oriental → DE
  "DG", // Diego Garcia: reservado
  "DY", // Daomé → BJ
  "EA", // Ceuta e Melilha: parte da Espanha
  "EU", // União Europeia: organização, não país
  "EZ", // Zona do euro
  "FQ", // Territórios Franceses do Sul e Antárticos
  "FX", // França metropolitana → FR
  "HV", // Alto Volta → BF
  "IC", // Ilhas Canárias: parte da Espanha
  "JT", // Ilha Johnston
  "MI", // Ilhas Midway
  "NH", // Novas Hébridas → VU
  "NQ", // Terra da Rainha Maud
  "NT", // Zona Neutra
  "PC", // Território das Ilhas do Pacífico
  "PU", // Ilhas Menores dos EUA no Pacífico
  "PZ", // Zona do Canal do Panamá
  "QO", // Oceania Remota
  "QU", // = EU
  "RH", // Rodésia → ZW
  "SU", // União Soviética → RU
  "TA", // Tristão da Cunha: reservado
  "TP", // Timor Português → TL
  "UK", // reservado para o Reino Unido; o código do país é GB
  "UN", // Nações Unidas
  "VD", // Vietnã do Norte → VN
  "WK", // Ilha Wake
  "XA", // pseudo-locale
  "XB", // pseudo-locale
  "YD", // Iêmen do Sul → YE
  "YU", // Iugoslávia
  "ZR", // Zaire → CD
  "ZZ", // Região desconhecida
]);

/**
 * Nome em inglês → código, montado uma vez a partir do ICU.
 *
 * Os códigos possíveis são as 676 combinações de duas letras: o ICU devolve o
 * próprio código quando não conhece, e é assim que as inválidas caem fora.
 */
let porNome: Map<string, CountryCode> | null = null;

function tabela(): Map<string, CountryCode> {
  if (porNome) return porNome;
  const nomes = new Intl.DisplayNames(["en"], { type: "region" });
  const mapa = new Map<string, CountryCode>();
  const A = "A".charCodeAt(0);
  for (let i = 0; i < 26; i += 1) {
    for (let j = 0; j < 26; j += 1) {
      const code = String.fromCharCode(A + i, A + j);
      if (RETIRADOS.has(code)) continue;
      let nome: string | undefined;
      try {
        nome = nomes.of(code);
      } catch {
        continue;
      }
      if (!nome || nome === code) continue;
      mapa.set(chave(nome), code);
    }
  }
  for (const [nome, code] of Object.entries(APELIDOS)) mapa.set(chave(nome), code);
  porNome = mapa;
  return mapa;
}

/**
 * Divisores de uma localização composta.
 *
 * O hífen fica de fora de propósito: "Guinea-Bissau" e "Timor-Leste" são nomes
 * com hífen, e quebrar neles destruiria o país em vez de encontrá-lo.
 */
const DIVISORES = /[,/|;·]/;

/** O país de uma localização inteira, sem tentar quebrá-la. */
function paisDeTrecho(texto: string, aceitaCodigo: boolean): CountryCode | null {
  const limpo = chave(texto);
  if (limpo === "" || NAO_E_PAIS.has(limpo)) return null;
  // Os apelidos vêm antes do código porque `UK` é as duas coisas: o ICU o
  // aceita como alias e devolveria `UK`, que não é o código ISO do país.
  const tabelaDeNomes = tabela();
  const apelido = tabelaDeNomes.get(limpo);
  if (apelido) return apelido;
  if (!aceitaCodigo) return null;
  // Um código de duas letras só é aceito escrito assim, inteiro: "US", "BR".
  if (/^[a-z]{2}$/.test(limpo)) {
    const code = limpo.toUpperCase();
    if (RETIRADOS.has(code)) return null;
    const nomes = new Intl.DisplayNames(["en"], { type: "region" });
    try {
      const nome = nomes.of(code);
      if (!nome || nome === code) return null;
      // Devolve o código canônico daquele nome, não o que foi digitado.
      return tabelaDeNomes.get(chave(nome)) ?? code;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * O país de uma localização livre, ou `null` quando ela não nomeia um.
 *
 * Uma localização composta — "São Paulo, State of São Paulo, Brazil",
 * "Remote / Brazil" — é lida do fim para o começo, porque o país vem por
 * último. Nos trechos, só nome por extenso conta: "Ontario, CA" é uma cidade
 * da Califórnia, e aceitar `CA` ali a mandaria para o Canadá.
 */
export function countryOf(raw: string | null | undefined): CountryCode | null {
  if (!raw) return null;
  const inteiro = paisDeTrecho(raw, true);
  if (inteiro) return inteiro;
  if (!DIVISORES.test(raw)) return null;
  const trechos = raw.split(DIVISORES);
  for (let i = trechos.length - 1; i >= 0; i -= 1) {
    const achado = paisDeTrecho(trechos[i]!, false);
    if (achado) return achado;
  }
  return null;
}

const INDICADOR_REGIONAL = 0x1f1e6 - "A".charCodeAt(0);

/**
 * A bandeira do país, como par de indicadores regionais.
 *
 * Windows não desenha bandeiras e mostra as duas letras — o que é a degradação
 * certa, porque "NL" continua dizendo o país. Por isso o nome acessível nunca
 * vem daqui: ele é dado por quem renderiza.
 */
export function flagOf(code: CountryCode): string {
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "";
  return String.fromCodePoint(
    upper.charCodeAt(0) + INDICADOR_REGIONAL,
    upper.charCodeAt(1) + INDICADOR_REGIONAL,
  );
}

/** O nome do país no idioma pedido; o código, se o ICU não souber. */
export function countryName(code: CountryCode, locale: string): string {
  const upper = code.toUpperCase();
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(upper) ?? upper;
  } catch {
    return upper;
  }
}

/** Uma publicação do grupo, como a leitura do quadro a entrega. */
export type Posting = { id: number; location: string | null };

/** Um país do grupo, pronto para virar uma marca na linha. */
export type CountryMark = {
  /** A publicação para onde a marca leva: a primeira daquele país. */
  id: number;
  /** O código, ou `null` quando a localização não nomeia um país. */
  code: CountryCode | null;
  /** O nome do país, ou a localização como veio. */
  name: string;
  /** Quantas publicações do grupo caem neste país. */
  postings: number;
};

/**
 * As publicações de um grupo, uma marca por país.
 *
 * Por país e não por publicação: três cidades brasileiras davam três bandeiras
 * iguais lado a lado, o que é ruído e não informação. A marca leva para a
 * primeira publicação daquele país — a de menor id, a mesma escolha que decide
 * a linha canônica —, e guarda quantas são para quem quiser dizer.
 *
 * Localização que não resolve vira uma marca própria, pela própria string: duas
 * vagas em "Bogota" são uma marca, e "Bogota" e "Remote" são duas.
 */
export function groupByCountry(postings: Posting[], locale: string): CountryMark[] {
  const porPais = new Map<string, CountryMark>();
  for (const posting of postings) {
    const code = countryOf(posting.location);
    const texto = posting.location?.trim() ?? "";
    const chave = code ?? `texto:${texto.toLowerCase()}`;
    const existente = porPais.get(chave);
    if (existente) {
      existente.postings += 1;
      existente.id = Math.min(existente.id, posting.id);
      continue;
    }
    porPais.set(chave, {
      id: posting.id,
      code,
      name: code ? countryName(code, locale) : texto,
      postings: 1,
    });
  }
  return [...porPais.values()];
}

/** Quantas marcas cabem numa linha antes de a fileira virar um muro. */
export const MARCAS_VISIVEIS = 8;

/** Uma marca do jeito que a fileira precisa dela. */
export type MarcaDeFileira = {
  /** Para onde a marca leva: a publicação daquele país. */
  id: number;
  /** O que aparece — bandeira, ou a localização encurtada. */
  marca: string;
  /** O nome que vai no `title` e no `aria-label`. Nunca vazio. */
  rotulo: string;
  /** Falso quando o rótulo é do dicionário, e não texto do acervo. */
  doUsuario: boolean;
};

/**
 * A fileira de marcas de um grupo, decidida sem JSX e sem `t`.
 *
 * Aqui em vez de no componente porque são três decisões que erraram uma vez e
 * precisam de teste: o que fazer com publicação sem localização nenhuma, quantas
 * marcas mostrar, e para onde vai o transbordo.
 *
 * Os rótulos entram traduzidos: a tradução é do adapter, o domínio não conhece
 * dicionário.
 */
export function countryRow(
  jobId: number,
  postings: Posting[],
  locale: string,
  rotulos: {
    /** Rótulo de publicação sem localização nenhuma. */
    semLocal: string;
    /** `(nome, quantas) => rótulo` quando o país tem mais de uma publicação. */
    comContagem: (name: string, count: number) => string;
  },
  // O tipo do destino é literal, e não `string`, porque as rotas tipadas do
  // Next recusam `string` solta — e é essa recusa que impede o transbordo de
  // voltar a apontar para um caminho que não existe.
): { marcas: MarcaDeFileira[]; restantes: number; maisHref: `/jobs/${number}/paises` } {
  const marcas = groupByCountry(postings, locale).map((pais) => {
    // Publicação sem localização nenhuma existe: a coluna é nulável e a ingestão
    // grava `null` sem normalizar para texto. `groupByCountry` devolve `name: ""`
    // para ela, e usar esse valor cru dava uma âncora de ZERO caractere, com
    // `title=""` e `aria-label=""` — invisível para quem vê, sem nome acessível
    // para quem ouve, e ainda ocupando um dos lugares visíveis, o que empurrava
    // um país real para dentro do transbordo.
    //
    // Ela não é descartada: é uma vaga aberta de verdade, e esconder seria pior
    // que mostrar sem nome de país.
    const semLocal = !pais.code && pais.name.trim() === "";
    const nome = semLocal ? rotulos.semLocal : pais.name;
    return {
      id: pais.id,
      // Sem país, a própria localização é a marca — encurtada, porque a linha é
      // estreita e "Bogota,D.C., Capital District" não cabe.
      marca: pais.code ? flagOf(pais.code) : nome.slice(0, 18),
      rotulo: pais.postings > 1 ? rotulos.comContagem(nome, pais.postings) : nome,
      // Rótulo do dicionário não é dado do usuário, então não recebe a isenção
      // que protege "São Paulo" da verificação da tela em inglês.
      doUsuario: !semLocal,
    };
  });
  return {
    marcas: marcas.slice(0, MARCAS_VISIVEIS),
    restantes: Math.max(0, marcas.length - MARCAS_VISIVEIS),
    // O transbordo vai para o HUB, não para a publicação canônica.
    //
    // Ele apontava para `/jobs/<id>`, e esse id é o da linha canônica — o menor
    // do grupo, portanto o mesmo destino da primeira bandeira. Clicar em "+34"
    // abria a vaga na Holanda: exatamente o "país que ninguém pediu" que a
    // entrega do hub existiu para remover. E a tela de detalhe não lista país
    // nenhum, então o destino não respondia à pergunta que o rótulo faz.
    maisHref: `/jobs/${jobId}/paises`,
  };
}
