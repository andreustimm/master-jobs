/**
 * As bordas do parser MIME, do classificador e do extrator de alertas.
 *
 * `tests/mail.test.ts` cobre o caminho feliz de cada um dos três — o e-mail que
 * o LinkedIn manda hoje. Este arquivo cobre o que acontece quando o e-mail NÃO
 * é o de hoje: charset que o Node não conhece, multipart aninhado, parte que
 * não é texto, template do LinkedIn reorganizado.
 *
 * O critério para cada caso aqui é o mesmo: nenhuma dessas situações pode
 * produzir zero em silêncio. Um parser que devolve "nenhuma vaga" depois de uma
 * troca de template deixa o usuário achando que o mercado esfriou.
 */
import { describe, expect, it } from "vitest";
import { classify, detectProvider } from "../src/core/mail/classify.ts";
import { decodeEncodedWords, parseEml } from "../src/core/mail/eml.ts";
import { canonicalJobUrl, extractAlertJobs, toRawJobs } from "../src/core/mail/job-alert.ts";
import type { ParsedMail } from "../src/core/mail/eml.ts";

/* -------------------------------------------------------------- eml ------ */

describe("parseEml: cabeçalhos", () => {
  it("aceita uma mensagem que é só cabeçalho, sem linha em branco", () => {
    // Export truncado por cliente de e-mail. O corpo vazio é aceitável; perder
    // o remetente não seria.
    const mail = parseEml("From: a@b.com\nSubject: sem corpo");

    expect(mail.from.address).toBe("a@b.com");
    expect(mail.subject).toBe("sem corpo");
    expect(mail.text).toBe("");
  });

  it("ignora continuação de cabeçalho que aparece antes de qualquer cabeçalho", () => {
    // Lixo no topo do arquivo não pode virar chave de cabeçalho: ele
    // sobrescreveria o próximo header de verdade.
    const mail = parseEml("  linha indentada solta\nFrom: a@b.com\n\ncorpo");

    expect(mail.from.address).toBe("a@b.com");
  });

  it("normaliza CRLF antes de separar cabeçalho de corpo", () => {
    // Arquivo salvo no Windows é a regra, não a exceção, em export de e-mail.
    const mail = parseEml("From: a@b.com\r\nSubject: oi\r\n\r\ncorpo\r\n");

    expect(mail.subject).toBe("oi");
    expect(mail.text?.trim()).toBe("corpo");
  });

  it("aceita endereço nu, sem nome nem sinais de menor/maior", () => {
    const mail = parseEml("From: Alguem@ACME.com\n\ncorpo");

    // Minúsculas sempre: o endereço é chave de casamento com provedor.
    expect(mail.from).toEqual({ name: null, address: "alguem@acme.com" });
  });

  it("devolve endereço nulo quando o From não tem arroba", () => {
    const mail = parseEml("From: Alguem Sem Email\n\ncorpo");

    expect(mail.from.address).toBeNull();
    expect(mail.from.name).toBeNull();
  });

  it("descarta data impossível em vez de gravar Invalid Date", () => {
    // `receivedAt` ordena a fila de sugestões. Uma data inválida ali envenenaria
    // a ordenação inteira.
    expect(parseEml("Date: ontem à tarde\n\ncorpo").date).toBeNull();
    expect(parseEml("Subject: x\n\ncorpo").date).toBeNull();
  });

  it("devolve messageId nulo quando o cabeçalho não existe", () => {
    expect(parseEml("From: a@b.com\n\ncorpo").messageId).toBeNull();
  });
});

describe("parseEml: codificação", () => {
  it("decodifica um charset legado que o Node conhece", () => {
    const body = Buffer.from([0x53, 0xe3, 0x6f, 0x20, 0x50, 0x61, 0x75, 0x6c, 0x6f]); // latin-1
    const raw = `Content-Type: text/plain; charset="iso-8859-1"\n\n${body.toString("binary")}`;

    expect(parseEml(raw).text).toBe("São Paulo");
  });

  it("cai para utf-8 quando o charset declarado não existe", () => {
    // Um `charset` inventado pelo remetente não pode derrubar a importação: o
    // texto em utf-8 é quase sempre o palpite certo e sempre é melhor que nada.
    const raw = 'Content-Type: text/plain; charset="x-charset-que-nao-existe"\n\nconteúdo';

    expect(parseEml(raw).text).toContain("conte");
  });

  it("decodifica quoted-printable com quebra suave e hexa inválido", () => {
    // `=XY` não é hexa: tem de sobreviver literal em vez de virar byte aleatório.
    const raw = [
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "S=C3=A3o=",
      " Paulo =XY fim",
    ].join("\n");

    const text = parseEml(raw).text ?? "";
    expect(text).toContain("São");
    expect(text).toContain("=XY");
  });

  it("trata codificação desconhecida como texto cru", () => {
    const raw = [
      "Content-Type: text/plain",
      "Content-Transfer-Encoding: 8bit",
      "",
      "texto normal",
    ].join("\n");

    expect(parseEml(raw).text?.trim()).toBe("texto normal");
  });
});

