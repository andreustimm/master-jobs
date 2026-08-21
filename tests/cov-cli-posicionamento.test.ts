/**
 * Suíte: o resto dos comandos de `src/cli.ts` que **gravam** — rede
 * profissional (`contacts`), plano de posicionamento (`tasks done`), conteúdo
 * (`posts`, `metrics`, `engage`), cadastro de LLM (`llm`) e o `db seed`.
 *
 * ## Por que ainda existe um quarto arquivo
 *
 * O corte do E-08 nomeia os comandos de funil e de acervo, mas a meta que ele
 * escreve é outra e mais larga: "nenhum comando que grava esteja sem uma
 * passada". Estes são os que sobraram — todos escrevem, nenhum tem tela
 * equivalente no dashboard, e vários carregam validação escrita à mão dentro do
 * próprio handler (categoria de contato, pilar de post, tipo de provedor,
 * nível de esforço). Validação em `cli.ts` é código sem dono em nenhuma função
 * de domínio: se ela estiver errada, nenhuma suíte pura vê.
 *
 * ## O que ficou de fora, e por quê
 *
 * `jobs sync`, `jobs verify`, `scrape run`, `fx refresh`, `mail auth`,
 * `mail fetch` e `analyze` gravam, mas cada um só chega à escrita depois de uma
 * chamada de rede. Cobri-los aqui exigiria dublar a porta HTTP dentro do
 * processo da CLI para reencenar o que `cov-ingest-run`, `cov-scrape-fetcher`,
 * `cov-mail-gmail` e `cov-llm-analyze` já cobrem contra a mesma porta. O que
 * sobraria de específico de `cli.ts` é a leitura das flags — e é exatamente
 * essa parte que não vale um segundo aparato de rede.
 *
 * Fronteira DENTRO: análise de argumento, validação, persistência.
 * Fronteira FORA: rede.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCandidateFromProfile } from "../src/core/candidate.ts";
import {
  engagement,
  llmModel,
  llmProvider,
  metricSnapshot,
  positioningTask,
  post,
  skill,
  targetAccount,
} from "../src/core/db/schema.ts";
import { releaseTestDb, useTestDb } from "./support/db.ts";
import { banco, carregarCli, rodar } from "./cov-cli-harness.ts";

vi.mock("commander", async () => (await import("./cov-cli-harness.ts")).commanderMock());

let emailOriginal: string | undefined;

beforeAll(async () => {
  // `profile.yaml` expande `${JHO_CANDIDATE_EMAIL}`, e `loadProfile` guarda o
  // resultado em cache no primeiro uso. Apagar a variável ANTES de qualquer
  // carga reproduz o clone sem `.env` — que é o cenário em que `db seed`
  // precisa continuar semeando o resto mesmo sem conseguir criar a conta.
  emailOriginal = process.env.JHO_CANDIDATE_EMAIL;
  delete process.env.JHO_CANDIDATE_EMAIL;
  await carregarCli();
});

// O worker do Vitest pode reaproveitar o processo para outro arquivo; deixar a
// variável apagada seria contaminar suíte alheia com o estado desta.
afterAll(() => {
  if (emailOriginal !== undefined) process.env.JHO_CANDIDATE_EMAIL = emailOriginal;
});

beforeEach(async () => {
  await useTestDb();
});

afterEach(() => {
  releaseTestDb();
});

describe("jho db seed", () => {
  it("semeia catálogo, provedores e plano — e é idempotente", async () => {
    const primeira = await rodar("db", "seed", "--skip-auth");

    expect(primeira.code).toBeUndefined();
    expect(primeira.out).toContain("catálogo de skills");
    expect(primeira.out).toContain("provedor(es) de LLM");
    expect(primeira.out).toContain("posicionamento");

    const skillsDepoisDaPrimeira = (await banco().select().from(skill)).length;
    const tarefasDepoisDaPrimeira = (await banco().select().from(positioningTask)).length;
    expect(skillsDepoisDaPrimeira).toBeGreaterThan(0);
    expect(tarefasDepoisDaPrimeira).toBeGreaterThan(0);

    const segunda = await rodar("db", "seed", "--skip-auth");

    // A promessa impressa pelo próprio comando ("rodar de novo não duplica nem
    // sobrescreve") é uma afirmação testável, e é a única razão pela qual o
    // seed pode entrar num script de operação.
    expect(segunda.code).toBeUndefined();
    expect((await banco().select().from(skill)).length).toBe(skillsDepoisDaPrimeira);
    expect((await banco().select().from(positioningTask)).length).toBe(tarefasDepoisDaPrimeira);
  });

  /**
   * Sem `--skip-auth` o seed tenta criar a conta do dono, e num clone sem
   * `.env` o e-mail do perfil está vazio. A ordem do handler é deliberada:
   * primeiro o que destrava entrar, depois o que enriquece — e o `catch` em
   * volta da conta existe para que a falta de e-mail não leve junto o catálogo,
   * os provedores e o plano.
   */
  it("segue semeando o resto quando a conta do dono não pode ser criada", async () => {
    const r = await rodar("db", "seed");

    expect(r.code).toBeUndefined();
    expect(r.out).toContain("conta não criada");
    expect((await banco().select().from(positioningTask)).length).toBeGreaterThan(0);
  });
});

