/**
 * As áreas do E2E de navegador, na ordem em que a suíte inteira as roda (#320).
 *
 * `ui.mjs` era um arquivo só, e mexer numa tela custava a suíte inteira. Cada
 * área agora é um módulo com `run(ctx)`, e `E2E_AREAS=a,b` roda só a fumaça,
 * as áreas pedidas e o que elas exigem — sempre nesta ordem, porque a ordem é
 * a única que a suíte inteira já provou.
 *
 * `requires` é a dependência de ESTADO: dado que outra área cria no banco ou
 * deixa em `ctx.state`. Cada área provou rodar só com a fumaça e o seu
 * `requires` (`pnpm test:e2e --areas <id>`, uma execução por área, em
 * 2026-09-25/26). Área nova que ainda não provou declara `requires: PREFIX`, e
 * roda depois de tudo o que vem antes dela — o único estado que a suíte
 * inteira já provou.
 */
import * as account from "./account.mjs";
import * as admin from "./admin.mjs";
import * as adminCatalog from "./admin-catalog.mjs";
import * as auth from "./auth.mjs";
import * as candidateRescore from "./candidate-rescore.mjs";
import * as canonicalFlows from "./canonical-flows.mjs";
import * as cardActions from "./card-actions.mjs";
import * as cvVersions from "./cv-versions.mjs";
import * as design from "./design.mjs";
import * as filterAutoApply from "./filter-auto-apply.mjs";
import * as i18n from "./i18n.mjs";
import * as jobAnalysis from "./job-analysis.mjs";
import * as jobAvailability from "./job-availability.mjs";
import * as jobsLoading from "./jobs-loading.mjs";
import * as jobsNew from "./jobs-new.mjs";
import * as logout from "./logout.mjs";
import * as mobile from "./mobile.mjs";
import * as navigation from "./navigation.mjs";
import * as onboarding from "./onboarding.mjs";
import * as passwordReset from "./password-reset.mjs";
import * as pipeline from "./pipeline.mjs";
import * as publicProfile from "./public-profile.mjs";
import * as pwa from "./pwa.mjs";
import * as rateLimit from "./rate-limit.mjs";
import * as recheck from "./recheck.mjs";
import * as roles from "./roles.mjs";
import * as searchRelevance from "./search-relevance.mjs";
import * as searches from "./searches.mjs";
import * as themes from "./themes.mjs";
import * as visibility from "./visibility.mjs";
import * as workMode from "./work-mode.mjs";

/** Exige todas as áreas anteriores: o único estado que a suíte inteira já provou. */
export const PREFIX = "prefix";

/** Roda sempre: login do dono, sessão que as outras usam, recusa sem sessão. */
export const SMOKE = ["auth"];

/** @type {{ id: string, run: (ctx: object) => Promise<void>, requires: string[] | typeof PREFIX }[]} */
export const AREAS = [
  { id: "auth", run: auth.run, requires: [] },
  { id: "design", run: design.run, requires: [] },
  { id: "candidate-rescore", run: candidateRescore.run, requires: [] },
  { id: "mobile", run: mobile.run, requires: [] },
  { id: "themes", run: themes.run, requires: [] },
  { id: "recheck", run: recheck.run, requires: [] },
  { id: "visibility", run: visibility.run, requires: [] },
  { id: "pipeline", run: pipeline.run, requires: [] },
  { id: "roles", run: roles.run, requires: [] },
  { id: "account", run: account.run, requires: [] },
  { id: "password-reset", run: passwordReset.run, requires: [] },
  { id: "jobs-new", run: jobsNew.run, requires: [] },
  { id: "public-profile", run: publicProfile.run, requires: [] },
  // Compara o histórico de novidades de quatro sessões: o dono (design),
  // recrutador e candidato (roles) e a sessão emprestada (aqui).
  { id: "admin", run: admin.run, requires: ["design", "roles"] },
  { id: "card-actions", run: cardActions.run, requires: [] },
  // Só a versão que não é a atual oferece excluir, e a segunda versão do
  // currículo nasce no salvamento de candidate-rescore.
  { id: "cv-versions", run: cvVersions.run, requires: ["candidate-rescore"] },
  { id: "i18n", run: i18n.run, requires: [] },
  { id: "onboarding", run: onboarding.run, requires: [] },
  { id: "rate-limit", run: rateLimit.run, requires: [] },
  { id: "navigation", run: navigation.run, requires: [] },
  { id: "work-mode", run: workMode.run, requires: [] },
  { id: "search-relevance", run: searchRelevance.run, requires: [] },
  { id: "filter-auto-apply", run: filterAutoApply.run, requires: [] },
  { id: "jobs-loading", run: jobsLoading.run, requires: [] },
  { id: "job-analysis", run: jobAnalysis.run, requires: [] },
  { id: "admin-catalog", run: adminCatalog.run, requires: [] },
  { id: "job-availability", run: jobAvailability.run, requires: [] },
  // Reabre a comparação que candidate-rescore cria.
  { id: "canonical-flows", run: canonicalFlows.run, requires: ["candidate-rescore"] },
  // E2E-011 exige que "fixture" case uma vaga de terceira fonte, além de
  // Ashby e Lever: a que canonical-flows cria ("Task 04 redirect fixture").
  { id: "searches", run: searches.run, requires: ["canonical-flows"] },
  { id: "logout", run: logout.run, requires: [] },
  { id: "pwa", run: pwa.run, requires: [] },
];

/**
 * As áreas que uma lista pede, com a fumaça e o fecho de `requires`, na ordem
 * de `AREAS`. Lista vazia ou ausente é a suíte inteira; id desconhecido
 * recusa — um nome errado rodaria menos do que se pediu, calado.
 */
export function selectAreas(spec) {
  const wanted = (spec ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (wanted.length === 0) return AREAS;
  const index = new Map(AREAS.map((area, position) => [area.id, position]));
  const unknown = wanted.filter((id) => !index.has(id));
  if (unknown.length > 0) throw new Error(`E2E_AREAS: área desconhecida: ${unknown.join(", ")}`);
  const chosen = new Set();
  const visit = (id) => {
    if (chosen.has(id)) return;
    chosen.add(id);
    const area = AREAS[index.get(id)];
    const needs = area.requires === PREFIX ? AREAS.slice(0, index.get(id)).map((item) => item.id) : area.requires;
    for (const need of needs) visit(need);
  };
  for (const id of [...SMOKE, ...wanted]) visit(id);
  return AREAS.filter((area) => chosen.has(area.id));
}