describe("parseEml: multipart", () => {
  it("desce em multipart aninhado para achar as partes de texto", () => {
    // multipart/mixed com um multipart/alternative dentro é o que qualquer
    // e-mail com anexo produz. Parar no primeiro nível perderia o corpo todo.
    const raw = [
      'Content-Type: multipart/mixed; boundary="OUT"',
      "",
      "--OUT",
      'Content-Type: multipart/alternative; boundary="IN"',
      "",
      "--IN",
      "Content-Type: text/plain",
      "",
      "versao texto",
      "--IN",
      "Content-Type: text/html",
      "",
      "<p>versao html</p>",
      "--IN--",
      "--OUT--",
    ].join("\n");

    const mail = parseEml(raw);
    expect(mail.text).toContain("versao texto");
    expect(mail.html).toContain("versao html");
  });

  it("[achado] corpo 8-bit em utf-8 perde os acentos, mesmo declarando charset", () => {
    // ACHADO, fixado como está para não passar despercebido em um refactor.
    //
    // O arquivo é lido com `readFile(file, "utf8")`, então "ã" já chega como um
    // único caractere U+00E3. `decodeBody` então monta o buffer com
    // `Buffer.from(body, "binary")`, que grava o byte 0xE3 sozinho, e manda
    // decodificar como utf-8 — onde 0xE3 solto é inválido e vira U+FFFD.
    // Declarar `charset=UTF-8` não ajuda: o estrago é anterior ao decodificador.
    //
    // Impacto: e-mail de ATS entregue em 8bit puro (sem quoted-printable nem
    // base64) entra no banco com caractere de substituição, e o classificador
    // perde as regras em português — "infelizmente" e "não seguiremos" são
    // exatamente as frases que dependem de acento.
    const semCharset = parseEml("Content-Type: text/plain\n\ninfelizmente, não seguiremos");
    const comCharset = parseEml(
      "Content-Type: text/plain; charset=UTF-8\n\ninfelizmente, não seguiremos",
    );

    expect(semCharset.text).toContain("\uFFFD");
    expect(comCharset.text).toContain("\uFFFD");

    // Os dois caminhos que os ATS realmente usam continuam corretos — é por
    // isso que o defeito não aparece no dia a dia.
    const qp = parseEml(
      [
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "n=C3=A3o",
      ].join("\n"),
    );
    const b64 = parseEml(
      [
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("não", "utf8").toString("base64"),
      ].join("\n"),
    );
    expect(qp.text).toContain("não");
    expect(b64.text).toContain("não");
  });

  it("fica com a primeira parte de cada tipo quando há repetição", () => {
    const raw = [
      'Content-Type: multipart/alternative; boundary="B"',
      "",
      "--B",
      "Content-Type: text/plain",
      "",
      "primeira",
      "--B",
      "Content-Type: text/plain",
      "",
      "segunda",
      "--B--",
    ].join("\n");

    expect(parseEml(raw).text).toContain("primeira");
    expect(parseEml(raw).text).not.toContain("segunda");
  });

  it("volta para o corpo inteiro quando o boundary declarado não aparece", () => {
    // Boundary errado é erro de quem gerou o e-mail. Devolver vazio esconderia
    // a mensagem; devolver o corpo cru deixa o classificador ainda trabalhar.
    const raw = [
      'Content-Type: multipart/alternative; boundary="NAO-EXISTE"',
      "",
      "corpo solto com we have received your application",
    ].join("\n");

    expect(parseEml(raw).text).toContain("received your application");
  });

  it("lê o corpo de uma mensagem cujo tipo não é texto nem html", () => {
    // Sem esse resgate, uma parte `application/*` deixaria `text` e `html`
    // nulos e a mensagem entraria no banco sem corpo nenhum.
    const raw = ["Content-Type: application/json", "", '{"assunto":"rejeitado"}'].join("\n");

    const mail = parseEml(raw);
    expect(mail.text).toContain("rejeitado");
    expect(mail.html).toBeNull();
  });

  it("reconhece como html qualquer tipo que contenha 'html' no nome", () => {
    const raw = ["Content-Type: application/xhtml+xml", "", "<p>oi</p>"].join("\n");

    const mail = parseEml(raw);
    expect(mail.html).toContain("<p>oi</p>");
    expect(mail.text).toBeNull();
  });
});

