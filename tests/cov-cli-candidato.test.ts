/**
 * Suíte: os comandos de `src/cli.ts` que escrevem sobre o **candidato** e sobre
 * as **contas** — `cv set`, `cv import`, `skills confirm|reject`,
 * `auth add-user`, `auth set-password`, `auth login`, `auth revoke`.
 *
 * ## Por que estes entram no corte do E-08
 *
 * Duas razões diferentes, e vale separá-las.
 *
 * O currículo e a auditoria de skills são material que o sistema não
 * reconstrói: a regra 7 do CLAUDE.md — só skill **confirmada** pode ser citada
 * como experiência — é uma coluna de banco, e quem a escreve é este comando.
 * Confirmar a linha errada é o sistema passar a afirmar experiência que a
 * pessoa não tem.
 *
 * As contas são a superfície onde a CLI é a **única** interface: não há tela
 * para criar usuário nem para definir senha, e a regra 14 diz que sem conta
 * ninguém entra. Um defeito aqui não tem caminho alternativo que o contorne.
 *
 * ## O que estes casos procuram
 *
 * O mesmo de sempre no E-08: a faixa entre o argv e a função de domínio. Aqui
 * ela é mais larga que nos outros comandos — `auth add-user` valida papel,
 * deriva `candidateId` a partir do papel e normaliza e-mail, tudo dentro do
 * handler, sem passar por nenhuma função com teste próprio.
 *
 * Fronteira DENTRO: análise de argumento, defaults, validação, persistência.
 * Fronteira FORA: rede e terminal interativo de verdade (`process.stdin` é
 * substituído por um fluxo fixo).
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCandidateFromProfile } from "../src/core/candidate.ts";
import {
  authLoginToken,
  authUser,
  candidateDocument,
  candidateSkill,
  skill,
} from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, comStdin, rodar } from "./cov-cli-harness.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

beforeAll(async () => {
  await carregarCli();
});

beforeEach(async () => {
  await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

async function arquivoTemporario(nome: string, conteudo: string | Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jho-cli-"));
  const caminho = join(dir, nome);
  await writeFile(caminho, conteudo as never);
  return caminho;
}

const CURRICULO = [
  "Andreus Timm — Senior AI Software Architect",
  "Vinte anos construindo sistemas distribuídos, plataformas de dados e",
  "orquestração de modelos de linguagem em produção, com foco em avaliação",
  "e observabilidade do que o modelo responde.",
].join("\n");

/**
 * PDF sintético mínimo.
 *
 * Um currículo de verdade é material pessoal e não entra no repositório; um
 * binário de fixture esconderia o que está sendo testado. Montar o arquivo aqui
 * deixa explícito qual característica dispara cada caminho do comando.
 */
function pdfComLinhas(linhas: string[]): Uint8Array {
  const fluxo = linhas
    .map((linha, n) => {
      const escapada = linha.replace(/([\\()])/g, "\\$1");
      return `BT /F1 10 Tf 20 ${740 - n * 14} Td (${escapada}) Tj ET`;
    })
    .join("\n");
  const objetos = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[4 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    "4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 9000 792]" +
      "/Resources<</Font<</F1 3 0 R>>>>/Contents 5 0 R>>endobj",
    `5 0 obj<</Length ${fluxo.length}>>stream\n${fluxo}\nendstream endobj`,
  ];
  return new TextEncoder().encode(`%PDF-1.4\n${objetos.join("\n")}\ntrailer<</Root 1 0 R>>`);
}

