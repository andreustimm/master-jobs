"use client";

import Link, { type LinkProps } from "next/link";
import type { UrlObject } from "node:url";
import type { AnchorHTMLAttributes } from "react";
import { shouldStartFromLinkEvent } from "../src/core/pwa/transition.ts";
import { transitionStore } from "../src/core/pwa/transition-store.ts";

function queryValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && !Number.isNaN(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}

function queryString(query: Exclude<NonNullable<UrlObject["query"]>, string>): string {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      params.append(key, queryValue(value));
    }
  }
  return params.toString();
}

const SLASHED_PROTOCOL = /https?|ftp|gopher|file/;

// Keep this field-for-field compatible with Next's installed format-url helper:
// the fallback and authoritative router signal must normalize to one target.
function formatHrefObject(href: UrlObject): string {
  let protocol = href.protocol ?? "";
  let pathname = href.pathname ?? "";
  let hash = href.hash ?? "";
  const query = typeof href.query === "object" && href.query !== null
    ? queryString(href.query)
    : href.query ?? "";
  const auth = href.auth
    ? `${encodeURIComponent(href.auth).replace(/%3A/i, ":")}@`
    : "";
  let host: string | false = false;

  if (href.host) {
    host = `${auth}${href.host}`;
  } else if (href.hostname) {
    const hostname = href.hostname.includes(":") ? `[${href.hostname}]` : href.hostname;
    host = `${auth}${hostname}${href.port ? `:${href.port}` : ""}`;
  }

  let search = href.search || (query ? `?${query}` : "");
  if (protocol && !protocol.endsWith(":")) protocol += ":";
  if (href.slashes || ((!protocol || SLASHED_PROTOCOL.test(protocol)) && host !== false)) {
    host = `//${host || ""}`;
    if (pathname && !pathname.startsWith("/")) pathname = `/${pathname}`;
  } else if (!host) {
    host = "";
  }
  if (hash && !hash.startsWith("#")) hash = `#${hash}`;
  if (search && !search.startsWith("?")) search = `?${search}`;
  pathname = pathname.replace(/[?#]/g, encodeURIComponent);
  search = search.replace("#", "%23");
  return `${protocol}${host}${pathname}${search}${hash}`;
}

function navigationCandidate(href: string | UrlObject): string {
  if (typeof href === "string") return href;
  return formatHrefObject(href);
}

export type TransitionLinkProps<RouteType> =
  & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps<RouteType>>
  & LinkProps<RouteType>;

/** Stable first-party Link boundary; the router hook remains authoritative. */
export function TransitionLink<RouteType>({
  href,
  as: asProp,
  onNavigate,
  download,
  target,
  ...props
}: TransitionLinkProps<RouteType>) {
  return (
    <Link
      {...props}
      href={href}
      as={asProp}
      download={download}
      target={target}
      onNavigate={(event) => {
        let prevented = false;
        onNavigate?.({
          preventDefault() {
            prevented = true;
            event.preventDefault();
          },
        });

        const candidate = navigationCandidate(asProp || href);
        if (
          prevented ||
          typeof window === "undefined" ||
          !shouldStartFromLinkEvent(
            { defaultPrevented: false },
            candidate,
            window.location.href,
            { download, target },
          )
        ) {
          return;
        }
        transitionStore.begin(candidate);
      }}
    />
  );
}
