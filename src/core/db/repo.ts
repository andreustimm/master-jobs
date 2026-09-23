/**
 * Query helpers shared by the CLI and the Next.js server components.
 *
 * Keeping them here (instead of inline in pages) means an agent changing a
 * query changes it once, and the CLI and dashboard can never disagree about
 * what "shortlisted" or "open" means.
 */
import { and, asc, desc, eq, gte, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  primaryScoreFilter,
  scoreTrackFilter,
  type TrackScope,
  type WorkMode,
} from "../../contexts/matching/index.ts";
import { workModeSql } from "./work-mode.ts";
import { attributedJobIds } from "../../contexts/sourcing/index.ts";
import { loadRates } from "../../contexts/fx/index.ts";
import { PERIODS_PER_YEAR, annualFactorSql, type Currency, type FxTable } from "../money.ts";
import { termPrefilterLike, termRegexSql, type ValidTerm } from "../term.ts";
import {
  IllegalApplicationTransitionError,
  transitionApplication,
} from "../../contexts/pursuit/domain/application.ts";
import { getDb, type DB } from "./client.ts";
import {
  application,
  candidate,
  jobPage,
  applicationEvent,
  candidateDocument,
  job,
  jobScore,
  source,
  company,
  type ApplicationStatus,
  verifyTask,
  withoutSeparators,
} from "./schema.ts";

export type BoardRow = {
  jobId: number;
  title: string;
  companyName: string;
  locationRaw: string | null;
  url: string;
  applyUrl: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  sourceId: string;
  sourceLabel: string | null;
  compMin: number | null;
  compMax: number | null;
  compCurrency: string | null;
  compPeriod: string | null;
  fit: number | null;
  /** The track the fit comes from — in "all", the track where the job scores best. */
  trackId: number | null;
  cluster: string | null;
  titleScore: number | null;
  keywordScore: number | null;
  seniorityScore: number | null;
  geoScore: number | null;
  compScore: number | null;
  freshnessScore: number | null;
  benefitScore: number | null;
  blockers: unknown;
  reasons: unknown;
  /** A descrição tem o mínimo para valer a leitura; ver `fullDescriptionSql`. */
  hasFullDescription: boolean;
  /** Description captured offline by the scraper, if any. */
  pageText: string | null;
  pageTextLength: number;
  pageExtracted: unknown;
  pageFetchedAt: string | null;
  status: string | null;
  appliedAt: string | null;
  /** First seen after the viewer's last visit to the "brought by" filter. */
  isNew: boolean;
  /**
   * Top of the pay range in the viewer's currency and period (ADR-013), or
   * null. `payState` says why it is null: nothing disclosed, or something we
   * cannot compare. Both null when the view asked for no pay normalization.
   */
  payAmount: number | null;
  payState: "amount" | "undisclosed" | "not_comparable" | null;
  /** Última reconferência do link: quando, o veredito e o código HTTP. */
  checkedAt: string | null;
  checkStatus: string | null;
  checkCode: number | null;
  /** Estado na fila de reconferência, quando há tarefa. */
  checkQueue: string | null;
  /** Every posting of this job's group, itself included. Empty when ungrouped. */
  repeats: GroupPosting[];
};

/** How much captured description a list row carries. See the query below. */
export const PREVIEW_CHARS = 2500;

export type BoardFilters = {
  minFit?: number;
  /** Highest fit shown; absent means no ceiling. */
  maxFit?: number;
  /**
   * A vaga ainda sem nota do candidato passa por `minFit`/`maxFit` (#279).
   *
   * Pedido pelas telas, que mostram o acervo a quem acabou de chegar. Ausente,
   * o corte é estrito: relatório, `jobs list` e a varredura de triagem pedem
   * "vagas com nota acima de X", e uma vaga sem nota não responde a isso.
   */
  keepUnscored?: boolean;
  cluster?: string;
  /** Absent hides archived jobs ("não me interessa"); `any` shows every job. */
  status?: ApplicationStatus | "unfiled" | "any";
  /**
   * A whole-word term over title, company and description (ADR-005, ADR-012):
   * `java` does not find "JavaScript", `Lara` does not find "Laravel". The
   * captured page text stands in for the description when there is one.
   */
  term?: ValidTerm;
  /**
   * Which sources the board shows. Empty or absent means every source.
   *
   * A list because the corpus grows one adapter at a time: picking three
   * boards is the same question as picking one, and asking it once beats
   * three round trips.
   */
  sourceKinds?: readonly string[];
  /**
   * Substring of the employer's name, case-insensitive.
   *
   * Separate from `term`, which is a whole-word search over title, company AND
   * description: looking for "Stripe" there also returns every job whose text
   * mentions Stripe. This one asks about the employer and nothing else, and it
   * matches inside a word because "Shopify" must find "Shopify Inc".
   */
  company?: string;
  workMode?: WorkMode;
  /** Hide anything with a hard blocker — work authorisation, on-site, W2. */
  hideBlocked?: boolean;
  /**
   * Fold a job repeated across countries into one row.
   *
   * The same posting arrives once per location — the corpus has one in 42
   * countries — and each copy takes a line and competes for attention. The
   * records stay separate: this only picks one of each group to show, so
   * `closedAt` and the applications' foreign keys are untouched.
   *
   * The chosen one is the lowest id in the group, never the best fit: fit is
   * per candidate, and a canonical row that moved between readers would make
   * the same link mean different jobs.
   */
  groupRepeats?: boolean;
  /**
   * Only the postings of this job's group — the hub of a job published once
   * per country.
   *
   * The anchor is any posting of the group, not a group id: the grouping is
   * presentation, so there is no group record to point at. A link stays valid
   * while the posting it names is open, and gives 404 when it closes, which is
   * the honest answer — the regra 3 keeps the record, not the shop window.
   */
  sameGroupAs?: number;
  /**
   * Hide jobs already sent.
   *
   * Read from `appliedAt`, not from the status name. The stamp is set once, on
   * the move into `applied`, and it survives every later move — a rejection, a
   * withdrawal, an archive. A status list would have to be edited every time
   * the pipeline gains a state, and would forget the ones that left it.
   */
  hideApplied?: boolean;
  /** Only postings published within N days. */
  freshDays?: number;
  /** Only postings that disclose pay. */
  hasComp?: boolean;
  /**
   * Only postings where the employer is actually named.
   *
   * Jobgether — 4.639 of the corpus — anonymises the employer by design
   * ("on behalf of a partner company"), so `company_name` equals the source
   * label. Those jobs cannot be researched, cannot be matched against your
   * network, and cannot dedupe against the same role on the company's own
   * board. This filter is how you get them out of the way.
   */
  namedEmployer?: boolean;
  /**
   * Only postings whose description is long enough to score on keywords.
   *
   * A posting with no body scores 0 on a component worth 30 points, so its fit
   * is not low — it is *unmeasured*. Job alerts arrive this way by design
   * (ADR 0008 Trava 2 forbids following the link), so the distinction has to be
   * visible rather than silently depressing the rank.
   */
  hasDescription?: boolean;
  sort?: "fit" | "recent" | "comp";
  /**
   * Which track's fit the board ranks by (ADR-008). Absent means the primary:
   * a reader that did not choose must not mix tracks in one list.
   */
  track?: TrackScope;
  /**
   * Only jobs a saved term brought (ADR-005). The key comes from the viewer's
   * own saved term, resolved server-side; the capture that attributed the job
   * never knew who saved the term.
   */
  broughtBy?: { termKey: string };
  /** Marks rows first seen after this instant as new (`isNew`). */
  newSince?: string;
  /**
   * Minimum pay and the currency/period to compare in (ADR-013). Only a
   * filter: it never reaches the scorer or a compensation range.
   */
  pay?: PayFilter;
  /**
   * A tabela de câmbio já carregada, para a leitura não ir buscá-la de novo.
   *
   * `loadRates()` é uma consulta sem cache, e uma tela do quadro chama três
   * leituras que normalizam pagamento — com a da própria página, o mesmo câmbio
   * ia quatro vezes ao banco na mesma requisição, contra um pool de três
   * conexões. Quem já tem a tabela passa; quem não passa continua buscando,
   * então a CLI e os testes não mudam.
   *
   * `null` é resposta válida (não há cotação gravada) e diferente de ausente.
   */
  rates?: FxTable | null;
  limit?: number;
  offset?: number;
};