describe("jho tasks done <id>", () => {
  async function semearPlano(): Promise<void> {
    await rodar("db", "seed", "--skip-auth");
  }

  it("aceita o id em minúsculas e grava a data de conclusão", async () => {
    await semearPlano();
    const [tarefa] = await banco().select().from(positioningTask).limit(1);

    const r = await rodar("tasks", "done", tarefa!.id.toLowerCase());

    expect(r.code).toBeUndefined();
    const [depois] = await banco().select().from(positioningTask).limit(1);
    // `id.toUpperCase()` no handler: quem digita `pt-0001` não deveria precisar
    // saber que a chave é maiúscula.
    expect(depois?.status).toBe("done");
    expect(depois?.doneAt).not.toBeNull();
  });

  it("`--status` diferente de `done` limpa a data em vez de deixá-la mentindo", async () => {
    await semearPlano();
    const [tarefa] = await banco().select().from(positioningTask).limit(1);
    await rodar("tasks", "done", tarefa!.id);

    await rodar("tasks", "done", tarefa!.id, "--status", "doing");

    const [depois] = await banco().select().from(positioningTask).limit(1);
    expect(depois?.status).toBe("doing");
    // Uma tarefa "doing" com `doneAt` preenchido apareceria como concluída em
    // qualquer contagem que olhe a data em vez do status.
    expect(depois?.doneAt).toBeNull();
  });

  /**
   * Os dois casos abaixo já foram uma caracterização de defeito só. Ambos
   * foram corrigidos, e cada um virou o seu próprio caso — eram problemas
   * diferentes que só dividiam o mesmo comando.
   */
  it("status fora do vocabulário é recusado, e o banco não muda", async () => {
    await semearPlano();
    const [antes] = await banco().select().from(positioningTask).limit(1);

    const r = await rodar("tasks", "done", antes!.id, "--status", "feito");

    expect(r.code).toBe(1);
    expect(r.err).toContain("feito");
    // A recusa precisa dizer o que serve; senão a pessoa tenta de novo no
    // escuro. O vocabulário vem da constante, não de uma frase repetida aqui.
    expect(r.out).toContain("skipped");

    // O estado anterior sobrevive. Antes, `feito` entrava no banco e a tarefa
    // sumia das duas listagens: o filtro padrão esconde `done` e `skipped`, e
    // um estado desconhecido não é nenhum dos dois nem volta a ser `todo`.
    const [depois] = await banco().select().from(positioningTask).limit(1);
    expect(depois?.status).toBe(antes?.status);
  });

  it("id inexistente sai com 1, em vez do ✓ verde de antes", async () => {
    await semearPlano();

    const r = await rodar("tasks", "done", "PT-9999");

    // `update ... where id = ?` que não casa com linha nenhuma é sucesso para o
    // SQL. Sem o `returning`, o comando imprimia "✓ PT-9999 → done" e saía com
    // zero: quem digitou o id errado seguia acreditando que fechou a tarefa.
    expect(r.code).toBe(1);
    expect(r.err).toContain("PT-9999");
    expect(r.out).not.toContain("PT-9999 → done");
  });
});

/**
 * Contato de rede mora em `target_account`, e não numa tabela `contact`: o
 * comando chama de "contato" o que o schema chama de conta-alvo. Vale registrar
 * porque é a primeira coisa que confunde quem for escrever a próxima consulta.
 */
