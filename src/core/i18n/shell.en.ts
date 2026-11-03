import type { shellPtBR } from "./shell.pt-BR.ts";
import type { Translated } from "./shape.ts";

/**
 * Application shell: splash, screen transitions, operation feedback, route status, changelog link, navigation, theme and shared labels.
 *
 * Part of the `en.ts` dictionary; typed against `shell.pt-BR.ts`, so a missing key is a
 * compile error.
 */
export const shellEn: Translated<typeof shellPtBR> = {
  /** Splash and footer. See `src/core/pwa/splash.ts`. */
  splash: {
    loading: "Loading Master Jobs",
  },
  transition: {
    loading: "Loading the next screen",
    updating: "Updating this screen",
    prolonged: "Still loading. This is taking longer than usual.",
    offlineTitle: "You're offline",
    offlineBody: "We couldn't load this screen. Check your connection and try again.",
    retry: "Try again",
    failedTitle: "We couldn't open this screen",
    failedBody: "Navigation failed. Try again.",
  },
  feedback: {
    success: "Operation completed successfully.",
    error: "The operation could not be completed. Try again.",
    dismiss: "Dismiss notification",
  },
  routeStatus: {
    forbiddenTitle: "Access denied",
    forbiddenBody: "You don't have permission to open this screen.",
    notFoundTitle: "Page not found",
    notFoundBody: "This address doesn't exist or is no longer available.",
    back: "Back to start",
  },
  changelog: {
    link: "What's new",
    title: "What's new",
    lead: "What changed in each version.",
    close: "Close",
    internal: "Internal improvements, no visible change.",
  },
  nav: {
    skipToHeader: "Go to header",
    menu: "Menu",
    cockpit: "Cockpit",
    jobs: "Jobs",
    pipeline: "Pipeline",
    referrals: "Referrals",
    candidate: "Candidate",
    compareJob: "Compare job",
    searches: "Searches",
    appearance: "appearance",
    language: "language",
    signIn: "sign in",
    signOut: "sign out",
    unprotected: "unprotected",
    unprotectedTitle:
      "JHO_AUTH_MODE=open — no authentication. CV, pipeline and export are reachable by any request. Remove the variable to require sign-in.",
  },
  theme: {
    title: "theme",
    environment: "environment",
    system: "System",
    light: "Light",
    dark: "Dark",
    appearance: "Appearance",
  },
  themeDescriptions: {
    hp: "Corporate blue, restrained corners",
    huly: "Two accents, pill geometry",
    graphy: "Cobalt, hairline instead of shadow",
  },
  common: {
    loading: "Loading…",
    empty: "Nothing here yet.",
    back: "back",
    close: "Close",
    jobs: "jobs",
  },
};