export type PayFilter = {
  /** Minimum top of the range; absent means no floor. */
  min?: number;
  /** Maximum top of the range; absent means no ceiling. */
  max?: number;
  currency: Currency;
  period: "month" | "year";
  /** Hide rows whose pay is not disclosed or cannot be compared. */
  disclosedOnly?: boolean;
};

type PaySql = ReturnType<typeof paySql>;

/**
 * The normalized top of the pay range, in SQL.
 *
 * `top × per-year factor ÷ rate(currency)` gives the amount per year in the
 * table's base currency; `× rate(target) ÷ periods` puts it in the viewer's
 * currency and period — the same arithmetic as `normalizePayTop`, with the
 * same factor table. Rates travel as a bound `VALUES` list from the latest
 * stored quote. A currency without a rate, an unknown period or a project
 * gives NULL: not comparable.
 */
function paySql(pay: PayFilter, fx: FxTable | null) {
  const target = pay.currency.toUpperCase();
  // Without a stored quote only the viewer's own currency compares.
  const rates = new Map<string, number>(
    fx
      ? [[fx.base.toUpperCase(), 1], ...Object.entries(fx.rates).map(([code, rate]) => [code.toUpperCase(), rate] as const)]
      : [[target, 1]],
  );
  const targetRate = rates.get(target);
  const top = sql`coalesce(nullif(greatest(${job.compMax}, 0), 0), nullif(greatest(${job.compMin}, 0), 0))`;
  const values = sql.join(
    [...rates].map(([code, rate]) => sql`(${code}::text, ${rate}::float8)`),
    sql`, `,
  );
  const factor = sql.raw(annualFactorSql(`"job"."comp_period"`));
  const normalizedAmount =
    targetRate === undefined
      ? sql`null::float8`
      : sql`round((${top} * ${factor} / nullif(pay_rates.rate, 0) * ${targetRate}::float8 / ${PERIODS_PER_YEAR[pay.period]})::numeric, 2)::float8`;
  // Filtrar salário o calcula tanto no quadro quanto na escolha do grupo:
  // uma CTE compartilha esse trabalho. Só ordenar não precisa calcular o
  // acervo todo; a relação lateral alcança apenas as linhas participantes.
  const relation = pay.min !== undefined || pay.max !== undefined || pay.disclosedOnly
    ? {
      kind: "shared" as const,
      table: getDb().$with("board_pay").as(
        getDb().select({ jobId: job.id, amount: normalizedAmount.as("amount") })
          .from(job)
          .leftJoin(sql`(values ${values}) as pay_rates(code, rate)`, sql`pay_rates.code = upper(trim(${job.compCurrency}))`)
          .where(isNull(job.closedAt)),
      ),
    }
    : {
      kind: "inline" as const,
      table: getDb().select({ amount: normalizedAmount.as("amount") })
        .from(sql`(values ${values}) as pay_rates(code, rate)`)
        .where(sql`pay_rates.code = upper(trim(${job.compCurrency}))`)
        .as("board_pay"),
    };
  const amount = sql`${relation.table.amount}`;
  const state = sql`(case when ${top} is null then 'undisclosed' when ${amount} is null then 'not_comparable' else 'amount' end)`;
  return { amount, state, relation };
}

async function payContext(opts: BoardFilters): Promise<PaySql | undefined> {
  if (!opts.pay) return undefined;
  // `rates` ausente busca; `rates: null` é a resposta "não há cotação" e não
  // deve virar uma segunda ida ao banco para descobrir o mesmo nada.
  const rates = opts.rates !== undefined ? opts.rates : await loadRates();
  return paySql(opts.pay, rates);
}

/**
 * Keeps a job whose normalized top falls inside the range; undisclosed and not
 * comparable ones stay unless the viewer hid them. Outside the range is
 * hidden — and counted, so the screen can say how many.
 */
function payCondition(pay: PayFilter | undefined, amount: SQL | undefined): SQL | undefined {
  if (!pay || !amount) return undefined;
  const bounds: SQL[] = [];
  if (pay.min !== undefined) bounds.push(sql`${amount} >= ${pay.min}`);
  if (pay.max !== undefined) bounds.push(sql`${amount} <= ${pay.max}`);
  if (bounds.length === 0) return pay.disclosedOnly ? sql`${amount} is not null` : undefined;
  const inRange = sql`(${sql.join(bounds, sql` and `)})`;
  return pay.disclosedOnly ? inRange : sql`(${inRange} or ${amount} is null)`;
}

/**
 * The key that says two postings are the same job in another country.
 *
 * Source, title and employer — not the description, which the adapters
 * normalise differently, and not the location, which is the thing that varies.
 * Measured on the corpus: 391 groups over 2.934 postings, and in every one of
 * them each posting carries a distinct location.
 */
function groupKey(
  row: {
    id: PgColumn;
    sourceId: PgColumn;
    title: PgColumn;
    companyName: PgColumn;
  },
  sourceLabel: PgColumn | SQL,
): SQL[] {
  return [
    sql`split_part(${row.sourceId}, ':', 1)`,
    sql`lower(btrim(${row.title}))`,
    sql`lower(btrim(${row.companyName}))`,
    // **Empregador anônimo não agrupa: cada publicação é o próprio grupo.**
    //
    // Onde a fonte oculta o empregador, `company_name` é o rótulo da própria
    // fonte — `companyName = config.label` em `sources/ats.ts`, porque a API não
    // devolve a empresa. O Jobgether é 92% do acervo e ali os três primeiros
    // elementos desta chave desabam: o primeiro é `lever`, o ATS e não o board;
    // o terceiro é a constante `jobgether`. Sobra o título, e duas vagas de
    // empresas PARCEIRAS DIFERENTES que compartilham um título viravam a mesma
    // vaga em dois países — a de id maior ficava inalcançável no quadro, e o hub
    // apresentava o empregador de uma como o segundo país da outra.
    //
    // O discriminador já existia neste arquivo (o filtro `namedEmployer` e a
    // etiqueta da lista); só o agrupamento não perguntava.
    //
    // `''` e não `null` de propósito: `null = null` não é verdade em SQL, então
    // com `null` nem as vagas de empregador nomeado casariam entre si.
    sql`(case
      when lower(btrim(${row.companyName})) = lower(btrim(coalesce(${sourceLabel}, '')))
      then ${row.id}::text
      else ''
    end)`,
  ];
}

/** Uma vaga do grupo, do jeito que a linha consolidada precisa dela. */
export type GroupPosting = { id: number; location: string | null };

const APELIDO_DO_GRUPO = "vaga_do_grupo";
const APELIDO_DA_FONTE_DA_IRMA = "fonte_da_irma";

/**
 * As vagas do grupo de cada linha da página, a própria inclusive.
 *
 * Uma consulta para a página inteira, não uma por linha. Como subconsulta
 * correlacionada na projeção, isto custava 215ms sobre uma lista de 61ms —
 * cinquenta varreduras do acervo para responder cinquenta vezes a mesma
 * pergunta. Um join contra as linhas já escolhidas responde numa passada.
 */
