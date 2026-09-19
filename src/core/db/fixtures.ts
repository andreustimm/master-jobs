/**
 * O acervo de exemplo que torna dev e staging úteis sem dado de produção.
 *
 * A regra do ADR 0021 é que ambiente não-produtivo trabalha sobre fixtures. Uma
 * fixture serve para isso quando é pequena, estável e cobre as ramificações que
 * a interface precisa mostrar — modalidade, ciclo de vida, escopo entre contas.
 * Copiar produção resolveria em uma tarde e criaria dois problemas maiores: PII
 * real num banco descartável e um corpus que muda debaixo do teste.
 *
 * Nada aqui tem PII, segredo ou payload bruto de captura. Os textos são curtos
 * e escritos à mão para o scorer ter o que casar sem virar lorem ipsum.
 */

export type JobFixture = {
  externalId: string;
  companyName: string;
  title: string;
  locationRaw: string;
  /** `null` quando o anúncio não diz — e "não diz" é um caso que a UI mostra. */
  remote: boolean | null;
  descriptionText: string;
  url: string;
  /** Preenchido só nas fechadas; reabertas voltam a `null`. */
  closedAt: string | null;
};

export type CandidateFixture = {
  slug: string;
  name: string;
  email: string;
  roles: readonly ("admin" | "candidate" | "recruiter")[];
  /** Currículo curto; ausente é o estado vazio que a tela precisa mostrar. */
  cv: string | null;
};

/**
 * Dez vagas cobrem o que a interface ramifica: remoto, híbrido, presencial e
 * modalidade não declarada; aberta, fechada e reaberta. Menos que isso deixa
 * uma tela sem caso; mais só aumenta o tempo do seed.
 */
export const JOB_FIXTURES: readonly JobFixture[] = [
  {
    externalId: "fixture-remote-architect",
    companyName: "Aurora Sistemas",
    title: "Senior Software Architect",
    locationRaw: "Remoto · Brasil",
    remote: true,
    descriptionText:
      "Arquitetura de serviços distribuídos em TypeScript e Python. Trabalho remoto no Brasil, documentação de decisões técnicas e observabilidade.",
    url: "https://example.test/vagas/remote-architect",
    closedAt: null,
  },
  {
    externalId: "fixture-remote-platform",
    companyName: "Bruma Cloud",
    title: "Staff Platform Engineer",
    locationRaw: "Remoto · LATAM",
    remote: true,
    descriptionText:
      "Plataforma interna, Kubernetes e pipelines de entrega. Aberta para LATAM, contratação PJ, foco em confiabilidade.",
    url: "https://example.test/vagas/remote-platform",
    closedAt: null,
  },
  {
    externalId: "fixture-hybrid-lead",
    companyName: "Corvo Dados",
    title: "Tech Lead de Dados",
    locationRaw: "Híbrido · São Paulo, SP",
    remote: false,
    descriptionText:
      "Liderança técnica de um time de dados, três dias no escritório em São Paulo. Python, dbt e governança de modelos.",
    url: "https://example.test/vagas/hybrid-lead",
    closedAt: null,
  },
  {
    externalId: "fixture-onsite-backend",
    companyName: "Delta Varejo",
    title: "Backend Engineer",
    locationRaw: "Presencial · Curitiba, PR",
    remote: false,
    descriptionText:
      "Desenvolvimento backend presencial em Curitiba, integração com ERP e sistemas de loja. Java e PostgreSQL.",
    url: "https://example.test/vagas/onsite-backend",
    closedAt: null,
  },
  {
    externalId: "fixture-unknown-mode",
    companyName: "Estrela Fintech",
    title: "Engenheiro de Software Sênior",
    locationRaw: "Brasil",
    remote: null,
    descriptionText:
      "Vaga sem modalidade declarada: o anúncio não diz se é remoto, híbrido ou presencial. Serve para a tela mostrar ausência sem inventar.",
    url: "https://example.test/vagas/unknown-mode",
    closedAt: null,
  },
  {
    externalId: "fixture-remote-ai",
    companyName: "Farol AI",
    title: "AI Engineer",
    locationRaw: "Remoto · Mundial",
    remote: true,
    descriptionText:
      "Sistemas com LLM em produção: avaliação, custo por token e orquestração de agentes. Remoto mundial, inglês diário.",
    url: "https://example.test/vagas/remote-ai",
    closedAt: null,
  },
  {
    externalId: "fixture-closed-architect",
    companyName: "Gaivota Health",
    title: "Principal Architect",
    locationRaw: "Remoto · Brasil",
    remote: true,
    descriptionText:
      "Vaga que saiu do ar na fonte e por isso está fechada. Continua legível como contexto histórico de uma candidatura.",
    url: "https://example.test/vagas/closed-architect",
    closedAt: "2026-08-20T12:00:00.000Z",
  },
  {
    externalId: "fixture-closed-manager",
    companyName: "Horizonte Log",
    title: "Engineering Manager",
    locationRaw: "Híbrido · Porto Alegre, RS",
    remote: false,
    descriptionText:
      "Segunda vaga fechada, para a poda de retenção ter mais de um caso e a contagem não depender de um registro só.",
    url: "https://example.test/vagas/closed-manager",
    closedAt: "2026-07-05T12:00:00.000Z",
  },
  {
    externalId: "fixture-reopened-staff",
    companyName: "Ígneo Pagamentos",
    title: "Staff Engineer",
    locationRaw: "Remoto · Brasil",
    remote: true,
    descriptionText:
      "Some da fonte e volta: um 404 transitório não pode sumir com a vaga para sempre, e esta fixture existe para provar a reabertura.",
    url: "https://example.test/vagas/reopened-staff",
    closedAt: null,
  },
  {
    externalId: "fixture-onsite-support",
    companyName: "Jangada Educação",
    title: "Analista de Suporte Técnico",
    locationRaw: "Presencial · Recife, PE",
    remote: false,
    descriptionText:
      "Vaga fora do alvo de senioridade, presente de propósito: o ranking precisa de caso baixo para a ordenação significar alguma coisa.",
    url: "https://example.test/vagas/onsite-support",
    closedAt: null,
  },
];