describe("jho contacts add <name>", () => {
  it("grava o contato com a categoria padrão `peer`", async () => {
    await syncCandidateFromProfile();

    const r = await rodar("contacts", "add", "Rafael Souza", "-c", "Acme");

    expect(r.code).toBeUndefined();
    const [linha] = await banco().select().from(targetAccount);
    expect(linha?.name).toBe("Rafael Souza");
    expect(linha?.category).toBe("peer");
  });

  it("`-k former` grava a categoria mais valiosa da rede", async () => {
    await syncCandidateFromProfile();

    await rodar("contacts", "add", "Ana Lima", "-c", "Globo", "-k", "former", "-r", "Tech Lead");

    const [linha] = await banco().select().from(targetAccount);
    // `former` é ex-colega — o vínculo com maior taxa de resposta, e por isso o
    // valor que mais custa perder na tradução da flag.
    expect(linha?.category).toBe("former");
    expect(linha?.role).toBe("Tech Lead");
  });

  it("recusa categoria fora da lista com código 1, antes de abrir o banco", async () => {
    const r = await rodar("contacts", "add", "Alguém", "-c", "Acme", "-k", "amigo");

    expect(r.code).toBe(1);
    expect(r.err).toContain("Categoria inválida");
    expect(await banco().select().from(targetAccount)).toHaveLength(0);
  });

  it("`--company` é obrigatório — contato sem empresa não casa com vaga", async () => {
    const r = await rodar("contacts", "add", "Alguém");

    // A empresa é a chave do join com o acervo. Sem ela o contato existe e não
    // serve para nada, que é pior do que não existir.
    expect(r.uso).toContain("--company");
  });
});

describe("jho contacts seed", () => {
  it("semeia o histórico de trabalho e não duplica na segunda passada", async () => {
    await syncCandidateFromProfile();

    const primeira = await rodar("contacts", "seed");
    const depoisDaPrimeira = (await banco().select().from(targetAccount)).length;

    const segunda = await rodar("contacts", "seed");

    expect(primeira.code).toBeUndefined();
    expect(segunda.code).toBeUndefined();
    expect(depoisDaPrimeira).toBeGreaterThan(0);
    expect((await banco().select().from(targetAccount)).length).toBe(depoisDaPrimeira);
  });
});

describe("jho posts add | published", () => {
  it("grava o rascunho com o pilar e o idioma padrão", async () => {
    const r = await rodar(
      "posts", "add", "evals-antes-do-prototipo",
      "-t", "O trabalho começa depois do protótipo",
      "-p", "production-ai",
      "-b", "Texto do post.",
    );

    expect(r.code).toBeUndefined();
    const [linha] = await banco().select().from(post);
    expect(linha?.pillar).toBe("production-ai");
    expect(linha?.lang).toBe("en");
    expect(linha?.status).toBe("draft");
  });

  it("`--lang pt` sobrepõe o padrão", async () => {
    await rodar(
      "posts", "add", "post-pt",
      "-t", "Título", "-p", "agentic", "-b", "Corpo.", "--lang", "pt",
    );

    const [linha] = await banco().select().from(post);
    expect(linha?.lang).toBe("pt");
  });

  it("recusa pilar fora dos seis com código 1 e não grava", async () => {
    const r = await rodar(
      "posts", "add", "post-solto", "-t", "Título", "-p", "devops", "-b", "Corpo.",
    );

    expect(r.code).toBe(1);
    expect(r.err).toContain("Pilar inválido");
    expect(await banco().select().from(post)).toHaveLength(0);
  });

  it("título, pilar e corpo são todos obrigatórios", async () => {
    const r = await rodar("posts", "add", "sem-nada");

    // Rascunho sem corpo seria linha que ocupa o slug e não publica nada.
    expect(r.uso).toMatch(/--title|--pillar|--body/);
    expect(await banco().select().from(post)).toHaveLength(0);
  });

  it("`published` carimba a data e guarda o URN quando ele existe", async () => {
    await rodar("posts", "add", "slug-x", "-t", "T", "-p", "leadership", "-b", "Corpo.");

    const r = await rodar("posts", "published", "slug-x", "--urn", "urn:li:share:123");

    expect(r.code).toBeUndefined();
    const [linha] = await banco().select().from(post);
    expect(linha?.status).toBe("published");
    expect(linha?.publishedAt).not.toBeNull();
    // O URN só existe quando a publicação passou pela API oficial. Guardá-lo é
    // o que liga o rascunho à métrica que vem depois.
    expect(linha?.linkedinUrn).toBe("urn:li:share:123");
  });
});