async function groupPostingsOf(linhas: number[]): Promise<Map<number, GroupPosting[]>> {
  const porLinha = new Map<number, GroupPosting[]>();
  if (linhas.length === 0) return porLinha;
  const irma = alias(job, APELIDO_DO_GRUPO);
  const fonteDaIrma = alias(source, APELIDO_DA_FONTE_DA_IRMA);
  const [fonte, titulo, empresa, anonima] = groupKey(irma, fonteDaIrma.label);
  const [minhaFonte, meuTitulo, minhaEmpresa, souAnonima] = groupKey(job, source.label);
  const rows = await getDb()
    .select({ linha: job.id, id: irma.id, location: irma.locationRaw })
    .from(job)
    .leftJoin(source, eq(source.id, job.sourceId))
    .innerJoin(
      irma,
      and(
        isNull(irma.closedAt),
        sql`${fonte} = ${minhaFonte}`,
        sql`${titulo} = ${meuTitulo}`,
        sql`${empresa} = ${minhaEmpresa}`,
      )!,
    )
    .leftJoin(fonteDaIrma, eq(fonteDaIrma.id, irma.sourceId))
    // O quarto elemento da chave fica no `where`, não no `on` da irmã: ele lê o
    // rótulo da fonte DELA, que só existe depois do join seguinte.
    .where(and(inArray(job.id, linhas), sql`${anonima} = ${souAnonima}`))
    .orderBy(asc(job.id), asc(irma.id));
  for (const row of rows) {
    const atual = porLinha.get(row.linha);
    const posting = { id: row.id, location: row.location };
    if (atual) atual.push(posting);
    else porLinha.set(row.linha, [posting]);
  }
  return porLinha;
}

/**
 * A publicação que representa o grupo — escolhida **entre as que passam pelos
 * filtros do quadro**, e não entre todas as abertas.
 *
 * Antes era um anti-join: "ninguém aberto do grupo tem id menor que o meu". O
 * anti-join não sabia de `minFit`, de `hideBlocked`, de `term` nem de
 * `freshDays`, porque esses predicados moram no `where` de fora. Quando a
 * publicação de menor id do grupo era justamente a que falhava um filtro, TODAS
 * as irmãs falhavam o teste de canônica, e **o grupo inteiro desaparecia do
 * quadro** mesmo com uma irmã casando tudo.
 *
 * E o gatilho era a tela padrão. `grouped` vale `true` por omissão e o corte é
 * 45; geo vale 15 dos 100 pontos e sai de `locationRaw`, então duas publicações
 * do mesmo grupo caem rotineiramente em lados opostos do corte. Com
 * `?unblocked=1` era determinístico em vez de provável: o bloqueador vem da
 * restrição de local, logo a publicação on-site nos EUA de um grupo é
 * exatamente a que o filtro remove — e ela levava a irmã remota embora.
 * `countBoard` compartilha o predicado, então o rodapé concordava com a lista e
 * nada parecia errado.
 *
 * `row_number()` sobre o conjunto já filtrado resolve por construção: a janela
 * só vê linhas que passaram, então a canônica é a de menor id ENTRE ELAS. Um
 * filtro novo entra sem precisar ser repetido aqui, que é o que o anti-join não
 * dava.
 *
 * A subconsulta não é correlacionada — nenhuma referência à linha de fora —,
 * então o Postgres a avalia uma vez e casa por hash.
 */
function canonicalOfGroup(opts: BoardFilters, candidateId: number | null, pay?: PaySql): SQL {
  const chave = sql.join(groupKey(job, source.label), sql`, `);
  // Ordenar por salário não muda qual publicação representa o grupo. Só a
  // faixa ou a exigência de salário comparável precisam do câmbio nesta leitura.
  const groupPay = payCondition(opts.pay, pay?.amount) ? pay : undefined;
  // Sem `groupRepeats`, senão a condição se chamaria de dentro dela mesma.
  const dentro = boardConditions({ ...opts, groupRepeats: false }, candidateId, groupPay);
  return sql`${job.id} in (
    select ordenado.id from (
      select ${job.id} as id,
             row_number() over (partition by ${chave} order by ${job.id}) as rn
      from ${job}
      left join ${jobScore} on ${scoreJoin(candidateId, opts.track)}
      left join ${application} on ${and(
        eq(application.jobId, job.id),
        scopedTo(application.candidateId, candidateId),
      )}
      left join ${source} on ${eq(source.id, job.sourceId)}
      left join ${jobPage} on ${eq(jobPage.jobId, job.id)}
      ${groupPay?.relation.kind === "shared"
        ? sql`left join ${groupPay.relation.table} on ${eq(groupPay.relation.table.jobId, job.id)}`
        : sql``}
      where ${and(...dentro)}
    ) ordenado
    where ordenado.rn = 1
  )`;
}

const APELIDO_DA_ANCORA = "vaga_ancora";
const APELIDO_DA_FONTE_DA_ANCORA = "fonte_da_ancora";

/**
 * True for every posting that shares the anchor's group.
 *
 * **A âncora tem de estar aberta.** O contrato de `sameGroupAs` diz que o link
 * vale enquanto a publicação que ele nomeia está aberta e dá 404 quando ela
 * fecha; sem o predicado, linha fechada continuava sendo linha, o `exists`
 * casava, o `isNull(closedAt)` de fora derrubava só a âncora, e a página caía em
 * `rows[0]`: cabeçalho, contagem e lista descrevendo OUTRA publicação sob a URL
 * da que a pessoa tinha salvo.
 */
function sameGroupCondition(anchorId: number): SQL {
  const ancora = alias(job, APELIDO_DA_ANCORA);
  const fonteDaAncora = alias(source, APELIDO_DA_FONTE_DA_ANCORA);
  const [fonte, titulo, empresa, anonima] = groupKey(ancora, fonteDaAncora.label);
  const [minhaFonte, meuTitulo, minhaEmpresa, souAnonima] = groupKey(job, source.label);
  return sql`exists (
    select 1 from ${job} as ${sql.identifier(APELIDO_DA_ANCORA)}
    left join ${source} as ${sql.identifier(APELIDO_DA_FONTE_DA_ANCORA)}
      on ${fonteDaAncora.id} = ${ancora.sourceId}
    where ${ancora.id} = ${anchorId}
      and ${ancora.closedAt} is null
      and ${fonte} = ${minhaFonte}
      and ${titulo} = ${meuTitulo}
      and ${empresa} = ${minhaEmpresa}
      and ${anonima} = ${souAnonima}
  )`;
}

/** Abaixo disto a vaga conta como "sem descrição": só título e ruído de scraping. */
const MIN_DESCRIPTION_CHARS = 200;

/**
 * "A descrição tem ao menos `MIN_DESCRIPTION_CHARS` caracteres", sem medi-la.
 *
 * `length(descricao) >= 200` obriga o PostgreSQL a descomprimir o texto INTEIRO
 * de cada linha (TOAST/pglz) só para comparar com 200, e a lista fazia isso
 * antes do LIMIT, em todas as vagas abertas. `substr(texto, 200, 1) <> ''` diz
 * o mesmo — o 200º caractere existe se, e só se, há 200 — e só precisa do início
 * do texto. Medido no acervo local (9 mil vagas): 103ms → 26ms, resultado
 * idêntico nas bordas (199/200/201, acento, emoji, vazio, nulo).
 */
function fullDescriptionSql(): SQL {
  return sql`substr(coalesce(${job.descriptionText}, ''), ${sql.raw(String(MIN_DESCRIPTION_CHARS))}, 1) <> ''`;
}

const DAY_MS = 86_400_000;

