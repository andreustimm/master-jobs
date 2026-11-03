import { createElement, type HTMLAttributes } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { readLegal, type LegalKind } from "../src/core/legal.ts";
import { formatDate } from "../src/core/i18n/index.ts";
import { getTranslator } from "./i18n";
import { TransitionLink } from "./transition-link";

/**
 * Os Termos de Uso e a Política de Privacidade (#464, US-021, ADR-012).
 *
 * Públicos: quem decide se aceita ainda não tem conta. O texto é o Markdown
 * versionado de `content/legal/`, no idioma da tela; a versão mostrada é a que
 * o cadastro grava na conta.
 *
 * Renderizado como nós React, nunca HTML injetado: `skipHtml` descarta HTML
 * cru, só a lista de elementos de texto passa, e link só sai para http(s) ou
 * `mailto:` (o contato do documento).
 */

const ALLOWED_ELEMENTS = ["a", "blockquote", "em", "h1", "h2", "h3", "h4", "hr", "li", "ol", "p", "strong", "ul"];

function safeUrl(value: string): string {
  const destination = value.trim();
  if (destination.startsWith("/") && !destination.startsWith("//")) return destination;
  try {
    const url = new URL(destination);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? destination : "";
  } catch {
    return "";
  }
}

function styled(tag: string, className: string) {
  return ({ node: _node, ...props }: HTMLAttributes<HTMLElement> & ExtraProps) => createElement(tag, { ...props, className });
}

const components: Components = {
  a({ node: _node, href, children, ...props }) {
    if (!href) return createElement("span", { className: "break-words" }, children);
    return createElement("a", { ...props, href, className: "break-words text-[var(--primary-text)] underline underline-offset-2" }, children);
  },
  blockquote: styled("blockquote", "type-body-md border-l-2 border-[var(--hairline)] pl-4 text-muted-foreground"),
  // O título da página é o do front matter; título dentro do texto desce um nível.
  h1: styled("h2", "type-display-xs break-words"),
  h2: styled("h2", "type-display-xs break-words"),
  h3: styled("h3", "type-body-lg break-words font-medium"),
  h4: styled("h4", "type-body-md break-words font-semibold"),
  hr: styled("hr", "border-[var(--hairline)]"),
  li: styled("li", "type-body-md break-words pl-1"),
  ol: styled("ol", "grid list-decimal gap-2 pl-5"),
  p: styled("p", "type-body-md break-words"),
  strong: styled("strong", "font-semibold"),
  ul: styled("ul", "grid list-disc gap-2 pl-5"),
};

export async function LegalDocumentPage({ kind }: { kind: LegalKind }) {
  const { t, locale } = await getTranslator();
  const document = readLegal(kind, locale);

  return (
    <main className="py-10" data-testid={`route-${kind}`}>
      <article className="mx-auto grid max-w-[72ch] min-w-0 gap-4">
        <h1 className="type-display-md chevron break-words" data-testid="legal-title">
          {document.title}
        </h1>
        <p className="type-body-sm text-muted-foreground" data-testid="legal-version">
          {t("legal.version", { version: formatDate(`${document.version}T12:00:00Z`, locale) })}
        </p>
        {/* O corpo é documento, não interface: declara o próprio idioma, como
            faz qualquer texto citado. A varredura de idioma confere o que é
            dicionário (título, versão, navegação) e respeita o `lang`. */}
        <div lang={document.locale} className="grid min-w-0 gap-4" data-testid="legal-body">
          <ReactMarkdown allowedElements={ALLOWED_ELEMENTS} components={components} skipHtml urlTransform={safeUrl}>
            {document.body}
          </ReactMarkdown>
        </div>
        <nav className="type-body-sm mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--hairline)] pt-4">
          <TransitionLink href={kind === "terms" ? "/privacy" : "/terms"} className="text-[var(--primary-text)] underline" data-testid="legal-other">
            {kind === "terms" ? t("legal.privacy") : t("legal.terms")}
          </TransitionLink>
          <TransitionLink href="/signup" className="text-[var(--primary-text)] underline" data-testid="legal-signup">
            {t("legal.toSignup")}
          </TransitionLink>
        </nav>
      </article>
    </main>
  );
}