describe("jho metrics record <key> <value>", () => {
  it("converte o valor para número e usa hoje como data padrão", async () => {
    const r = await rodar("metrics", "record", "ssi_total", "62");

    expect(r.code).toBeUndefined();
    const [linha] = await banco().select().from(metricSnapshot);
    expect(linha?.value).toBe(62);
    expect(linha?.at).toBe(new Date().toISOString().slice(0, 10));
  });

  it("`--at` permite lançar leitura de outro dia, e regravar o dia atualiza", async () => {
    await rodar("metrics", "record", "ssi_total", "60", "--at", "2026-08-01", "-n", "antes");
    await rodar("metrics", "record", "ssi_total", "64", "--at", "2026-08-01", "-n", "corrigido");

    const linhas = await banco().select().from(metricSnapshot);
    // Chave única (data, métrica): relançar corrige a leitura em vez de criar
    // duas verdades para o mesmo dia, que arruinariam a série temporal.
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.value).toBe(64);
    expect(linhas[0]?.note).toBe("corrigido");
  });
});

describe("jho engage add | done | skip", () => {
  it("enfileira com o tipo padrão `comment` e avisa que falta rascunho", async () => {
    const r = await rodar("engage", "add", "https://linkedin.test/posts/1");

    expect(r.code).toBeUndefined();
    const [linha] = await banco().select().from(engagement);
    expect(linha?.kind).toBe("comment");
    expect(linha?.status).toBe("queued");
    // ADR 0001: o agente redige, a pessoa age. Fila sem rascunho não adianta
    // nada, e o comando diz isso em vez de deixar a linha muda.
    expect(r.out).toContain("Sem rascunho");
  });

  it("leva cada flag para a coluna correspondente", async () => {
    await rodar(
      "engage", "add", "https://linkedin.test/in/alguem",
      "-k", "connect",
      "-n", "Ana Lima", "-r", "Head of AI", "-c", "Acme",
      "--why", "decide contratação de arquitetura",
      "-d", "Rascunho da mensagem.",
      "--for", "2026-08-25",
    );

    const [linha] = await banco().select().from(engagement);
    expect(linha?.kind).toBe("connect");
    expect(linha?.targetName).toBe("Ana Lima");
    expect(linha?.targetRole).toBe("Head of AI");
    expect(linha?.targetCompany).toBe("Acme");
    expect(linha?.rationale).toContain("contratação");
    expect(linha?.queuedFor).toBe("2026-08-25");
  });

  it("recusa tipo fora da lista com código 1 e não enfileira", async () => {
    const r = await rodar("engage", "add", "https://linkedin.test/x", "-k", "curtir");

    expect(r.code).toBe(1);
    expect(r.err).toContain("Tipo inválido");
    expect(await banco().select().from(engagement)).toHaveLength(0);
  });

  it("`done` registra o desfecho e `skip` fecha sem desfecho", async () => {
    await rodar("engage", "add", "https://linkedin.test/a");
    await rodar("engage", "add", "https://linkedin.test/b");
    const [a, b] = await banco().select().from(engagement);

    await rodar("engage", "done", String(a!.id), "-o", "respondeu em 2h");
    await rodar("engage", "skip", String(b!.id));

    const linhas = await banco().select().from(engagement);
    const feito = linhas.find((l) => l.id === a!.id);
    const pulado = linhas.find((l) => l.id === b!.id);
    expect(feito?.status).toBe("done");
    expect(feito?.outcome).toBe("respondeu em 2h");
    expect(pulado?.status).toBe("skipped");
    expect(pulado?.outcome).toBeNull();
  });
});