function freshnessCutoff(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/**
 * Vagas cuja descrição — da fonte ou capturada — PODE conter o termo.
 *
 * É um superconjunto (ver `termPrefilterLike`): inclui a descrição da fonte
 * mesmo quando a capturada a substitui, o que só amplia o conjunto que o `~*`
 * confere.
 *
 * `array(...)`, e não `in (...)` nem semijunção. O `in` dentro do `or` vira
 * subplano com hash, e o planner o reconstrói em cada lugar onde repete o
 * filtro (duas vezes por ocorrência, medido). Fora do `or`, como semijunção,
 * a estimativa de linhas do conjunto derrubava o agrupamento num laço
 * aninhado: 3,4 s no benchmark. O `array` é um InitPlan — calculado uma vez
 * por consulta — e o filtro continua onde estava, com a mesma forma de plano.
 *
 * A expressão vem de `withoutSeparators` e o predicado de vaga aberta repete
 * o de `job_description_trgm_idx`: é o que deixa o planner casar a consulta
 * com o índice. `replace` duas vezes, e não `translate`, porque o índice é com
 * perdas e cada candidato tem a expressão reconferida: no acervo local
 * `translate` custou o dobro (457 contra 227 ms nas 5.576 abertas).
 */
function termTextCandidates(like: string): SQL {
  return sql`array(select ${job.id} from ${job}
    where ${job.closedAt} is null and ${withoutSeparators(job.descriptionText)} ilike ${like}
    union all
    select ${jobPage.jobId} from ${jobPage}
    where ${withoutSeparators(jobPage.text)} ilike ${like})`;
}

function boardConditions(opts: BoardFilters, candidateId: number | null, pay?: PaySql): SQL[] {
  const conditions: SQL[] = [isNull(job.closedAt)];
  // Fit, cluster, blockers and application status are candidate-scoped. A
  // recruiter or admin without a candidate identity must still see the
  // global corpus when the board's default cut is 45+; joining with a
  // deliberate `1 = 0` predicate makes those columns null, so applying the
  // cut here would hide every open job from the global board.
  if (candidateId !== null) {
    // Nas telas, vaga sem nota para este candidato passa pela faixa de Score
    // (#279). `fit` é `not null` na tabela, então nulo aqui é só a ausência da
    // linha no left join: nota ainda não calculada, não nota zero. Ler como
    // zero transformava a espera em reprovação, e o candidato recém-criado via
    // o quadro vazio com o corte padrão de 45 (regra 8: dado faltante é
    // neutro). A ordenação continua levando as sem nota para o fim.
    const unscored = opts.keepUnscored ? sql`${jobScore.fit} is null or ` : sql``;
    conditions.push(sql`(${unscored}coalesce(${jobScore.fit}, 0) >= ${opts.minFit ?? 0})`);
    if (opts.maxFit !== undefined) {
      conditions.push(sql`(${unscored}coalesce(${jobScore.fit}, 0) <= ${opts.maxFit})`);
    }
    if (opts.cluster) conditions.push(eq(jobScore.cluster, opts.cluster));
    if (opts.hideBlocked) {
      conditions.push(sql`coalesce(${jobScore.blockers}::jsonb, '[]'::jsonb) = '[]'::jsonb`);
    }
    if (opts.hideApplied) {
      conditions.push(sql`(${application.id} is null or ${application.appliedAt} is null)`);
    }
    if (opts.status === "unfiled") conditions.push(isNull(application.id));
    else if (opts.status === undefined) {
      // Arquivar é "não me interessa": a vaga sai de toda lista que não pediu
      // as arquivadas pelo nome (`status=archived`) ou tudo (`any`).
      conditions.push(sql`(${application.id} is null or ${application.status} <> 'archived')`);
    } else if (opts.status !== "any") {
      conditions.push(eq(application.status, opts.status));
    }
  }
  if (opts.term) {
    // Bound as a parameter, never spliced: the pattern is escaped by the term
    // kernel and still travels as data (`O'Reilly%_` is just text here).
    const pattern = termRegexSql(opts.term.term);
    const like = termPrefilterLike(opts.term.term);
    const inText = sql`coalesce(${jobPage.text}, ${job.descriptionText}, '') ~* ${pattern}`;
    // Título e empresa são curtos e vão direto ao `~*`. A descrição é o texto
    // longo, descomprimido linha a linha: ali o índice trigrama corta antes o
    // que nunca casaria, e o `~*` continua decidindo (#214).
    conditions.push(
      sql`(${job.title} ~* ${pattern} or ${job.companyName} ~* ${pattern} or ${
        like ? sql`(${job.id} = any(${termTextCandidates(like)}) and ${inText})` : inText
      })`,
    );
  }
  if (opts.sourceKinds && opts.sourceKinds.length > 0) {
    // Igualdade sobre o prefixo extraído, não `like`.
    //
    // O valor viaja como parâmetro, então nunca houve injeção — mas
    // metacaractere de `like` DENTRO de um parâmetro continua sendo
    // metacaractere, e a fonte é texto livre lido da URL. `?source=%` montava
    // `like '%:%'`, que toda `source_id` casa: o chip aparecia como filtro ativo
    // e o quadro mostrava todas as fontes. `?source=_ever` escolhia
    // `lever:jobgether`, uma fonte que ninguém marcou.
    //
    // `split_part` é o mesmo recorte que `boardFacets` usa para listar as fontes,
    // então o que o combo oferece e o que o filtro aceita passam a ser a mesma
    // coisa — é a regra do vizinho `strpos` aplicada aqui.
    const kinds = sql.join(
      opts.sourceKinds.map((kind) => sql`${kind}`),
      sql`, `,
    );
    conditions.push(sql`split_part(${job.sourceId}, ':', 1) in (${kinds})`);
  }
  if (opts.groupRepeats) conditions.push(canonicalOfGroup(opts, candidateId, pay));
  if (opts.sameGroupAs !== undefined) conditions.push(sameGroupCondition(opts.sameGroupAs));
  if (opts.company) {
    // `strpos`, not `like`: the value travels as a parameter and `%` or `_`
    // inside a company name stay literal, with nothing to escape.
    conditions.push(sql`strpos(lower(${job.companyName}), lower(${opts.company})) > 0`);
  }
  if (opts.broughtBy) conditions.push(sql`${job.id} in ${attributedJobIds(opts.broughtBy.termKey)}`);
  if (opts.workMode) conditions.push(eq(workModeSql(), opts.workMode));
  if (opts.freshDays && opts.freshDays > 0) {
    conditions.push(
      sql`coalesce(${job.postedAt}, ${job.firstSeenAt}) >= ${freshnessCutoff(opts.freshDays)}`,
    );
  }
  if (opts.hasComp) conditions.push(sql`coalesce(${job.compMax}, ${job.compMin}, 0) > 0`);
  if (opts.hasDescription) conditions.push(fullDescriptionSql());
  if (opts.namedEmployer) {
    conditions.push(sql`lower(${job.companyName}) <> lower(coalesce(${source.label}, ''))`);
  }
  const payFilter = payCondition(opts.pay, pay?.amount);
  if (payFilter) conditions.push(payFilter);
  return conditions;
}

/**
 * Every sort ends in fit and then `job.id`: two rows that tie on the chosen
 * key must keep the same order between page 1 and page 2, or a job appears on
 * both pages and another on neither. With a pay filter, rows whose pay cannot
 * be compared come after the ones that qualify, whatever the sort.
 */
function boardOrder(opts: BoardFilters, pay?: PaySql): SQL[] {
  const fit = desc(sql`coalesce(${jobScore.fit}, 0)`);
  const bounded = opts.pay?.min !== undefined || opts.pay?.max !== undefined;
  const payLast = pay && bounded ? [asc(sql`(${pay.amount} is null)`)] : [];
  if (opts.sort === "comp") {
    const byPay = pay
      ? [asc(sql`(${pay.amount} is null)`), desc(sql`coalesce(${pay.amount}, 0)`)]
      : [desc(sql`coalesce(${job.compMax}, ${job.compMin}, 0)`)];
    return [...byPay, fit, asc(job.id)];
  }
  if (opts.sort === "recent") {
    return [...payLast, desc(sql`coalesce(${job.postedAt}, ${job.firstSeenAt})`), fit, asc(job.id)];
  }
  return [...payLast, fit, desc(job.firstSeenAt), asc(job.id)];
}

/** The main board: open jobs joined with score and pipeline state. */
/**
 * O predicado que amarra score e candidatura ao candidato da sessão.
 *
 * `null` significa sessão SEM escopo de candidato — um recrutador ou um admin
 * puro. Para eles o acervo existe, mas nota de aderência e estado de
 * candidatura não: são colunas de outra pessoa. `1 = 0` faz o `leftJoin` nunca
 * casar, e as colunas voltam nulas, que é exatamente o que elas são.
 *
 * Um `-1` sentinela faria o mesmo e mentiria sobre a intenção; o dia em que
 * alguém criasse um candidato com id negativo, o acervo dele vazaria para todo
 * mundo sem escopo.
 */
function scopedTo(column: PgColumn, candidateId: number | null) {
  return candidateId === null ? sql`1 = 0` : eq(column, candidateId);
}

/** The score row a job joins to: the candidate's, on the chosen track or the primary. */
function scoreJoin(candidateId: number | null, track?: TrackScope): SQL {
  return and(
    eq(jobScore.jobId, job.id),
    scopedTo(jobScore.candidateId, candidateId),
    track ? scoreTrackFilter(track) : primaryScoreFilter(),
  )!;
}

export async function listBoard(
  candidateId: number | null,
  opts: BoardFilters = {},
): Promise<BoardRow[]> {
  return (await readBoard(candidateId, opts, false)).rows;
}

/** A página e seu total, calculados sobre o mesmo conjunto filtrado. */
export async function listBoardPage(
  candidateId: number | null,
  opts: BoardFilters = {},
): Promise<{ rows: BoardRow[]; total: number }> {
  return readBoard(candidateId, opts, true);
}

function selectBoardPage(candidateId: number | null, opts: BoardFilters, conditions: SQL[], order: SQL[], pay?: PaySql) {
  // A janela carrega só id e chaves de ordenação. Incluir descrições e estado
  // completo aqui fazia as 5.500 linhas elegíveis derramarem 967 blocos em
  // disco no benchmark sem agrupamento; esses dados só são lidos após o LIMIT.
  let query = getDb().select({ jobId: job.id, total: sql<number>`count(*) over ()`.as("total") })
    .from(job)
    .leftJoin(jobScore, scoreJoin(candidateId, opts.track))
    .leftJoin(application, and(eq(application.jobId, job.id), scopedTo(application.candidateId, candidateId)))
    .leftJoin(source, eq(source.id, job.sourceId))
    .leftJoin(jobPage, eq(jobPage.jobId, job.id))
    .where(and(...conditions))
    .orderBy(...order)
    .limit(opts.limit ?? 200)
    .offset(opts.offset ?? 0)
    .$dynamic();
  if (pay?.relation.kind === "shared") query = query.leftJoin(pay.relation.table, eq(pay.relation.table.jobId, job.id));
  else if (pay) query = query.leftJoinLateral(pay.relation.table, sql`true`);
  return getDb().$with("board_page").as(query);
}

async function readBoard(
  candidateId: number | null,
  opts: BoardFilters,
  withTotal: boolean,
): Promise<{ rows: BoardRow[]; total: number }> {
  const db = getDb();
  const pay = await payContext(opts);
  const conditions = boardConditions(opts, candidateId, pay);
  const order = boardOrder(opts, pay);
  const page = withTotal ? selectBoardPage(candidateId, opts, conditions, order, pay) : undefined;

  let query = db.with(...(pay?.relation.kind === "shared" ? [pay.relation.table] : []), ...(page ? [page] : []))
    .select({
      boardTotal: page ? sql<number>`${page.total}` : sql<number | null>`null::bigint`,
      jobId: job.id,
      title: job.title,
      companyName: job.companyName,
      locationRaw: job.locationRaw,
      url: job.url,
      applyUrl: job.applyUrl,
      postedAt: job.postedAt,
      firstSeenAt: job.firstSeenAt,
      sourceId: job.sourceId,
      sourceLabel: source.label,
      compMin: job.compMin,
      compMax: job.compMax,
      compCurrency: job.compCurrency,
      compPeriod: job.compPeriod,
      fit: jobScore.fit,
      trackId: jobScore.trackId,
      cluster: jobScore.cluster,
      titleScore: jobScore.titleScore,
      keywordScore: jobScore.keywordScore,
      seniorityScore: jobScore.seniorityScore,
      geoScore: jobScore.geoScore,
      compScore: jobScore.compScore,
      freshnessScore: jobScore.freshnessScore,
      benefitScore: jobScore.benefitScore,
      blockers: jobScore.blockers,
      reasons: jobScore.reasons,
      hasFullDescription: sql<boolean>`${fullDescriptionSql()}`,
      // Captured offline by the scraper. Present means the description can be
      // read without leaving the app — and without the employer seeing a visit.
      //
      // Truncated in SQL, not in the component: a board page carries dozens of
      // rows, Next serialises the data twice (HTML plus the RSC payload), and
      // full descriptions average 7.400 characters. Sending all of it would
      // cost a megabyte to render a list nobody reads in full. The job's own
      // page loads the complete text, where it is one row and free.
      // Manual comparisons already carry their complete description in the
      // canonical job row; they never pass through the scraper. Falling back
      // only for that source keeps them readable from the board without
      // inflating every row with a second copy of an adapter description.
      pageText: sql<string | null>`substr(coalesce(${jobPage.text}, case when ${job.sourceId} like 'manual:%' then ${job.descriptionText} end), 1, ${PREVIEW_CHARS})`,
      pageTextLength: sql<number>`length(coalesce(${jobPage.text}, case when ${job.sourceId} like 'manual:%' then ${job.descriptionText} end, ''))`,
      pageExtracted: jobPage.extracted,
      pageFetchedAt: jobPage.fetchedAt,
      status: application.status,
      appliedAt: application.appliedAt,
      checkedAt: job.checkedAt,
      checkStatus: job.checkStatus,
      checkCode: job.checkCode,
      checkQueue: verifyTask.status,
      // `""` is "never visited": every row is new. Only absence means no marker.
      isNew: opts.newSince !== undefined
        ? sql<boolean>`${job.firstSeenAt} > ${opts.newSince}`
        : sql<boolean>`false`,
      payAmount: pay ? sql<number | null>`${pay.amount}` : sql<number | null>`null::float8`,
      payState: pay
        ? sql<BoardRow["payState"]>`${pay.state}`
        : sql<BoardRow["payState"]>`null::text`,
    })
    .from(job)
    .leftJoin(jobScore, scoreJoin(candidateId, opts.track))
    .leftJoin(
      application,
      and(eq(application.jobId, job.id), scopedTo(application.candidateId, candidateId)),
    )
    .leftJoin(source, eq(source.id, job.sourceId))
    .leftJoin(verifyTask, eq(verifyTask.jobId, job.id))
    .leftJoin(jobPage, eq(jobPage.jobId, job.id))
    .where(page ? undefined : and(...conditions))
    .orderBy(...order)
    .$dynamic();
  if (page) query = query.innerJoin(page, eq(page.jobId, job.id));
  else query = query.limit(opts.limit ?? 200).offset(opts.offset ?? 0);
  if (pay?.relation.kind === "shared") query = query.leftJoin(pay.relation.table, eq(pay.relation.table.jobId, job.id));
  else if (pay) query = query.leftJoinLateral(pay.relation.table, sql`true`);
  const rows = await query;
  // Uma página além do fim não tem linha para carregar a janela. Só nesse
  // caso (ou limite zero) a contagem precisa de uma consulta separada.
  let total = 0;
  if (withTotal) {
    if (rows[0]) total = Number(rows[0].boardTotal);
    else if ((opts.offset ?? 0) > 0 || opts.limit === 0) total = await countBoard(candidateId, opts);
  }
  const grupos = opts.groupRepeats ? await groupPostingsOf(rows.map((row) => row.jobId)) : new Map<number, GroupPosting[]>();
  return {
    total,
    rows: rows.map(({ boardTotal: _total, ...row }) => ({ ...row, repeats: grupos.get(row.jobId) ?? [] })),
  };
}

/**
 * How many rows match, without fetching them.
 *
 * Needed for pagination: the page shows 50 of N, and N cannot come from the
 * page itself. Re-uses the same predicate builder so a filter can never mean
 * one thing in the list and another in the count.
 */
export async function countBoard(
  candidateId: number | null,
  opts: BoardFilters = {},
): Promise<number> {
  const pay = await payContext(opts);
  return countWhere(candidateId, opts, boardConditions(opts, candidateId, pay), pay);
}

async function countWhere(candidateId: number | null, opts: BoardFilters, conditions: SQL[], pay?: PaySql): Promise<number> {
  let query = getDb().with(...(pay?.relation.kind === "shared" ? [pay.relation.table] : []))
    .select({ count: sql<number>`count(*)` })
    .from(job)
    .leftJoin(jobScore, scoreJoin(candidateId, opts.track))
    .leftJoin(
      application,
      and(eq(application.jobId, job.id), scopedTo(application.candidateId, candidateId)),
    )
    .leftJoin(source, eq(source.id, job.sourceId))
    .leftJoin(jobPage, eq(jobPage.jobId, job.id))
    .where(and(...conditions))
    .$dynamic();
  if (pay?.relation.kind === "shared") query = query.leftJoin(pay.relation.table, eq(pay.relation.table.jobId, job.id));
  else if (pay) query = query.leftJoinLateral(pay.relation.table, sql`true`);
  const [row] = await query;
  return Number(row?.count ?? 0);
}

/**
 * How many jobs the pay range hid: everything else matches, the pay is
 * disclosed and comparable, and it sits below the floor or above the ceiling.
 * The screen says the number so a range never silently empties the list.
 */
export async function countHiddenByPayRange(
  candidateId: number | null,
  opts: BoardFilters = {},
): Promise<number> {
  if (!opts.pay || (opts.pay.min === undefined && opts.pay.max === undefined)) return 0;
  const pay = await payContext(opts);
  const conditions = boardConditions({ ...opts, pay: undefined }, candidateId);
  const outside: SQL[] = [];
  if (opts.pay.min !== undefined) outside.push(sql`${pay!.amount} < ${opts.pay.min}`);
  if (opts.pay.max !== undefined) outside.push(sql`${pay!.amount} > ${opts.pay.max}`);
  return countWhere(candidateId, opts, [...conditions, sql`(${sql.join(outside, sql` or `)})`], pay);
}

/** Counts for the filter chips, so the UI can show what each option yields. */
export async function boardFacets(candidateId: number | null, base: BoardFilters = {}) {
  const sourceKind = sql<string>`split_part(${job.sourceId}, ':', 1)`;
  const matchesSource = base.sourceKinds?.length
    ? inArray(sourceKind, [...base.sourceKinds]) : sql`true`;
  const matchesCluster = candidateId !== null && base.cluster
    ? eq(jobScore.cluster, base.cluster) : sql`true`;
  const group = sql.join(groupKey(job, source.label), sql`, `);
  const freshCutoff = freshnessCutoff(3);

  // A dimensão não restringe as próprias opções. Fonte faz parte da chave do
  // grupo, então seu filtro aceita ou recusa o grupo inteiro. Cluster pode
  // mudar entre irmãs: o resumo precisa da primeira que passa pelo cluster,
  // enquanto as opções de cluster precisam da primeira sem esse filtro.
  const eligible = getDb().$with("facet_candidates").as(
    getDb()
      .select({
        id: job.id,
        cluster: jobScore.cluster,
        kind: sourceKind.as("kind"),
        matchesSource: matchesSource.as("matches_source"),
        matchesCluster: matchesCluster.as("matches_cluster"),
        firstId: (base.groupRepeats
          ? sql`min(${job.id}) over (partition by ${group})` : sql`${job.id}`).as("first_id"),
        firstSelectedId: (base.groupRepeats
          ? sql`min(${job.id}) filter (where ${matchesCluster}) over (partition by ${group})`
          : sql`${job.id}`).as("first_selected_id"),
        unblocked: sql`coalesce(${jobScore.blockers}::jsonb, '[]'::jsonb) = '[]'::jsonb`.as("unblocked"),
        fresh: sql`coalesce(${job.postedAt}, ${job.firstSeenAt}) >= ${freshCutoff}`.as("fresh"),
        withComp: sql`coalesce(${job.compMax}, ${job.compMin}, 0) > 0`.as("with_comp"),
        named: sql`lower(${job.companyName}) <> lower(coalesce(${source.label}, ''))`.as("named"),
        described: fullDescriptionSql().as("described"),
        notApplied: sql`${application.appliedAt} is null`.as("not_applied"),
      })
      .from(job)
      .leftJoin(jobScore, scoreJoin(candidateId, base.track))
      .leftJoin(
        application,
        and(eq(application.jobId, job.id), scopedTo(application.candidateId, candidateId)),
      )
      .leftJoin(source, eq(source.id, job.sourceId))
      .leftJoin(jobPage, eq(jobPage.jobId, job.id))
      .where(and(...boardConditions({ ...base, sourceKinds: undefined, cluster: undefined, groupRepeats: false }, candidateId))),
  );
  const inSummary = sql`${eligible.matchesSource} and ${eligible.matchesCluster} and ${eligible.id} = ${eligible.firstSelectedId}`;
  const count = (condition: SQL = sql`true`) => sql<number>`count(*) filter (where ${inSummary} and ${condition})`;
  const [summary] = await getDb().with(eligible).select({
    total: count(),
    unblocked: count(sql`${eligible.unblocked}`),
    fresh: count(sql`${eligible.fresh}`),
    withComp: count(sql`${eligible.withComp}`),
    named: count(sql`${eligible.named}`),
    described: count(sql`${eligible.described}`),
    notApplied: count(sql`${eligible.notApplied}`),
    clusters: sql<string[] | null>`array_agg(distinct ${eligible.cluster}) filter (
      where ${eligible.matchesSource} and ${eligible.id} = ${eligible.firstId} and ${eligible.cluster} is not null
    )`,
    // Para listar fontes basta existir uma publicação elegível: todas as irmãs
    // do grupo têm o mesmo prefixo e a agregação já elimina duplicatas.
    sources: sql<string[] | null>`array_agg(distinct ${eligible.kind}) filter (where ${eligible.matchesCluster})`,
  }).from(eligible);
  return {
    total: Number(summary?.total ?? 0),
    unblocked: Number(summary?.unblocked ?? 0),
    fresh: Number(summary?.fresh ?? 0),
    withComp: Number(summary?.withComp ?? 0),
    named: Number(summary?.named ?? 0),
    described: Number(summary?.described ?? 0),
    notApplied: Number(summary?.notApplied ?? 0),
    clusters: (summary?.clusters ?? []).sort(),
    sources: (summary?.sources ?? []).sort(),
  };
}

/** Move a job through the pipeline and record the transition. */
type DbTransaction = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * Persist one aggregate transition using the caller's transaction.
 *
 * Integration use cases that atomically update another context (for example,
 * accepting a mail suggestion) use this entry point so the suggestion,
 * application and event either all commit or all roll back.
 */
export async function setApplicationStatusInTransaction(
  tx: DbTransaction,
  candidateId: number,
  jobId: number,
  status: ApplicationStatus,
  detail?: string,
  stamp = new Date().toISOString(),
  /**
   * Por onde a candidatura foi. `direct` | `ats` | `referral` | `recruiter` |
   * `agency`.
   *
   * É propriedade da CANDIDATURA e não da transição, e é por isso que a escrita
   * dela não depende de o status ter mudado: registrar que uma candidatura já
   * enviada saiu por referral é informação nova sobre um fato antigo.
   *
   * A coluna existe desde o começo, o funil a renderiza e o `jho prep` manda
   * preenchê-la — e nada no sistema escrevia nela. Referral é ~7% dos
   * candidatos e ~40% das contratações; sem esse campo o funil não consegue
   * medir a única alavanca que o próprio produto diz ser a mais forte.
   */
  channel?: string,
): Promise<void> {
  const [previous] = await tx
      .select()
      .from(application)
      .where(
        and(
          eq(application.candidateId, candidateId),
          eq(application.jobId, jobId),
        ),
      )
      .limit(1);

  const transition = transitionApplication(
    previous ? { status: previous.status, appliedAt: previous.appliedAt } : null,
    status,
    stamp,
  );
  if (!transition.ok) {
    throw new IllegalApplicationTransitionError(
      transition.error.from,
      transition.error.to,
    );
  }
  if (!transition.changed) {
    // Status igual, mas o canal pode ser novo. Sair aqui sem gravar descartaria
    // em silêncio o que a pessoa acabou de informar.
    if (channel && previous) {
      await tx
        .update(application)
        .set({ channel, updatedAt: stamp })
        .where(eq(application.id, previous.id));
    }
    // A nota tem a mesma natureza que o canal, e por muito tempo não teve o
    // mesmo tratamento: ela era descartada aqui. Isso ficou alcançável demais
    // quando a interface passou a oferecer só transições legais — de um estado
    // terminal a única opção É a atual, então salvar uma nota caía sempre neste
    // caminho, com a tela anunciando sucesso e nada gravado. Não é transição:
    // vai como evento `note`, sem `from`/`to`.
    if (detail?.trim() && previous) {
      await tx.insert(applicationEvent).values({
        applicationId: previous.id,
        at: stamp,
        kind: "note",
        fromStatus: null,
        toStatus: null,
        detail,
      });
    }
    return;
  }

  let applicationId: number;
  if (previous) {
    const updated = await tx
        .update(application)
        .set({
          status: transition.state.status,
          appliedAt: transition.state.appliedAt,
          updatedAt: stamp,
          // Só sobrescreve quando veio um canal: um `track` sem `--channel` não
          // pode apagar o que já estava registrado.
          ...(channel ? { channel } : {}),
        })
        // The status is the aggregate's optimistic concurrency token. Two
        // commands may decide from the same snapshot, but only one can commit
        // that snapshot and append its matching event.
        .where(
          and(
            eq(application.id, previous.id),
            eq(application.status, previous.status),
          ),
        )
        .returning({ id: application.id });
    if (updated.length !== 1) {
      throw new ApplicationTransitionConflictError(candidateId, jobId);
    }
    applicationId = previous.id;
  } else {
    const [created] = await tx
        .insert(application)
        .values({
          candidateId,
          jobId,
          status: transition.state.status,
          appliedAt: transition.state.appliedAt,
          updatedAt: stamp,
          channel: channel ?? null,
        })
        .returning({ id: application.id });
    if (!created) throw new Error("application insert returned no row");
    applicationId = created.id;
  }

  await tx.insert(applicationEvent).values({
    applicationId,
    at: transition.event.at,
    kind: transition.event.kind,
    fromStatus: transition.event.fromStatus,
    toStatus: transition.event.toStatus,
    detail: detail ?? null,
  });
}

/** Move a job through the pipeline and record the transition. */
export async function setApplicationStatus(
  candidateId: number,
  jobId: number,
  status: ApplicationStatus,
  detail?: string,
  channel?: string,
): Promise<void> {
  const db = getDb();
  await db.transaction((tx) =>
    setApplicationStatusInTransaction(tx, candidateId, jobId, status, detail, undefined, channel),
  );
}

export class ApplicationTransitionConflictError extends Error {
  readonly code = "application_transition_conflict";

  constructor(candidateId: number, jobId: number) {
    super(`Application changed concurrently: candidate ${candidateId}, job ${jobId}`);
    this.name = "ApplicationTransitionConflictError";
  }
}

/** Record the exact candidate-owned document sent with an application. */
export async function setApplicationDocument(
  candidateId: number,
  jobId: number,
  documentId: number | null,
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    if (documentId !== null) {
      const [owned] = await tx
        .select({ id: candidateDocument.id })
        .from(candidateDocument)
        .where(
          and(
            eq(candidateDocument.id, documentId),
            eq(candidateDocument.candidateId, candidateId),
          ),
        )
        .limit(1);
      if (!owned) throw new Error(`Documento ${documentId} não pertence ao candidato`);
    }

    const updated = await tx
      .update(application)
      .set({ candidateDocumentId: documentId, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(application.candidateId, candidateId),
          eq(application.jobId, jobId),
        ),
      )
      .returning({ id: application.id });
    if (updated.length !== 1) {
      throw new Error(`Candidatura não encontrada: candidato ${candidateId}, vaga ${jobId}`);
    }
  });
}