describe("jho cv set <file>", () => {
  it("salva a versão e usa o nome do arquivo como rótulo padrão", async () => {
    const caminho = await arquivoTemporario("cv-2026-08.md", CURRICULO);

    const r = await rodar("cv", "set", caminho);

    expect(r.code).toBeUndefined();
    const [doc] = await banco().select().from(candidateDocument);
    expect(doc?.kind).toBe("cv");
    // O rótulo padrão é o `basename`, não o caminho inteiro: o caminho
    // absoluto de um `/var/folders/...` não diz nada na lista de versões.
    expect(doc?.label).toBe("cv-2026-08.md");
    expect(doc?.isCurrent).toBe(true);
  });

  it("`-l` substitui o rótulo", async () => {
    const caminho = await arquivoTemporario("cv.md", CURRICULO);

    await rodar("cv", "set", caminho, "-l", "variante arquiteto");

    const [doc] = await banco().select().from(candidateDocument);
    expect(doc?.label).toBe("variante arquiteto");
  });

  /**
   * Cem caracteres é o piso que separa "currículo" de "arquivo errado". Sem
   * essa guarda, apontar para o `.gitignore` por engano gravaria uma versão
   * vazia, aposentaria a boa e a análise de lacuna de vocabulário passaria a
   * comparar o mercado contra nada.
   */
  it("recusa arquivo curto demais com código 1 e não grava versão", async () => {
    const caminho = await arquivoTemporario("vazio.md", "duas linhas\nsó");

    const r = await rodar("cv", "set", caminho);

    expect(r.code).toBe(1);
    expect(r.err).toContain("curto demais");
    expect(await banco().select().from(candidateDocument)).toHaveLength(0);
  });

  it("a segunda versão aposenta a primeira em vez de sobrescrevê-la", async () => {
    const primeiro = await arquivoTemporario("v1.md", CURRICULO);
    const segundo = await arquivoTemporario("v2.md", `${CURRICULO}\nAgora com uma linha a mais.`);

    await rodar("cv", "set", primeiro);
    const r = await rodar("cv", "set", segundo);

    expect(r.out).toContain("versão anterior arquivada");
    const docs = await banco().select().from(candidateDocument);
    expect(docs).toHaveLength(2);
    expect(docs.filter((d) => d.isCurrent)).toHaveLength(1);
  });

  it("arquivo inexistente vira erro de sistema, não versão vazia", async () => {
    const r = await rodar("cv", "set", join(tmpdir(), "jho-nao-existe-xyz.md"));

    expect((r.erro as Error).message).toContain("ENOENT");
    expect(await banco().select().from(candidateDocument)).toHaveLength(0);
  });
});

describe("jho cv import <file>", () => {
  it("`--dry-run` mostra o texto extraído e não grava versão", async () => {
    const caminho = await arquivoTemporario(
      "cv.pdf",
      pdfComLinhas(Array.from({ length: 6 }, (_, i) => `Linha ${i}: ${CURRICULO.slice(0, 60)}`)),
    );

    const r = await rodar("cv", "import", caminho, "--dry-run");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("início");
    expect(await banco().select().from(candidateDocument)).toHaveLength(0);
  });

  it("salva quando há texto suficiente, com o nome do PDF como rótulo", async () => {
    const caminho = await arquivoTemporario(
      "curriculo.pdf",
      pdfComLinhas(Array.from({ length: 6 }, (_, i) => `Linha ${i}: ${CURRICULO.slice(0, 60)}`)),
    );

    const r = await rodar("cv", "import", caminho);

    expect(r.code).toBeUndefined();
    const [doc] = await banco().select().from(candidateDocument);
    expect(doc?.label).toBe("curriculo.pdf");
    // O aviso não é decoração: extração de PDF erra, e gravar sem dizer isso
    // faria a pessoa tratar o texto como conferido.
    expect(r.out).toContain("Extração de PDF erra");
  });

  /**
   * PDF de currículo digitalizado sai vazio na extração — é imagem, não texto.
   * O comando precisa recusar em vez de aposentar a versão boa por uma vazia.
   */
  it("recusa PDF sem texto extraível com código 1 e não grava nada", async () => {
    const caminho = await arquivoTemporario("scan.pdf", pdfComLinhas(["Andreus"]));

    const r = await rodar("cv", "import", caminho);

    expect(r.code).toBe(1);
    expect(r.err).toContain("Texto insuficiente");
    expect(await banco().select().from(candidateDocument)).toHaveLength(0);
  });
});