describe("decodeEncodedWords", () => {
  it("devolve null para entrada ausente", () => {
    expect(decodeEncodedWords(null)).toBeNull();
    expect(decodeEncodedWords(undefined)).toBeNull();
    expect(decodeEncodedWords("")).toBeNull();
  });

  it("[achado] encoded-words adjacentes ficam com espaço duplo", () => {
    // ACHADO. O `.replace(/\?=\s+=\?/g, "")` no fim de `decodeEncodedWords`
    // roda DEPOIS da decodificação, quando nenhum `?= =?` sobrou no texto — é
    // código inalcançável. A RFC 2047 manda descartar o espaço entre dois
    // encoded-words adjacentes; aqui ele é preservado e soma ao espaço que o
    // `_` do Q-encoding produziu.
    //
    // Custo: cosmético no assunto guardado. Fixado para o dia em que alguém
    // mover esse replace para antes da decodificação — o teste vai avisar.
    const joined = decodeEncodedWords("=?UTF-8?Q?Senior_?= =?UTF-8?Q?Architect?=");

    expect(joined).toBe("Senior  Architect");
  });

  it("aceita o marcador em minúscula", () => {
    expect(decodeEncodedWords("=?utf-8?b?b2xh?=")).toBe("ola");
  });

  it("aceita encoded-word vazio", () => {
    expect(decodeEncodedWords("prefixo =?UTF-8?B??= sufixo")).toBe("prefixo  sufixo");
  });
});

/* --------------------------------------------------------- classify ------ */

function mailOf(
  subject: string | null,
  from: string | null = "no-reply@ashbyhq.com",
  name: string | null = null,
): ParsedMail {
  return {
    messageId: "x",
    from: { name, address: from },
    subject,
    date: null,
    html: null,
    text: null,
    headers: {},
  };
}

describe("detectProvider", () => {
  it("devolve null sem endereço, em vez de estourar", () => {
    // Mensagem sem From existe: export manual e mensagem gerada por regra local.
    expect(detectProvider(null)).toBeNull();
  });

  it("reconhece subdomínio e domínio brasileiro", () => {
    expect(detectProvider("x@mail.myworkdayjobs.com")).toBe("workday");
    expect(detectProvider("x@revelo.com.br")).toBe("revelo");
    expect(detectProvider("x@apply.workablemail.com")).toBe("workable");
  });

  it("não confunde domínio que apenas termina parecido", () => {
    // `naolinkedin.com` casaria numa regex sem a âncora de ponto.
    expect(detectProvider("x@naolinkedin.com")).toBeNull();
  });
});

