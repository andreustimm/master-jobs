// Suite: adaptador de careers page (src/core/sources/careers.ts), caminho completo
// Invariante: esta é a fonte que existe para resolver um número — 73,6% do acervo
// vem de agregador que esconde o empregador. Toda decisão aqui é subordinada a
// "sair com empregador nomeado": mesmo sem conseguir abrir o anúncio, a vaga da
// listagem é preservada, porque uma vaga com empresa e sem corpo ainda vale mais
// que nenhuma vaga.
// Fronteira DENTRO: robots, listagem, detalhe, extração e os avisos.
// Fronteira FORA: rede (porta HTTP) e o scorer.
//
// Convenção das fixtures: a listagem mora em /careers e os anúncios em /vagas/*.
// `fixtureHttp` casa por substring, então caminhos aninhados sob a listagem
// fariam o dublê devolver a listagem no lugar do anúncio.
import { afterEach, describe, expect, it } from "vitest";
import { careersAdapter, findJobAnchors, splitAnchorText } from "../src/core/sources/careers.ts";
import { fixtureHttp, resetHttpPort, setHttpPort } from "../src/core/sources/http-port.ts";
import "../src/core/sources/http.ts";
import { clearRobotsCache } from "../src/core/scrape/robots.ts";
import type { SourceConfig } from "../src/core/sources/types.ts";

/** Corpo longo o bastante para o extrator considerar descrição (>= 200 chars). */
const CORPO = "Construímos infraestrutura de agentes para empresas. ".repeat(8);

function config(handle: string, label = "Acme Corp"): SourceConfig {
  return { kind: "careers", handle, label };
}

afterEach(() => {
  resetHttpPort();
  // O cache de robots é por origem e vive no módulo; sem limpar, a regra de um
  // teste decidiria o acesso do seguinte.
  clearRobotsCache();
});

describe("findJobAnchors", () => {
  it("ignora href que nem chega a ser URL, sem derrubar a varredura", () => {
    // Uma página com um link malformado no rodapé não pode custar todas as vagas
    // que estão acima dele.
    const html = [
      '<a href="http://[::1">Endereço quebrado que parece vaga</a>',
      '<a href="/vagas/staff-engineer">Staff Engineer</a>',
    ].join("");
    const anchors = findJobAnchors(html, "https://acme.test/careers");
    expect(anchors.map((a) => a.text)).toEqual(["Staff Engineer"]);
  });
});