describe("jho skills confirm | reject", () => {
  /** Uma skill detectada, no estado em que o extrator a deixa. */
  async function semearDeteccao(candidatoId: number): Promise<number> {
    const db = banco();
    const [s] = await db
      .insert(skill)
      .values({
        slug: "rag",
        canonicalName: "RAG",
        category: "ai",
        aliases: ["retrieval augmented generation"],
      })
      .returning({ id: skill.id });
    const [cs] = await db
      .insert(candidateSkill)
      .values({
        candidateId: candidatoId,
        skillId: s!.id,
        evidence: "Construí pipelines de RAG com avaliação offline.",
      })
      .returning({ id: candidateSkill.id });
    return cs!.id;
  }

  it("confirmar promove o estado e grava o nível que a pessoa informou", async () => {
    const candidatoId = await syncCandidateFromProfile();
    const id = await semearDeteccao(candidatoId);

    const r = await rodar("skills", "confirm", String(id), "-l", "avançado");

    expect(r.code).toBeUndefined();
    const [linha] = await banco().select().from(candidateSkill);
    expect(linha?.status).toBe("confirmed");
    // `level` é o único campo que o sistema nunca infere — vem da pessoa ou
    // fica nulo. Perdê-lo no caminho seria perder a única opinião humana ali.
    expect(linha?.level).toBe("avançado");
    expect(linha?.auditedAt).not.toBeNull();
  });

  it("confirmar sem `-l` deixa o nível nulo em vez de inventar um", async () => {
    const candidatoId = await syncCandidateFromProfile();
    const id = await semearDeteccao(candidatoId);

    await rodar("skills", "confirm", String(id));

    const [linha] = await banco().select().from(candidateSkill);
    expect(linha?.status).toBe("confirmed");
    expect(linha?.level).toBeNull();
  });

  it("rejeitar marca o falso positivo sem apagar a linha", async () => {
    const candidatoId = await syncCandidateFromProfile();
    const id = await semearDeteccao(candidatoId);

    const r = await rodar("skills", "reject", String(id));

    expect(r.code).toBeUndefined();
    const [linha] = await banco().select().from(candidateSkill);
    // Apagar faria o próximo `skills detect` redetectar e reoferecer a mesma
    // skill; o registro de "já olhei e não é" é o que impede o loop.
    expect(linha?.status).toBe("rejected");
    expect(linha?.evidence).toContain("RAG");
  });

  it("id que não pertence ao candidato falha em vez de não fazer nada", async () => {
    await syncCandidateFromProfile();

    const r = await rodar("skills", "confirm", "4242");

    expect((r.erro as Error).message).toContain("4242");
  });
});

