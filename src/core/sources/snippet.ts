/**
 * Assisted extraction from a logged-in job platform (F-04).
 *
 * Revelo and BairesDev publish only inside an authenticated area. Revelo's API
 * answers 401 and uses Keycloak SSO with an in-memory token, so there is no
 * reusable credential — and per `docs/sources-autenticadas.md` this project
 * does not drive someone's authenticated session anyway. The absence of a
 * clause forbidding automation is not permission (same rigour as ADR 0001).
 *
 * What is left is the honest half: the user is already logged in and looking at
 * the list. This produces a snippet they paste into their own browser console,
 * which reads the page they are already looking at and emits JSON that
 * `jho jobs import` accepts.
 *
 * The extractor is intentionally generic — heuristics over the DOM rather than
 * per-site selectors. A selector for a page this project cannot open would be
 * a guess presented as knowledge, and it would rot on the platform's next
 * deploy without anyone noticing.
 */

export type SnippetOptions = {
  /** Substring a link's href must contain to count as a posting. */
  match?: string;
  label?: string;
};

const KNOWN: Record<string, { match: string; label: string; note: string }> = {
  revelo: {
    match: "/positions/",
    label: "Revelo",
    note: "Abra a lista de vagas internacionais e role até o fim antes de rodar.",
  },
  bairesdev: {
    match: "/job",
    label: "BairesDev",
    note: "Abra a listagem de oportunidades e role até o fim antes de rodar.",
  },
  generic: {
    match: "job",
    label: "Plataforma",
    note: "Ajuste MATCH abaixo se os links da sua página usarem outro caminho.",
  },
};

export function knownPlatforms(): string[] {
  return Object.keys(KNOWN);
}

export function buildSnippet(platform: string, opts: SnippetOptions = {}): string {
  const preset = KNOWN[platform] ?? KNOWN.generic!;
  const match = opts.match ?? preset.match;
  const label = opts.label ?? preset.label;

  // Written as a paste-ready IIFE. It only reads the DOM and writes to the
  // clipboard: no network call, nothing sent anywhere.
  return `(() => {
  const MATCH = ${JSON.stringify(match)};

  // A posting is a link whose href looks like one and which carries readable
  // text. Anchors are used rather than card containers because every platform
  // renders a card differently, but they all link somewhere.
  const links = [...document.querySelectorAll("a[href]")].filter((a) => {
    const href = a.getAttribute("href") || "";
    return href.includes(MATCH) && (a.textContent || "").trim().length > 8;
  });

  const seen = new Set();
  const jobs = [];

  for (const a of links) {
    const url = new URL(a.getAttribute("href"), location.origin).toString();
    if (seen.has(url)) continue;
    seen.add(url);

    // Walk up to the smallest ancestor that holds noticeably more text than
    // the link itself — that is the card, whatever it is called on this site.
    let card = a;
    for (let i = 0; i < 5 && card.parentElement; i++) {
      card = card.parentElement;
      if ((card.innerText || "").trim().length > (a.textContent || "").trim().length + 40) break;
    }

    const lines = (card.innerText || "")
      .split("\\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const title = (a.textContent || "").trim();
    // Everything on the card that is not the title, kept as description so the
    // scorer has text to read. Guessing which line is the company would be
    // wrong more often than useful.
    const rest = lines.filter((l) => l !== title);

    jobs.push({
      title,
      url,
      company: ${JSON.stringify(label)},
      location: rest.find((l) => /remote|remoto|brasil|brazil|latam|hybrid/i.test(l)) || null,
      description: rest.join("\\n") || null,
    });
  }

  const json = JSON.stringify(jobs, null, 2);
  console.log(json);
  if (navigator.clipboard) {
    navigator.clipboard.writeText(json).then(
      () => console.log("%c" + jobs.length + " vaga(s) copiada(s).", "color:#0e7c63"),
      () => console.log("Copie o JSON acima manualmente."),
    );
  }
  return jobs.length + " vaga(s). Cole em um arquivo .json e rode: jho jobs import <arquivo> --source ${platform}";
})();`;
}

export function snippetNote(platform: string): string {
  return (KNOWN[platform] ?? KNOWN.generic!).note;
}
