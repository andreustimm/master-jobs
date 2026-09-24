/**
 * As rotas que as varreduras transversais do E2E medem, e as que ficam fora
 * por decisão registrada.
 *
 * Cada varredura (inglês sem português, largura sem estouro, axe WCAG 2.2 AA)
 * era um array literal dentro de `ui.mjs` ou `a11y.mjs`, e rota nova não
 * herdava nenhum deles: `/jobs/<id>` serviu três rótulos em português com a
 * interface em inglês até entrar à mão. Aqui os arrays viram dados que as
 * varreduras importam, e `tests/e2e-route-coverage.test.ts` cruza a união deles
 * com o inventário de páginas de `tests/support/entry-inventory.ts` — o mesmo
 * que decide autorização. Página nova que não entra em varredura nenhuma nem
 * em `UNMEASURED_PAGES` reprova o `pnpm check`.
 *
 * `{track}` é o id de uma trilha criada durante a própria suíte; `ui.mjs`
 * substitui antes de navegar. O teste de cobertura trata o marcador como
 * segmento dinâmico.
 */

/** Interface em inglês, como dono: nenhum texto do dicionário português nem acento fora de dado do usuário. */
export const ENGLISH_OWNER_SWEEP = [
  "/",
  "/jobs",
  "/compare",
  "/pipeline",
  "/referrals",
  "/candidate",
  "/candidate/skills",
  "/candidate/vocabulary",
  // Minha conta (#236): e-mail da sessão marcado como dado do usuário.
  "/account",
  "/jobs/new",
  "/admin/operacoes",
  // Catálogo e execuções (#223, tarefa 03).
  "/admin/plataformas",
  "/admin/execucoes",
  // O hub dos países tem quatro chaves de dicionário próprias e estava fora
  // de todas as varreduras.
  "/jobs/904000101/paises",
  // A tela de detalhe é a mais aberta do produto e estava fora daqui desde o
  // começo — o custo apareceu no QA de jornada: "← vagas", "Ver vaga na
  // origem" e "visto em" eram literais no JSX, servidos em português com a
  // interface em inglês. Ela só pôde entrar depois de o nome da empresa, a
  // localização e o rótulo da fonte ganharem `data-user-content`, porque esse
  // texto vem do acervo e é acentuado de direito. Por isso a publicação
  // varrida é a de São Paulo: numa localização sem acento, tirar a marca não
  // reprovaria nada, e a metade da guarda que a protege ficaria sem prova.
  "/jobs/904000103",
];

/** Interface em inglês, sem sessão: as telas que existem antes do login. */
export const ENGLISH_ANONYMOUS_SWEEP = [
  "/login",
  "/login/forgot",
  // Token que nunca existiu: a tela explica o link morto, sem formulário.
  "/login/reset?token=nunca-existiu-varredura",
];

/** Interface em inglês depois de a suíte criar trilhas e termos (task_05 de term-search). */
export const ENGLISH_SEARCHES_SWEEP = [
  "/searches",
  "/searches/tracks/{track}",
  "/jobs",
  "/jobs/904000101/paises",
  "/jobs/904000103",
  "/admin/captures",
  "/account",
];

/** Sem rolagem horizontal nem conteúdo cortado, de 320 a 1024 px. */
export const OVERFLOW_SWEEP = [
  "/",
  "/jobs",
  "/jobs?track=all",
  "/jobs/905000031",
  "/searches",
  "/compare",
  "/candidate",
  "/candidate/skills",
  "/pipeline",
];

/** Sem rolagem horizontal em 375, 768 e 1024 px, com as trilhas já criadas. */
export const OVERFLOW_SEARCHES_SWEEP = [
  "/searches",
  "/searches/tracks/new",
  "/searches/tracks/{track}",
  "/jobs?track=all&by={term}&pay=6000&cur=USD&per=month&fit=0",
  "/jobs/904000101/paises",
  "/jobs/904000103",
  "/admin/captures",
  "/account",
];

/** axe WCAG 2.2 AA como dono, a 1280 px. `/login` é varrida antes do login. */
export const AXE_SWEEP = [
  ["login", "/login"],
  ["jobs", "/jobs"],
  ["pipeline", "/pipeline"],
  ["candidate", "/candidate"],
  ["candidate skills", "/candidate/skills"],
  ["candidate vocabulary", "/candidate/vocabulary"],
  ["referrals", "/referrals"],
  ["admin users", "/admin/users"],
  ["account", "/account"],
  ["new job", "/jobs/new"],
  ["admin operations", "/admin/operacoes"],
  ["job countries hub", "/jobs/904000101/paises"],
  // A varredura roda como dono, que vê o formulário de funil; a medição que
  // precedeu a entrada foi como recrutador e não via o `select` sem nome.
  ["job detail", "/jobs/904000103"],
];

/**
 * Páginas fora das varreduras transversais, cada uma com o porquê.
 *
 * Exceção é decisão, não esquecimento: ela diz onde a página é exercitada e o
 * que falta para entrar. A chave é o arquivo, como o inventário o descobre.
 */
export const UNMEASURED_PAGES = {
  "app/admin/plataformas/[id]/page.tsx":
    "o id é `kind:handle` de uma fonte criada na própria suíte; admin-catalog.mjs percorre cadastro, sondagem e captura e mede 375 px e o inglês nela",
  "app/admin/execucoes/[id]/page.tsx":
    "o id é de uma execução criada na própria suíte; admin-catalog.mjs confere o detalhe depois de refresh, as filhas e a nova tentativa, em 375 px e em inglês",
  "app/transition-test/page.tsx":
    "fixture do harness: responde 404 sem E2E_BASE e só existe para atrasar ou quebrar uma navegação de propósito",
  "app/recruiter/page.tsx":
    "só abre com papel de recrutador; ui.mjs a exercita por papel (ROLE_SCENARIOS), mas as varreduras rodam como dono",
  "app/recruiter/[candidateId]/page.tsx":
    "exige vínculo recrutador↔candidato; ui.mjs confere a negação por sonda (1, 999999, abc), sem varredura de idioma, largura ou axe",
  "app/p/[slug]/page.tsx":
    "pública e dependente de consentimento; ui.mjs confere privacidade, 404 canônico e limite de taxa, mas o texto é quase todo dado do usuário",
};