/** Funnel counts for the dashboard header. */
export async function pipelineCounts(candidateId: number): Promise<Record<string, number>> {
  const db = getDb();
  const rows = await db
    .select({ status: application.status, n: sql<number>`count(*)` })
    .from(application)
    .where(eq(application.candidateId, candidateId))
    .groupBy(application.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

export type RecruiterCandidateSummary = {
  candidateId: number;
  name: string;
  slug: string;
  counts: Record<string, number>;
  total: number;
};

/**
 * Resumo do funil de cada candidato que o recrutador acompanha.
 *
 * O escopo entra em SQL, como `inArray`, e não como filtro sobre um resultado
 * global: o banco nunca chega a ler linha de quem não está na lista. Filtrar
 * depois daria o mesmo resultado na tela e um risco diferente no dia em que
 * alguém esquecer o filtro — e uma consulta que carrega o funil inteiro para
 * descartar 99% dele é cara justamente onde o acervo é grande.
 *
 * Lista vazia devolve vazio sem consultar: recrutador sem vínculo nenhum não
 * tem o que ver, e `inArray` com lista vazia é SQL inválido em alguns dialetos.
 */
export async function recruiterCandidateSummaries(
  candidateIds: readonly number[],
): Promise<RecruiterCandidateSummary[]> {
  if (candidateIds.length === 0) return [];
  const db = getDb();
  const scope = [...candidateIds];

  const [people, counted] = await Promise.all([
    db
      .select({ id: candidate.id, name: candidate.name, slug: candidate.slug })
      .from(candidate)
      .where(inArray(candidate.id, scope)),
    db
      .select({
        candidateId: application.candidateId,
        status: application.status,
        n: sql<number>`count(*)`,
      })
      .from(application)
      .where(inArray(application.candidateId, scope))
      .groupBy(application.candidateId, application.status),
  ]);

  const byCandidate = new Map<number, Record<string, number>>();
  for (const row of counted) {
    const counts = byCandidate.get(row.candidateId) ?? {};
    counts[row.status] = Number(row.n);
    byCandidate.set(row.candidateId, counts);
  }

  return people
    .map((person) => {
      const counts = byCandidate.get(person.id) ?? {};
      return {
        candidateId: person.id,
        name: person.name,
        slug: person.slug,
        counts,
        total: Object.values(counts).reduce((sum, n) => sum + n, 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Everything the detail view needs, in one round trip. The score is the
 * primary track's; the other tracks' fits come from `trackFitsForJob`.
 */
export async function getJobDetail(candidateId: number | null, jobId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(job)
    .leftJoin(jobScore, scoreJoin(candidateId))
    .leftJoin(
      application,
      and(eq(application.jobId, job.id), scopedTo(application.candidateId, candidateId)),
    )
    .leftJoin(source, eq(source.id, job.sourceId))
    .where(eq(job.id, jobId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    job: row.job,
    score: row.job_score,
    application: row.application,
    source: row.source,
  };
}

/**
 * O histórico da candidatura, do mais recente para o mais antigo.
 *
 * `application_event` era escrito e lido por ninguém: a nota que a pessoa
 * digita ao mover a candidatura ia para `detail` e não voltava em superfície
 * alguma — nem na tela, nem em `jobs show`, que lê `application.notes`, outro
 * campo. Um texto aceito e irrecuperável é indistinguível de perdido.
 *
 * O escopo vem do candidato, não do id do evento: a junção exige que a
 * candidatura seja dele, então pedir o histórico de outra pessoa devolve vazio
 * em vez de devolver o dela.
 */
export async function applicationTimeline(candidateId: number | null, jobId: number) {
  const db = getDb();
  return db
    .select({
      at: applicationEvent.at,
      kind: applicationEvent.kind,
      fromStatus: applicationEvent.fromStatus,
      toStatus: applicationEvent.toStatus,
      detail: applicationEvent.detail,
    })
    .from(applicationEvent)
    .innerJoin(application, eq(application.id, applicationEvent.applicationId))
    .where(
      and(
        eq(application.jobId, jobId),
        scopedTo(application.candidateId, candidateId),
      ),
    )
    .orderBy(desc(applicationEvent.at), desc(applicationEvent.id));
}

/** Global job and canonical score, deliberately excluding private funnel data. */
export async function getJobScoringDetail(candidateId: number, jobId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(job)
    .leftJoin(jobScore, scoreJoin(candidateId))
    .leftJoin(source, eq(source.id, job.sourceId))
    .where(eq(job.id, jobId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    job: row.job,
    score: row.job_score,
    source: row.source,
  };
}

/** Headline numbers for the cockpit — primary-track fits, one per job. */
export async function corpusStats(candidateId: number) {
  const db = getDb();
  const [row] = await db
    .select({
      open: sql<number>`(select count(*) from ${job} where ${job.closedAt} is null)`.mapWith(Number),
      companies: sql<number>`(select count(*) from ${company})`.mapWith(Number),
      sources: sql<number>`(select count(*) from ${source} where ${source.enabled} = true)`.mapWith(Number),
      above45: sql<number>`(select count(*) from ${jobScore} s join ${job} j on j.id = s.job_id where s.candidate_id = ${candidateId} and ${primaryScoreFilter("s")} and j.closed_at is null and s.fit >= 45)`.mapWith(Number),
      above60: sql<number>`(select count(*) from ${jobScore} s join ${job} j on j.id = s.job_id where s.candidate_id = ${candidateId} and ${primaryScoreFilter("s")} and j.closed_at is null and s.fit >= 60)`.mapWith(Number),
      above70: sql<number>`(select count(*) from ${jobScore} s join ${job} j on j.id = s.job_id where s.candidate_id = ${candidateId} and ${primaryScoreFilter("s")} and j.closed_at is null and s.fit >= 70)`.mapWith(Number),
      best: sql<number>`(select coalesce(max(fit), 0) from ${jobScore} s join ${job} j on j.id = s.job_id where s.candidate_id = ${candidateId} and ${primaryScoreFilter("s")} and j.closed_at is null)`.mapWith(Number),
      // `best = 0` não distingue "sem nota" de "nota zero".
      scored: hasPrimaryScoreSql(candidateId),
    })
    .from(sql`(select 1) as singleton`);
  return row;
}

/**
 * O candidato já tem alguma nota na trilha principal.
 *
 * Sem nenhuma, o quadro mostra as vagas sem nota e a tela avisa que o cálculo
 * está pendente (#279) — entre salvar o currículo e a fila de repontuação
 * rodar, o quadro não pode parecer vazio nem ordenado ao acaso sem explicação.
 * `exists` para no primeiro registro do índice por candidato.
 */
function hasPrimaryScoreSql(candidateId: number): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${jobScore} s where s.candidate_id = ${candidateId} and ${primaryScoreFilter("s")})`;
}

/**
 * A mesma pergunta para uma trilha que o chamador já conhece — a tela Vagas
 * leu as trilhas antes e não volta a `target_track` para achar a principal.
 */
export async function hasTrackScores(candidateId: number, trackId: number): Promise<boolean> {
  const [row] = await getDb()
    .select({ scored: sql<boolean>`exists (select 1 from ${jobScore} s where s.candidate_id = ${candidateId} and s.track_id = ${trackId})` })
    .from(sql`(select 1) as singleton`);
  return row?.scored === true;
}

/** Cluster distribution above a cut, for the cockpit chart (primary track). */
export async function clusterBreakdown(candidateId: number, minFit = 45) {
  const db = getDb();
  return db
    .select({
      cluster: jobScore.cluster,
      n: sql<number>`count(*)`.mapWith(Number),
      best: sql<number>`max(${jobScore.fit})`,
    })
    .from(jobScore)
    .innerJoin(job, eq(job.id, jobScore.jobId))
    .where(
      and(
        eq(jobScore.candidateId, candidateId),
        primaryScoreFilter(),
        isNull(job.closedAt),
        gte(jobScore.fit, minFit),
      ),
    )
    .groupBy(jobScore.cluster)
    .orderBy(desc(sql`count(*)`));
}

/** The funnel, with the job each application points at. */
/** Teto de linhas por página. Histórico grande não vira consulta sem fim. */
export const PIPELINE_PAGE_SIZE = 25;

export type PipelineQuery = {
  /** Já validado pela borda; `null` é "todos os estágios". */
  status?: ApplicationStatus | null;
  limit?: number;
  offset?: number;
};

export async function pipelineRows(candidateId: number, query: PipelineQuery = {}) {
  const db = getDb();
  const limit = query.limit ?? PIPELINE_PAGE_SIZE;
  const offset = query.offset ?? 0;
  const scope = query.status
    ? and(eq(application.candidateId, candidateId), eq(application.status, query.status))
    : eq(application.candidateId, candidateId);

  return db
    .select({
      jobId: job.id,
      title: job.title,
      companyName: job.companyName,
      url: job.url,
      status: application.status,
      channel: application.channel,
      appliedAt: application.appliedAt,
      nextAction: application.nextAction,
      notes: application.notes,
      fit: jobScore.fit,
      updatedAt: application.updatedAt,
      // Estado da vaga, não da candidatura: a vaga fecha sozinha e a
      // candidatura só muda por decisão do usuário.
      jobClosedAt: job.closedAt,
      jobArchivedAt: job.archivedAt,
    })
    .from(application)
    .innerJoin(job, eq(job.id, application.jobId))
    .leftJoin(jobScore, scoreJoin(candidateId))
    .where(scope)
    // `id` desempata: sem ele, duas candidaturas salvas no mesmo instante podem
    // trocar de lugar entre páginas e uma delas some da listagem.
    .orderBy(desc(application.updatedAt), desc(application.id))
    .limit(limit)
    .offset(offset);
}