describe("classify: bordas", () => {
  it("classifica mensagem sem assunto e sem remetente sem estourar", () => {
    // Todo o haystack vem de campos opcionais. Se um `?? ""` sumir, isso aqui
    // vira TypeError no meio de uma importação em lote.
    const r = classify(mailOf(null, null), "we have received your application");

    expect(r.kind).toBe("ats_received");
    expect(r.provider).toBeNull();
    // Sem provedor conhecido, a confiança fica na base da regra.
    expect(r.confidence).toBe(0.8);
  });

  it("olha só os primeiros 6000 caracteres do corpo", () => {
    // Um digest longo pode citar qualquer frase; deixar o corpo inteiro decidir
    // faria uma descrição de vaga classificar o e-mail.
    const enterrado = `${"a".repeat(6100)} we have received your application`;

    expect(classify(mailOf("Assunto neutro", "x@random.com"), enterrado).kind).toBe("unknown");
  });

  it("o assunto decide mesmo quando o corpo está vazio", () => {
    expect(classify(mailOf("Job alert: 5 novas vagas", "x@random.com"), "").kind).toBe("job_alert");
  });

  it("mensagem com sinal de entrevista E de rejeição cai em unknown", () => {
    // Este é o viés declarado no topo do módulo levado ao extremo, e vale fixar
    // porque não é óbvio: a regra de rejeição é bloqueada pelo `none` que cita
    // "schedule your interview", e a de entrevista é bloqueada pelo `none` que
    // cita as frases de rejeição. As duas se anulam e sobra `unknown`.
    //
    // É o resultado seguro. Uma classificação errada aqui moveria — ou pediria
    // para mover — um processo vivo; `unknown` custa uma edição manual.
    const r = classify(
      mailOf("Next steps"),
      "Unfortunately, we could not fit you last time. Now we want to schedule your interview.",
    );

    expect(r.kind).toBe("unknown");
    // Sem a frase de rejeição, a mesma mensagem é entrevista.
    expect(classify(mailOf("Next steps"), "we want to schedule your interview").kind).toBe(
      "ats_interview",
    );
  });

  it("devolve o sinal que decidiu, para o usuário poder discordar", () => {
    const r = classify(mailOf("x"), "we are pleased to offer you the position");

    expect(r.kind).toBe("ats_offer");
    expect(r.signal).toContain("proposta:");
    // O sinal carrega a própria regex: é o que torna a decisão auditável.
    expect(r.signal).toContain("pleased to");
  });

  it("mensagem sem classificação não inventa sinal nenhum", () => {
    const r = classify(mailOf("Boletim", "news@random.com"), "leia nosso resumo semanal");

    expect(r).toMatchObject({ kind: "unknown", confidence: 0, signal: null });
  });
});

/* -------------------------------------------------------- job alert ------ */

describe("canonicalJobUrl", () => {
  it("mantém o id como identidade e descarta o resto", () => {
    expect(canonicalJobUrl("https://br.linkedin.com/comm/jobs/view/4231234567/?refId=z")).toBe(
      "https://www.linkedin.com/jobs/view/4231234567",
    );
  });

  it("para link que não é de vaga, corta só o rastreamento", () => {
    expect(canonicalJobUrl("https://exemplo.test/pagina?utm_source=email")).toBe(
      "https://exemplo.test/pagina",
    );
  });
});

describe("extractAlertJobs: template em html", () => {
  it("lê o link mesmo sem âncora envolvendo a URL", () => {
    // Alguns clientes de e-mail entregam a URL em texto puro. Sem âncora não há
    // título, e o certo é contar como não resolvido, não como vaga fantasma.
    const html = "<p>https://www.linkedin.com/jobs/view/4231234567</p>";
    const r = extractAlertJobs(html, null);

    expect(r.jobs).toHaveLength(0);
    expect(r.unresolved).toBe(1);
    expect(r.warnings.join(" ")).toContain("template do e-mail pode ter mudado");
  });

  it("descarta rótulo curto demais para ser cargo", () => {
    const html = '<a href="https://www.linkedin.com/jobs/view/4231234567">Ir</a>';

    expect(extractAlertJobs(html, null).unresolved).toBe(1);
  });

  it("aceita vaga sem local, sem inventar um", () => {
    const html = `<div>
      <a href="https://www.linkedin.com/jobs/view/4231234567">Principal Engineer</a>
      <span>Nubank</span>
    </div>`;
    const [vaga] = extractAlertJobs(html, null).jobs;

    expect(vaga).toMatchObject({ companyName: "Nubank", location: null });
  });

  it("descarta o carimbo de tempo relativo, que não é empresa nem local", () => {
    const html = `<div>
      <a href="https://www.linkedin.com/jobs/view/4231234567">Principal Engineer</a>
      <span>3 days ago</span> · <span>Nubank</span> · <span>Remote</span>
    </div>`;
    const [vaga] = extractAlertJobs(html, null).jobs;

    expect(vaga?.companyName).toBe("Nubank");
    expect(vaga?.location).toBe("Remote");
  });

  it("mistura resolvidas e não resolvidas, contando as duas", () => {
    // O caso real de troca parcial de template: metade continua legível. Só
    // relatar as boas esconderia que o parser está perdendo a outra metade.
    const html = `<div>
      <a href="https://www.linkedin.com/jobs/view/4231234567">Principal Engineer</a>
      <span>Nubank</span>
    </div>
    <div>
      <a href="https://www.linkedin.com/comm/jobs/view/4239876543">Apply now</a>
    </div>`;
    const r = extractAlertJobs(html, null);

    expect(r.jobs).toHaveLength(1);
    expect(r.unresolved).toBe(1);
    expect(r.warnings).toHaveLength(1);
  });

  it("recorre à versão texto quando o html existe mas não rende nada", () => {
    // O aviso composto é o ponto: o usuário fica sabendo que o html quebrou
    // mesmo tendo recebido as vagas pelo caminho alternativo.
    const html = '<a href="https://www.linkedin.com/jobs/view/999">View job</a>';
    const text = [
      "Nubank",
      "Senior AI Solutions Architect",
      "https://www.linkedin.com/jobs/view/4231234567",
    ].join("\n");

    const r = extractAlertJobs(html, text);

    expect(r.jobs).toHaveLength(1);
    expect(r.warnings.join(" ")).toContain("template");
    expect(r.warnings.join(" ")).toContain("Recuperado da versão texto");
  });

  it("devolve o diagnóstico do html quando nem o texto salva", () => {
    const html = '<a href="https://www.linkedin.com/jobs/view/999">View job</a>';
    const r = extractAlertJobs(html, "nada de útil aqui");

    expect(r.jobs).toHaveLength(0);
    expect(r.warnings.join(" ")).toContain("template");
    expect(r.warnings.join(" ")).not.toContain("Recuperado");
  });
});