describe("jho auth add-user <email>", () => {
  /**
   * CARACTERIZAÇÃO DE DEFEITO — o papel padrão `owner` não existe mais.
   *
   * `ROLES` é `["admin", "candidate", "recruiter"]` (ver
   * `src/contexts/auth/domain/types.ts`), mas a opção `--role` de
   * `auth add-user` continua com `"owner"` como default e "owner | admin" no
   * texto de ajuda. Resultado: `jho auth add-user <email>` — sem flag nenhuma,
   * que é a forma mais óbvia de usar o comando — é recusado pela própria
   * validação do handler.
   *
   * Isto é grave por onde aparece: a regra 14 do CLAUDE.md manda
   * `jho auth add-user <email> --role owner` como primeiro acesso, e `/login`
   * mostra esse comando a quem não tem conta. O vocabulário mudou num arquivo
   * e a CLI ficou para trás — o mesmo gênero de defeito que E-06 descreve, em
   * que cada metade está certa sozinha.
   *
   * O caso trava o comportamento de hoje. Quando o default virar `candidate`
   * ou `admin`, é aqui que a mudança aparece.
   */
  it("cria a conta com o papel padrão, sem precisar de flag", async () => {
    // Caracterizava um defeito e agora afirma a correção. O padrão era `owner`,
    // papel que saiu do vocabulário quando os três entraram: o comando que a
    // regra 14 manda rodar e que `/login` mostra para quem não tem conta
    // falhava com "Papel inválido: owner" — o primeiro acesso ao sistema estava
    // quebrado.
    const r = await rodar("auth", "add-user", "andreus@exemplo.test");

    expect(r.code).toBeUndefined();
    const [conta] = await banco().select().from(authUser);
    expect(conta?.roles).toEqual(["candidate"]);
  });

  it("cria a conta quando o papel está no vocabulário atual", async () => {
    const r = await rodar("auth", "add-user", "andreus@exemplo.test", "--role", "admin");

    expect(r.code).toBeUndefined();
    const [conta] = await banco().select().from(authUser);
    expect(conta?.email).toBe("andreus@exemplo.test");
    expect(conta?.roles).toEqual(["admin"]);
  });

  it("aceita vários papéis separados por vírgula, aparando o espaço", async () => {
    await rodar("auth", "add-user", "dono@exemplo.test", "--role", "admin, candidate");

    const [conta] = await banco().select().from(authUser);
    expect(conta?.roles).toEqual(["admin", "candidate"]);
  });

  it("basta um papel inválido na lista para recusar tudo", async () => {
    const r = await rodar("auth", "add-user", "x@exemplo.test", "--role", "admin,owner");

    // Criar parcialmente seria pior que recusar: a conta existiria com menos
    // permissão do que quem digitou acha que pediu.
    expect(r.code).toBe(1);
    expect(r.err).toContain("owner");
    expect(await banco().select().from(authUser)).toHaveLength(0);
  });

  it("normaliza o e-mail para minúsculas e sem espaço nas pontas", async () => {
    await rodar("auth", "add-user", "  Andreus@Exemplo.TEST  ", "--role", "admin");

    const [conta] = await banco().select().from(authUser);
    // `auth_user.email` tem índice único; sem normalizar, a mesma pessoa teria
    // duas contas e o login pegaria a que ela não usa.
    expect(conta?.email).toBe("andreus@exemplo.test");
  });

  it("`--candidate` aponta a conta para um candidato existente", async () => {
    const candidatoId = await syncCandidateFromProfile();

    await rodar(
      "auth", "add-user", "recrutador@exemplo.test",
      "--role", "recruiter",
      "--candidate", String(candidatoId),
    );

    const [conta] = await banco().select().from(authUser);
    expect(conta?.candidateId).toBe(candidatoId);
  });

  /**
   * Consequência do defeito acima: `candidateId` só é derivado do perfil
   * quando o papel inclui `owner` — que nunca passa da validação. Toda conta
   * criada por este comando sem `--candidate` nasce com `candidateId` nulo,
   * inclusive uma de papel `candidate`, que é justamente a que precisaria dele.
   */
  it("sem `--candidate`, o papel candidate deriva o candidato do perfil", async () => {
    // A derivação lia `roles.includes("owner")` e virou código morto na
    // renomeação: toda conta nascia com `candidateId` nulo, inclusive uma de
    // papel candidato — justamente a que precisa dele para ter currículo e
    // funil.
    await rodar("auth", "add-user", "candidato@exemplo.test", "--role", "candidate");

    const [conta] = await banco().select().from(authUser);
    expect(conta?.candidateId).not.toBeNull();
  });

  it("rodar de novo atualiza a conta em vez de duplicar", async () => {
    await rodar("auth", "add-user", "eu@exemplo.test", "--role", "candidate");
    await rodar("auth", "add-user", "eu@exemplo.test", "--role", "admin,candidate");

    const contas = await banco().select().from(authUser);
    expect(contas).toHaveLength(1);
    expect(contas[0]?.roles).toEqual(["admin", "candidate"]);
  });
});