describe("jho llm add-provider | add-model | use", () => {
  /**
   * Regra 16 do CLAUDE.md: chave de API nunca vai para o banco. O comando pede
   * o NOME da variável de ambiente, e este caso confere que nem por acidente o
   * valor da variável aparece em alguma coluna — banco é copiado em backup e
   * aberto por outros processos, e chave dentro dele viaja junto.
   */
  it("guarda o nome da variável de ambiente, nunca o valor da chave", async () => {
    process.env.PROVEDOR_TESTE_KEY = "sk-valor-secreto-que-nao-pode-vazar";
    try {
      const r = await rodar(
        "llm", "add-provider", "provedor-teste",
        "--label", "Provedor de Teste",
        "--key-env", "PROVEDOR_TESTE_KEY",
      );

      expect(r.code).toBeUndefined();
      const [linha] = await banco().select().from(llmProvider);
      expect(linha?.apiKeyEnv).toBe("PROVEDOR_TESTE_KEY");
      expect(JSON.stringify(linha)).not.toContain("sk-valor-secreto");
      expect(r.out).not.toContain("sk-valor-secreto");
    } finally {
      delete process.env.PROVEDOR_TESTE_KEY;
    }
  });

  it("usa `compatible` como tipo padrão e aceita `--base-url`", async () => {
    await rodar(
      "llm", "add-provider", "local",
      "--label", "Local", "--key-env", "LOCAL_KEY",
      "--base-url", "http://127.0.0.1:11434/v1",
    );

    const [linha] = await banco().select().from(llmProvider);
    // `compatible` é o padrão certo: é o que absorve qualquer endpoint que fale
    // o protocolo da OpenAI, que é a maioria do que aparece.
    expect(linha?.kind).toBe("compatible");
    expect(linha?.baseUrl).toBe("http://127.0.0.1:11434/v1");
  });

  it("recusa tipo de provedor desconhecido com código 1", async () => {
    const r = await rodar(
      "llm", "add-provider", "x", "--label", "X", "--key-env", "X_KEY", "--kind", "gemini",
    );

    expect(r.code).toBe(1);
    expect(r.err).toContain("Tipo inválido");
    expect(await banco().select().from(llmProvider)).toHaveLength(0);
  });

  it("`add-model` converte números e liga o modelo ao provedor", async () => {
    await rodar("llm", "add-provider", "p1", "--label", "P1", "--key-env", "P1_KEY");

    const r = await rodar(
      "llm", "add-model", "p1", "modelo-x",
      "--label", "Modelo X",
      "--reasoning", "--effort", "high",
      "--max-tokens", "8192",
      "--in-cost", "3", "--out-cost", "15",
    );

    expect(r.code).toBeUndefined();
    const [modelo] = await banco().select().from(llmModel);
    expect(modelo?.supportsReasoning).toBe(true);
    expect(modelo?.defaultEffort).toBe("high");
    // Tudo isto chega como string do argv; um `Number()` esquecido gravaria
    // texto numa coluna numérica e só apareceria na hora de somar custo.
    expect(modelo?.maxOutputTokens).toBe(8192);
    expect(modelo?.inputCostPerMTok).toBe(3);
    expect(modelo?.outputCostPerMTok).toBe(15);
  });

  it("`add-model` usa 4096 como teto padrão de saída", async () => {
    await rodar("llm", "add-provider", "p1", "--label", "P1", "--key-env", "P1_KEY");

    await rodar("llm", "add-model", "p1", "modelo-y", "--label", "Modelo Y");

    const [modelo] = await banco().select().from(llmModel);
    expect(modelo?.maxOutputTokens).toBe(4096);
    expect(modelo?.defaultEffort).toBeNull();
  });

  it("recusa esforço fora da escala com código 1", async () => {
    await rodar("llm", "add-provider", "p1", "--label", "P1", "--key-env", "P1_KEY");

    const r = await rodar(
      "llm", "add-model", "p1", "modelo-z", "--label", "Z", "--effort", "altíssimo",
    );

    expect(r.code).toBe(1);
    expect(r.err).toContain("Esforço inválido");
    expect(await banco().select().from(llmModel)).toHaveLength(0);
  });

  it("recusa modelo de provedor não cadastrado com código 1", async () => {
    const r = await rodar("llm", "add-model", "fantasma", "modelo", "--label", "M");

    expect(r.code).toBe(1);
    expect(r.err).toContain("não cadastrado");
  });

  it("`use` recusa modelo desconhecido em vez de gravar um padrão quebrado", async () => {
    const r = await rodar("llm", "use", "modelo-que-nao-existe");

    expect(r.code).toBe(1);
    expect(r.err).toContain("não cadastrado");
  });

  it("`use` define o padrão entre os modelos cadastrados", async () => {
    await rodar("llm", "seed");
    const [modelo] = await banco().select().from(llmModel).limit(1);

    const r = await rodar("llm", "use", modelo!.modelId);

    expect(r.code).toBeUndefined();
    expect(r.out).toContain(modelo!.modelId);
  });
});

describe("jho skills seed", () => {
  it("semeia o catálogo global e não duplica ao repetir", async () => {
    const primeira = await rodar("skills", "seed");
    const depoisDaPrimeira = (await banco().select().from(skill)).length;

    const segunda = await rodar("skills", "seed");

    expect(primeira.code).toBeUndefined();
    expect(segunda.code).toBeUndefined();
    expect(depoisDaPrimeira).toBeGreaterThan(0);
    expect((await banco().select().from(skill)).length).toBe(depoisDaPrimeira);
  });
});

describe("jho engage targets", () => {
  it("não inventa alvo quando ninguém foi cadastrado", async () => {
    const r = await rodar("engage", "targets");

    expect(r.out).toContain("Nenhuma conta-alvo");
    expect(await banco().select().from(targetAccount)).toHaveLength(0);
  });
});
