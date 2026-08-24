# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary:** Andreus, a senior software architect who uses the product in short, high-value sessions to decide which jobs deserve his limited application time.
- **Authenticated roles:** candidates manage their own job search and profile; recruiters work only with candidates who linked them; administrators manage accounts and may impersonate a user through an audited session.
- **Public visitors:** people who open an explicitly published candidate profile or authentication flow without an existing session.

## Product Purpose

Master Jobs turns a large, uneven corpus of job openings into an auditable shortlist, then supports comparison, application preparation, and pipeline tracking. The product succeeds when a user can understand why a job deserves attention and continue the workflow without reconstructing the decision criteria manually.

## Positioning

The product ranks feasibility and fit through an explainable weighted rubric rather than generic semantic similarity. It treats eligibility constraints as first-class, preserves missing information as neutral, and never automates irreversible application submission.

## Operating Context

The product is a responsive web application and installable PWA used on desktop and mobile, often during short evening sessions. It supports Portuguese and English, light and dark environments, three themes, authenticated role-specific navigation, public profile links, and an offline-safe shell. The CLI and dashboard share the same domain behavior.

## Capabilities and Constraints

- Internal navigation spans global menus, contextual links and cards, URL-backed views, form redirects, and browser history.
- Authentication is required by default; `/p/[slug]` is the only public data route and exposes only an explicit allowlist.
- The service worker may cache static shell resources and dedicated login/offline surfaces, but must not cache authenticated pages, APIs, public profiles, or private user data.
- Ingestion never mutates application decisions, jobs that disappear are closed rather than deleted, and no capability submits an application for the user.
- Interface copy comes from the typed `pt-BR` and `en` dictionaries.

## Brand Commitments

The product name is **Master Jobs**. Its interface voice is direct, precise, and operational: it explains why, avoids invented certainty, and makes irreversible or security-sensitive states explicit. Existing visual identity and tokens are defined by `DESIGN.md` and must be preserved when extending the interface.

## Evidence on Hand

- Product vision and boundaries: `docs/product/vision.md`
- Confirmed personas and operating context: `docs/product/personas.md`
- Canonical product stories: `docs/product/user-stories.md`
- Visual system: `DESIGN.md` and `app/design-tokens.css`
- Existing startup splash behavior: `src/core/pwa/splash.ts`
- Existing security and offline policy: `AGENTS.md`, `docs/security.md`, and `scripts/sw-template.js`

No testimonials, external customer claims, or usage benchmarks beyond repository-owned product data should be fabricated.

## Product Principles

1. Help the user decide where to spend time rather than merely increasing the amount of data shown.
2. Explain every important decision and state in language a user can verify.
3. Missing or uncertain evidence stays neutral; the product never invents certainty.
4. Security and privacy are safe by default, including when the device is offline or lost.
5. Every core workflow remains usable and coherent on desktop and mobile.

## Accessibility & Inclusion

All interactive experiences must support keyboard navigation, browser zoom, 44×44 px touch targets where applicable, screen-reader status announcements, sufficient contrast in every theme/environment, and `prefers-reduced-motion`. Responsive behavior is verified at 375 px and representative desktop widths.
