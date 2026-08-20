import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSecurityCheck, type Finding } from "../src/core/security.ts";

/**
 * `runSecurityCheck` é o único ponto do módulo que toca disco, e é onde mora
 * o risco real: quatro leituras que podem falhar de quatro formas diferentes.
 * Cada teste monta uma raiz falsa em /tmp, porque apontar para o repositório
 * de verdade transformaria estes casos em espelho do estado atual do projeto —
 * verdes por acidente e cegos para o que interessa.
 */
const raizes: string[] = [];

async function raizFalsa(): Promise<string> {
  const raiz = await mkdtemp(join(tmpdir(), "jho-sec-"));
  raizes.push(raiz);
  return raiz;
}

function achado(achados: Finding[], titulo: string): Finding {
  const encontrado = achados.find((f) => f.title === titulo);
  expect(encontrado, `sem achado "${titulo}"`).toBeDefined();
  return encontrado!;
}

afterEach(async () => {
  await Promise.all(raizes.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("runSecurityCheck: as quatro verificações contra disco", () => {
  it("um projeto sem nenhum dos arquivos ainda produz os quatro achados", async () => {
    // Diretório vazio é o estado logo depois de um clone parcial ou de um
    // `git clean` agressivo. A verificação não pode explodir por arquivo
    // ausente: um erro aqui faria `jho security check` deixar de rodar
    // justamente quando o repositório está em estado estranho.
    const achados = await runSecurityCheck(await raizFalsa());

    expect(achados).toHaveLength(4);
    // package.json ausente vira "{}": nenhum script para conferir, nada a
    // apontar. Ausência não pode virar acusação.
    expect(achado(achados, "Bind do servidor").level).toBe("ok");
    // .gitignore ausente é crítico de verdade — o banco com todo o histórico
    // de candidaturas entraria no primeiro `git add .`.
    expect(achado(achados, ".gitignore incompleto").level).toBe("critical");
    expect(achado(achados, "Dado pessoal versionado").level).toBe("ok");
    // Sem banco criado não há permissão a julgar.
    expect(achado(achados, "Permissões do banco").detail).toContain("ainda não criado");
  });

  it("lê os quatro arquivos e reprova por bind aberto e PII versionada", async () => {
    const raiz = await raizFalsa();
    await writeFile(
      join(raiz, "package.json"),
      JSON.stringify({ scripts: { dev: "next dev", start: "next start" } }),
    );
    await writeFile(join(raiz, ".gitignore"), "data/\n.env\nout/\n");
    await mkdir(join(raiz, "profile"), { recursive: true });
    await writeFile(
      join(raiz, "profile", "profile.yaml"),
      "identity:\n  phone: +55 (14) 98827-1204\n",
    );

    const achados = await runSecurityCheck(raiz);

    // O bind foi o problema que já esteve vivo aqui: o dashboard respondia em
    // 192.168.x.x servindo currículo e funil, sem autenticação nenhuma.
    expect(achado(achados, "Dashboard exposto na rede").level).toBe("critical");
    expect(achado(achados, ".gitignore").level).toBe("ok");
    // O telefone só é inofensivo enquanto o repositório for privado — o Git
    // guarda o histórico, então o aviso é sobre o futuro, não sobre o agora.
    expect(achado(achados, "Dado pessoal versionado")).toMatchObject({
      level: "warning",
      detail: expect.stringContaining("profile/profile.yaml"),
    });
  });

  it("passa limpo quando o projeto está configurado como deve", async () => {
    const raiz = await raizFalsa();
    await writeFile(
      join(raiz, "package.json"),
      JSON.stringify({
        scripts: {
          dev: "next dev --hostname 127.0.0.1",
          start: "next start --hostname 127.0.0.1",
        },
      }),
    );
    await writeFile(join(raiz, ".gitignore"), "data/\n.env\nout/\nnode_modules/\n");
    await mkdir(join(raiz, "profile"), { recursive: true });
    await writeFile(join(raiz, "profile", "profile.yaml"), "identity:\n  email: eu@empresa.com.br\n");
    await mkdir(join(raiz, "data"), { recursive: true });
    await writeFile(join(raiz, "data", "jobs.db"), "SQLite format 3\0");
    await chmod(join(raiz, "data", "jobs.db"), 0o600);

    const achados = await runSecurityCheck(raiz);
    expect(achados.map((f) => f.level)).toEqual(["ok", "ok", "ok", "ok"]);
  });

  it("enxerga um banco legível por outras contas da máquina", async () => {
    // Loopback protege contra a internet, não contra outro usuário do mesmo
    // computador. O arquivo tem todo o histórico de candidaturas.
    const raiz = await raizFalsa();
    await mkdir(join(raiz, "data"), { recursive: true });
    await writeFile(join(raiz, "data", "jobs.db"), "SQLite format 3\0");
    await chmod(join(raiz, "data", "jobs.db"), 0o644);

    const permissoes = achado(await runSecurityCheck(raiz), "Permissões do banco");
    expect(permissoes.level).toBe("warning");
    expect(permissoes.detail).toContain("644");
    expect(permissoes.fix).toBe("chmod 600 data/jobs.db");
  });

  it("não acusa PII quando o profile.yaml não existe", async () => {
    // Sem arquivo não há lista de arquivos para varrer — e uma lista vazia
    // tem que resultar em "nada encontrado", não em erro de leitura.
    const raiz = await raizFalsa();
    await writeFile(join(raiz, ".gitignore"), "data/\n.env\nout/\n");
    expect(achado(await runSecurityCheck(raiz), "Dado pessoal versionado")).toMatchObject({
      level: "ok",
      detail: "Nada encontrado.",
    });
  });

  it("sobrevive a package.json ilegível sem derrubar as outras verificações", async () => {
    // JSON quebrado por merge malfeito é comum. Ele degrada a verificação de
    // bind para aviso e deixa as outras três intactas.
    const raiz = await raizFalsa();
    await writeFile(join(raiz, "package.json"), "{ scripts: ");
    await writeFile(join(raiz, ".gitignore"), "data/\n.env\nout/\n");

    const achados = await runSecurityCheck(raiz);
    expect(achado(achados, "Bind do servidor").level).toBe("warning");
    expect(achado(achados, ".gitignore").level).toBe("ok");
    expect(achados).toHaveLength(4);
  });
});
