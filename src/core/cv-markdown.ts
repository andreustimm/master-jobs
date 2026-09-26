/**
 * O currículo importado como TEXTO, lido como Markdown. Função pura: texto
 * entra, texto sai — sem banco, sem rede, sem relógio.
 *
 * O PDF chega como texto corrido (`format: "text"`), e a estrutura que o autor
 * desenhou vira convenção tipográfica: título de seção em caixa alta
 * (`SUMMARY`, `CORE EXPERTISE`) e item com glifo (`●`, `■`, `►`, `✓`). O
 * renderizador só conhece Markdown, então sem esta tradução o currículo inteiro
 * aparecia como um parágrafo só (#315).
 *
 * **Aplicado na leitura, nunca na gravação.** Nada aqui reescreve documento
 * gravado: a heurística pode melhorar, e o texto original é o que a detecção de
 * skills e a análise de lacuna leem. Só os glifos de item entram também na
 * importação (`pdf.ts`), porque aquela limpeza já fazia isso com outros glifos.
 *
 * **Idempotente, e Markdown passa intacto.** O editor grava tudo como `text`,
 * inclusive o que a pessoa escreveu em Markdown — o formato gravado não
 * distingue os dois. Por isso nada aqui depende do formato: o que já é
 * Markdown (título com `#`, item com `-`, bloco de código) não casa com
 * nenhuma regra, e aplicar a função duas vezes dá o mesmo que uma.
 *
 * **Não é filtro de privacidade.** O perfil público continua passando por
 * `publicCvText()`; esta função só muda a forma. Ver `candidate-public.ts`.
 */

/**
 * Glifos de item que um PDF costuma trazer no começo da linha. `·` e os
 * traços ficam de fora daqui: no meio da linha são separador ("Go · Rust"), e
 * no começo a limpeza da importação já os trata.
 */
export const BULLET_GLYPHS = "●•▪◦‣■□►▸▶➢➤✓✔";

const LEADING_BULLET = new RegExp(`^[ \\t]*[${BULLET_GLYPHS}][ \\t]*`, "u");
/**
 * Um segundo item colado na mesma linha: "● Go ● Rust". Só o glifo, sem os
 * espaços em volta: `[ \t]+glifo[ \t]+` volta atrás em cada espaço e fica
 * quadrático numa linha longa de espaços — e esta função roda a cada visita
 * anônima a `/p/[slug]`, sobre texto que a pessoa escreve sem limite de
 * tamanho. Os espaços saem no `trim()` de cada item.
 */
const INLINE_BULLET = new RegExp(`[${BULLET_GLYPHS}]`, "u");

/** Linha que já é estrutura Markdown: nada a inferir nela. */
const MARKDOWN_BLOCK = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||(?:---|\*\*\*|___)\s*$)/u;

/**
 * Título de seção em texto puro: linha curta, toda em maiúsculas, sem
 * algarismos nem pontuação de frase. Os limites existem para que uma sigla
 * solta ("AWS") ou um cargo com data ("CTO 2020") não virem seção — e o
 * dois-pontos final é aceito porque "SUMMARY:" é o mesmo título.
 */