describe("extractAlertJobs: template em texto", () => {
  it("ignora link sem título na linha de cima", () => {
    const text = ["", "https://www.linkedin.com/jobs/view/4231234567"].join("\n");

    expect(extractAlertJobs(null, text).jobs).toHaveLength(0);
  });

  it("aceita link na primeira linha útil, sem empresa acima", () => {
    const text = ["Senior AI Solutions Architect", "https://www.linkedin.com/jobs/view/4231234567"]
      .join("\n");
    const [vaga] = extractAlertJobs(null, text).jobs;

    expect(vaga).toMatchObject({
      title: "Senior AI Solutions Architect",
      companyName: null,
      location: null,
    });
  });

  it("não repete a mesma vaga listada duas vezes no texto", () => {
    const bloco = [
      "Nubank",
      "Senior AI Solutions Architect",
      "https://www.linkedin.com/jobs/view/4231234567",
    ];
    const r = extractAlertJobs(null, [...bloco, ...bloco].join("\n"));

    expect(r.jobs).toHaveLength(1);
  });

  it("avisa quando o texto não tem vaga nenhuma", () => {
    expect(extractAlertJobs(null, "só um rodapé").warnings.join(" ")).toContain(
      "Nenhuma vaga extraída",
    );
  });
});

describe("toRawJobs", () => {
  it("converte sem inventar descrição — alerta é ponteiro, não anúncio", () => {
    // Trava 2 do ADR 0008: a URL é sinal, nunca alvo. Nada aqui pode seguir o
    // link; a resolução completa é trabalho das fontes públicas de ATS.
    const extraction = extractAlertJobs(
      `<div>
        <a href="https://www.linkedin.com/comm/jobs/view/4231234567/?t=1">Staff Engineer</a>
        <span>Datadog</span> · <span>Remote - LATAM</span>
      </div>`,
      null,
    );

    const [raw] = toRawJobs(extraction, "2026-08-17T12:00:00.000Z");

    expect(raw).toMatchObject({
      externalId: "4231234567",
      companyName: "Datadog",
      title: "Staff Engineer",
      url: "https://www.linkedin.com/jobs/view/4231234567",
      applyUrl: "https://www.linkedin.com/jobs/view/4231234567",
      locationRaw: "Remote - LATAM",
      descriptionHtml: null,
      descriptionText: null,
      postedAt: "2026-08-17T12:00:00.000Z",
    });
    expect(raw?.raw).toMatchObject({ source: "linkedin_job_alert" });
  });

  it("usa a URL como identidade quando não há id, e nomeia empresa desconhecida", () => {
    // A impressão digital do banco usa empresa e cargo. "Desconhecida" mantém a
    // linha inserível sem fingir um nome que ninguém informou.
    const [raw] = toRawJobs(
      {
        jobs: [
          {
            title: "Cargo Sem Id",
            companyName: null,
            location: null,
            url: "https://exemplo.test/vaga",
            externalId: null,
          },
        ],
        unresolved: 0,
        warnings: [],
      },
      null,
    );

    expect(raw).toMatchObject({
      externalId: "https://exemplo.test/vaga",
      companyName: "Desconhecida",
      postedAt: null,
    });
  });
});