/**
 * Quatro contas que exercitam as fronteiras que já existem: dono, candidato
 * sem currículo, candidato com currículo e recrutadora sem escopo de candidato.
 * O par candidato↔candidato é o que prova que um não lê o funil do outro.
 */
export const CANDIDATE_FIXTURES: readonly CandidateFixture[] = [
  {
    slug: "alex-fixture",
    name: "Alex Ribeiro",
    email: "alex@fixture.test",
    roles: ["admin", "candidate"],
    cv: "# Alex Ribeiro\n\nSenior Software Architect. TypeScript, Python, serviços distribuídos, observabilidade e liderança técnica. Remoto no Brasil.",
  },
  {
    slug: "bruno-fixture",
    name: "Bruno Lima",
    email: "bruno@fixture.test",
    roles: ["candidate"],
    cv: "# Bruno Lima\n\nBackend Engineer. Java, PostgreSQL e integrações de varejo. Aberto a híbrido em São Paulo.",
  },
  {
    slug: "carla-fixture",
    name: "Carla Mendes",
    email: "carla@fixture.test",
    roles: ["candidate"],
    cv: null,
  },
  {
    slug: "renata-fixture",
    name: "Renata Souza",
    email: "renata@fixture.test",
    roles: ["recruiter"],
    cv: null,
  },
];

/**
 * O teto declarado do corpus. Existe para o seed ser observável: se alguém
 * acrescentar cem vagas "só para testar", o teste reprova antes de o banco
 * descartável virar um acervo paralelo.
 */
export const FIXTURE_BOUNDS = {
  maxJobs: 25,
  maxCandidates: 10,
  maxDescriptionChars: 600,
} as const;

/** Validação pura: roda antes de escrever, e é o que o teste de unidade afirma. */
export function validateFixtures(
  jobs: readonly JobFixture[] = JOB_FIXTURES,
  candidates: readonly CandidateFixture[] = CANDIDATE_FIXTURES,
): { ok: true } | { ok: false; problems: string[] } {
  const problems: string[] = [];

  if (jobs.length > FIXTURE_BOUNDS.maxJobs) problems.push("too many job fixtures");
  if (candidates.length > FIXTURE_BOUNDS.maxCandidates) problems.push("too many candidate fixtures");

  const externalIds = new Set(jobs.map((job) => job.externalId));
  if (externalIds.size !== jobs.length) problems.push("duplicate job externalId");

  const slugs = new Set(candidates.map((candidate) => candidate.slug));
  if (slugs.size !== candidates.length) problems.push("duplicate candidate slug");

  for (const job of jobs) {
    if (job.descriptionText.length > FIXTURE_BOUNDS.maxDescriptionChars) {
      problems.push(`description too long: ${job.externalId}`);
    }
    // Host de exemplo reservado: fixture que aponta para site real convida o
    // primeiro clique distraído a virar requisição para um terceiro.
    if (!job.url.startsWith("https://example.test/")) {
      problems.push(`fixture url must stay on example.test: ${job.externalId}`);
    }
  }

  for (const candidate of candidates) {
    if (!candidate.email.endsWith("@fixture.test")) {
      problems.push(`fixture email must stay on fixture.test: ${candidate.slug}`);
    }
  }

  // As ramificações que a interface precisa ter para não ficar com tela vazia.
  if (!jobs.some((job) => job.remote === true)) problems.push("missing remote fixture");
  if (!jobs.some((job) => job.remote === false)) problems.push("missing on-site/hybrid fixture");
  if (!jobs.some((job) => job.remote === null)) problems.push("missing undeclared-mode fixture");
  if (!jobs.some((job) => job.closedAt !== null)) problems.push("missing closed fixture");
  if (!jobs.some((job) => job.closedAt === null)) problems.push("missing open fixture");

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