// Sem vírgula: "SÃO PAULO, BRAZIL" no cabeçalho é endereço, não seção.
const CAPS_HEADING = /^[\p{Lu}\p{M}][\p{Lu}\p{M}\s&/'’()-]*:?$/u;
const MAX_HEADING = 48;
const MIN_HEADING_LETTERS = 4;

/**
 * Nomes de seção reconhecidos também fora da caixa alta ("Experience",
 * "Formação:"), quando ocupam a linha inteira. Um nome sozinho numa linha de
 * currículo não é frase.
 */
const KNOWN_HEADING =
  /^(?:resumo(?: profissional)?|sum[áa]rio|summary|professional summary|profile|perfil(?: profissional)?|about(?: me)?|sobre(?: mim)?|objective|objetivo|experi[êe]ncias?(?: profissional| profissionais)?|(?:professional |work )?experience|employment(?: history)?|career(?: history)?|hist[óo]rico profissional|forma[çc][ãa]o(?: acad[êe]mica)?|educa[çc][ãa]o|education|academic background|escolaridade|skills|(?:core |technical )?(?:skills|expertise|competencies)|compet[êe]ncias(?: t[ée]cnicas)?|habilidades|certifica(?:tions|[çc][õo]es)|languages|idiomas|projects|projetos|publications|publica[çc][õo]es|awards|pr[êe]mios)$/iu;

function isHeading(line: string): boolean {
  if (line.length > MAX_HEADING) return false;
  if (KNOWN_HEADING.test(line.replace(/:$/, ""))) return true;
  if (!CAPS_HEADING.test(line)) return false;
  return (line.match(/\p{L}/gu)?.length ?? 0) >= MIN_HEADING_LETTERS;
}

export function cvTextToMarkdown(text: string): string {
  const out: string[] = [];
  let fenced = false;

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("```")) {
      fenced = !fenced;
      out.push(raw);
      continue;
    }
    if (fenced || trimmed === "" || MARKDOWN_BLOCK.test(raw)) {
      out.push(raw);
      continue;
    }

    if (LEADING_BULLET.test(raw)) {
      // Cada glifo seguinte na mesma linha abre outro item: o PDF perdeu a
      // quebra, não a intenção.
      const items = raw.replace(LEADING_BULLET, "").split(INLINE_BULLET);
      for (const item of items) {
        if (item.trim() !== "") out.push(`- ${item.trim()}`);
      }
      continue;
    }

    if (isHeading(trimmed)) {
      out.push(`## ${trimmed.replace(/:$/, "")}`);
      continue;
    }

    out.push(raw);
  }

  return out.join("\n");
}

/** Seções que a fase 2 do perfil público mostra em cartões próprios (#326). */
export type CvSectionKind = "summary" | "experience" | "education";

const SECTION_NAMES: Record<CvSectionKind, RegExp> = {
  summary: /^(?:resumo(?:\s+profissional)?|sum[áa]rio|summary|professional\s+summary|profile|perfil(?:\s+profissional)?|about(?:\s+me)?|sobre(?:\s+mim)?|objective|objetivo)$/iu,
  experience: /^(?:experi[êe]ncias?(?:\s+profissional|\s+profissionais)?|(?:professional\s+|work\s+)?experience|employment(?:\s+history)?|career(?:\s+history)?|hist[óo]rico\s+profissional)$/iu,
  education: /^(?:forma[çc][ãa]o(?:\s+acad[êe]mica)?|educa[çc][ãa]o|education|academic\s+background|escolaridade)$/iu,
};

export type CvSection = { kind: CvSectionKind; title: string; body: string };

/**
 * As seções reconhecidas de um currículo JÁ normalizado — em ordem, cada uma
 * com o corpo até o próximo título de mesmo nível ou acima.
 *
 * Quem chama passa o texto que pode sair: no perfil público, o `cv` de
 * `publicProfile()`, que já passou por `publicCvText()` e só existe com o
 * segundo consentimento (G23). Derivar de outro texto seria publicar pelo
 * lado o que o filtro retirou.
 */
function withoutClosingHashes(title: string): string {
  let end = title.length;
  while (end > 0 && title[end - 1] === "#") end--;
  return title.slice(0, end).trimEnd();
}

export function cvSections(markdown: string): CvSection[] {
  const lines = markdown.split("\n");
  const sections: CvSection[] = [];
  let open: { kind: CvSectionKind; title: string; level: number; body: string[] } | null = null;
  let fenced = false;

  const close = () => {
    if (!open) return;
    const body = open.body.join("\n").trim();
    if (body !== "") sections.push({ kind: open.kind, title: open.title, body });
    open = null;
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) fenced = !fenced;
    // Sem `(.*?)\s*#*\s*$`: com três quantificadores seguidos, uma linha longa
    // de espaços custa tempo cúbico. O fechamento opcional (`## Resumo ##`)
    // sai por `withoutClosingHashes()`, em tempo linear.
    const heading = fenced ? null : /^(#{1,6})\s(.*)$/u.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      if (open && level > open.level) {
        open.body.push(line);
        continue;
      }
      close();
      const title = withoutClosingHashes(heading[2]!.trim());
      const plain = title.replace(/[*_`:]/g, "").trim();
      const kind = (Object.keys(SECTION_NAMES) as CvSectionKind[]).find((k) => SECTION_NAMES[k].test(plain));
      if (kind) open = { kind, title, level, body: [] };
      continue;
    }
    open?.body.push(line);
  }
  close();
  return sections;
}