describe("careersAdapter", () => {
  it("no modo listagem não abre nenhum anúncio", async () => {
    // `listOnly` é a troca explícita entre velocidade e sinal: barato, mas o
    // score sai só do título. O teste prova que ele realmente não busca nada.
    const port = fixtureHttp({
      "acme.test/robots.txt": "",
      "acme.test/careers": [
        '<a href="/vagas/staff-engineer">Staff Engineer\nRemote</a>',
        '<a href="/vagas/principal-architect">Principal Architect</a>',
      ].join(""),
    });
    setHttpPort(port);

    const { jobs, warnings } = await careersAdapter({ listOnly: true }).fetchJobs(
      config("https://acme.test/careers"),
    );

    expect(jobs.map((j) => j.externalId)).toEqual([
      "vagas-staff-engineer",
      "vagas-principal-architect",
    ]);
    expect(jobs.every((j) => j.companyName === "Acme Corp")).toBe(true);
    expect(jobs[0]!.descriptionText).toBeUndefined();
    expect(warnings).toEqual([]);
    expect(port.calls.some((c) => c.includes("/vagas/"))).toBe(false);
  });

  it("limita quantas vagas uma única empresa contribui por sync", async () => {
    // Sem teto, um board com 400 anúncios domina a fila de captura e afoga as
    // outras empresas do dia.
    const port = fixtureHttp({
      "big.test/robots.txt": "",
      "big.test/careers": Array.from(
        { length: 5 },
        (_, i) => `<a href="/vagas/vaga-${i}">Engenheiro de Plataforma ${i}</a>`,
      ).join(""),
    });
    setHttpPort(port);

    const { jobs } = await careersAdapter({ maxJobs: 2, listOnly: true }).fetchJobs(
      config("https://big.test/careers"),
    );
    expect(jobs).toHaveLength(2);
  });

  it("mantém a vaga da listagem quando robots.txt proíbe só o anúncio", async () => {
    // Regra herdada da ADR 0001: a proibição é obedecida. Mas obedecer não é
    // desistir — o que a listagem já mostrou publicamente continua valendo.
    const port = fixtureHttp({
      "parcial.test/robots.txt": "User-agent: *\nDisallow: /vagas/secreta",
      "parcial.test/vagas/aberta": `<div class="job-description"><p>${CORPO}</p></div>`,
      "parcial.test/careers": [
        '<a href="/vagas/secreta-vaga">Vaga Reservada</a>',
        '<a href="/vagas/aberta">Vaga Aberta</a>',
      ].join(""),
    });
    setHttpPort(port);

    const { jobs, warnings } = await careersAdapter().fetchJobs(
      config("https://parcial.test/careers"),
    );

    expect(jobs.map((j) => j.title)).toEqual(["Vaga Reservada", "Vaga Aberta"]);
    expect(warnings.join(" ")).toContain("robots.txt não permite");
    // A vaga proibida entrou sem corpo, e o anúncio não foi buscado assim mesmo.
    expect(jobs[0]!.descriptionText).toBeUndefined();
    expect(port.calls.some((c) => c.endsWith("/vagas/secreta-vaga"))).toBe(false);
    expect(jobs[1]!.descriptionText).toContain("infraestrutura de agentes");
  });

  it("mantém a vaga quando o anúncio não responde, sem inventar aviso", async () => {
    // Página fora do ar é um fato sobre aquela página. A entrada da listagem já
    // traz título, empresa e URL — o suficiente para o usuário decidir abrir.
    setHttpPort(
      fixtureHttp({
        "off.test/robots.txt": "",
        "off.test/vagas/some": { status: 500 },
        "off.test/careers": '<a href="/vagas/some">Engenheiro Sênior</a>',
      }),
    );

    const { jobs, warnings } = await careersAdapter().fetchJobs(config("https://off.test/careers"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.title).toBe("Engenheiro Sênior");
    expect(jobs[0]!.descriptionHtml).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("extrai campos e requisitos do anúncio e nomeia o empregador do config", async () => {
    // O nome vem da configuração de propósito: adivinhá-lo pelo <title> traria de
    // volta exatamente a ambiguidade que este adapter existe para eliminar.
    setHttpPort(
      fixtureHttp({
        "rico.test/robots.txt": "User-agent: *\nDisallow: /admin",
        "rico.test/vagas/staff-ai-engineer": `<html><body><div class="job-description">
          <h1>Staff AI Engineer</h1>
          <p>${CORPO}</p>
          <p>Full-time, fully remote. Senior level. $180,000 - $220,000 per year.</p>
          <ul>
            <li>Oito anos ou mais desenhando sistemas backend distribuídos</li>
            <li>Experiência prática com Kubernetes e observabilidade em produção</li>
            <li>Home</li>
          </ul>
        </div></body></html>`,
        "rico.test/careers": '<a href="/vagas/staff-ai-engineer">Staff AI Engineer\nRemote — Brazil</a>',
      }),
    );

    const { jobs } = await careersAdapter().fetchJobs(config("https://rico.test/careers"));
    const job = jobs[0]!;

    expect(job.companyName).toBe("Acme Corp");
    expect(job.locationRaw).toBe("Remote — Brazil");
    expect(job.employmentType).toMatch(/full[- ]time/i);
    // Vale a PRIMEIRA ocorrência da página: o "Staff" do título vence o "Senior
    // level" do corpo. É o comportamento desejado — o cargo manda mais que uma
    // menção solta lá embaixo.
    expect(job.seniorityRaw).toBe("Staff");
    expect(job.remote).toBe(true);
    expect(job.descriptionText).toContain("infraestrutura de agentes");

    const raw = job.raw as { fields: Record<string, string>; requirements: string[] };
    expect(raw.fields.salary).toContain("180,000");
    // "Home" é menu disfarçado de requisito; entra como ruído no scorer.
    expect(raw.requirements).toHaveLength(2);
    expect(raw.requirements.join(" ")).not.toContain("Home");
  });

  it("marca remoto como falso quando o anúncio diz presencial", async () => {
    // Regra 8 tem limite: aqui o anúncio DISSE, e "on-site" declarado é
    // informação, não ausência.
    setHttpPort(
      fixtureHttp({
        "presencial.test/robots.txt": "",
        "presencial.test/vagas/onsite": `<div class="job-description"><p>Full-time, on-site in Austin, Texas.</p><p>${CORPO}</p></div>`,
        "presencial.test/careers": '<a href="/vagas/onsite">Engenheiro de Dados</a>',
      }),
    );

    const { jobs } = await careersAdapter().fetchJobs(config("https://presencial.test/careers"));
    expect(jobs[0]!.remote).toBe(false);
  });

  it("guarda o HTML mas não chama de descrição um anúncio curto demais", async () => {
    // Menos de 200 caracteres é fragmento — provavelmente um shell renderizado
    // por JavaScript. Chamá-lo de descrição envenenaria o score de keywords.
    setHttpPort(
      fixtureHttp({
        "curto.test/robots.txt": "",
        "curto.test/vagas/curta": "<div><p>Vaga aberta.</p></div>",
        "curto.test/careers": '<a href="/vagas/curta">Analista de Dados</a>',
      }),
    );

    const { jobs } = await careersAdapter().fetchJobs(config("https://curto.test/careers"));
    expect(jobs[0]!.descriptionText).toBeNull();
    // O HTML fica guardado: o extrator melhora com o tempo, a captura não volta.
    expect(jobs[0]!.descriptionHtml).toContain("Vaga aberta");
  });

  it("avisa quando a listagem não responde, em vez de reportar zero vagas", async () => {
    // "0 vagas" e "página fora do ar" se parecem no relatório e significam coisas
    // opostas para quem mantém a lista de fontes.
    setHttpPort(
      fixtureHttp({ "sem.test/robots.txt": "", "sem.test/careers": { status: 404 } }),
    );

    const result = await careersAdapter().fetchJobs(config("https://sem.test/careers"));
    expect(result.jobs).toEqual([]);
    expect(result.warnings.join(" ")).toContain("Sem resposta");
  });
});

describe("bordas do reconhecimento de anúncio", () => {
  it("não reconhece âncora sem texto nem âncora com um parágrafo inteiro dentro", () => {
    // Os dois extremos vêm do mesmo lugar: markup de careers page não segue
    // convenção. Um ícone dentro de <a> não tem título, e um card inteiro
    // embrulhado em <a> traria a descrição toda como se fosse o cargo — que
    // depois não casaria com cluster nenhum e pontuaria zero por formato.
    const html = [
      '<a href="/vagas/icone"><svg></svg></a>',
      `<a href="/vagas/card">${"Descrição comprida do cargo. ".repeat(10)}</a>`,
      '<a href="/vagas/real">Staff Engineer</a>',
    ].join("");

    const anchors = findJobAnchors(html, "https://acme.test/careers");
    expect(anchors.map((a) => a.text)).toEqual(["Staff Engineer"]);
  });

  it("aceita âncora sem nenhuma linha aproveitável sem produzir título indefinido", () => {
    // `splitAnchorText` é chamada com o resultado de `stripHtml`, que pode ser
    // vazio; devolver `undefined` como título quebraria o filtro de comprimento
    // logo em seguida com um TypeError no meio da varredura.
    expect(splitAnchorText("")).toEqual({ title: "", location: null });
    expect(splitAnchorText("\n \n")).toEqual({ title: "", location: null });
  });
});