describe("jho auth set-password <email>", () => {
  async function contaExistente(email = "eu@exemplo.test"): Promise<void> {
    await rodar("auth", "add-user", email, "--role", "admin");
  }

  it("`--stdin` lê uma linha e grava o hash — nunca a senha", async () => {
    await contaExistente();

    const r = await comStdin("senha-bem-longa-2026\n", () =>
      rodar("auth", "set-password", "eu@exemplo.test", "--stdin"),
    );

    expect(r.code).toBeUndefined();
    const [conta] = await banco().select().from(authUser);
    expect(conta?.passwordHash).toMatch(/^scrypt\$/);
    expect(conta?.passwordHash).not.toContain("senha-bem-longa-2026");
    // A troca derruba sessão: quem recupera senha costuma suspeitar de acesso
    // indevido, e manter a sessão antiga viva anularia o motivo da troca.
    expect(r.out).toContain("Sessões anteriores foram encerradas");
  });

  it("recusa senha abaixo do mínimo com código 1, sem gravar hash", async () => {
    await contaExistente();

    const r = await comStdin("curta\n", () =>
      rodar("auth", "set-password", "eu@exemplo.test", "--stdin"),
    );

    expect(r.code).toBe(1);
    expect(r.err).toContain("Mínimo de 12 caracteres");
    const [conta] = await banco().select().from(authUser);
    expect(conta?.passwordHash).toBeNull();
  });

  it("conta inexistente sai com código 1 e diz qual comando cria a conta", async () => {
    const r = await comStdin("senha-bem-longa-2026\n", () =>
      rodar("auth", "set-password", "ninguem@exemplo.test", "--stdin"),
    );

    expect(r.code).toBe(1);
    expect(r.err).toContain("jho auth add-user");
  });

  /**
   * Sem `--stdin` o comando abre readline e pede duas vezes. O caso substitui
   * `process.stdin` por um fluxo com duas linhas diferentes: é a única forma
   * de exercitar a comparação de confirmação, que só existe nesse ramo.
   */
  it("no modo interativo, senhas diferentes saem com código 1", async () => {
    await contaExistente();

    const r = await comStdin("senha-bem-longa-2026\noutra-senha-bem-longa\n", () =>
      rodar("auth", "set-password", "eu@exemplo.test"),
    );

    expect(r.code).toBe(1);
    expect(r.err).toContain("não conferem");
    const [conta] = await banco().select().from(authUser);
    expect(conta?.passwordHash).toBeNull();
  });
});

describe("jho auth login | revoke", () => {
  it("emite o link e guarda só o hash do token", async () => {
    await rodar("auth", "add-user", "eu@exemplo.test", "--role", "admin");

    const r = await rodar("auth", "login", "eu@exemplo.test");

    const token = /token=([A-Za-z0-9_-]+)/.exec(r.out)?.[1];
    expect(token).toBeTruthy();
    const [linha] = await banco().select().from(authLoginToken);
    // Mesma razão do `auth_session`: cópia do banco não pode ser cópia das
    // credenciais. O token impresso não existe em lugar nenhum da tabela.
    expect(linha?.tokenHash).not.toBe(token);
    expect(linha?.purpose).toBe("login");
    expect(linha?.usedAt).toBeNull();
  });

  it("e-mail sem conta recebe link igual — não dá para enumerar cadastro", async () => {
    const r = await rodar("auth", "login", "ninguem@exemplo.test");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("/login/callback?token=");
  });

  it("revogar conta inexistente sai com código 1", async () => {
    const r = await rodar("auth", "revoke", "ninguem@exemplo.test");

    expect(r.code).toBe(1);
    expect(r.err).toContain("não existe");
  });

  it("revogar conta existente informa quantas sessões caíram", async () => {
    await rodar("auth", "add-user", "eu@exemplo.test", "--role", "admin");

    const r = await rodar("auth", "revoke", "eu@exemplo.test");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("0 sessão(ões) encerrada(s)");
  });
});
