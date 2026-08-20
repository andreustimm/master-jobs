import type { NextConfig } from "next";

const config: NextConfig = {
  /**
   * Pin the workspace root.
   *
   * There is a stray `package-lock.json` in the home directory, above this
   * repository. Turbopack walks upward looking for a lockfile to infer the
   * root, finds that one, and warns that it is outside the Git repository —
   * with an inferred root that is wrong. Saying it explicitly ends the guess.
   */
  turbopack: {
    root: import.meta.dirname,
  },

  // Both are server-only dependencies whose runtime resolution is intentional:
  // libSQL is native-adjacent, while unpdf uses `import.meta.resolve` to locate
  // its bundled PDF.js assets. Webpack cannot preserve that lookup when inlined.
  serverExternalPackages: ["@libsql/client", "unpdf"],

  // Both candidate CVs and manual job descriptions accept files up to 10 MB.
  // Server Actions default to 1 MB and count multipart framing too, so leave a
  // small envelope above the application-level limit enforced by each action.
  experimental: {
    // Authorization helpers map a valid-but-forbidden session to an actual
    // HTTP 403 instead of leaking data or failing as a generic server error.
    authInterrupts: true,
    serverActions: {
      bodySizeLimit: "11mb",
    },
  },

  // Cache Components (Next 16) is deliberately OFF. This dashboard reads a
  // local database whose contents change on every sync, so caching would only
  // add a staleness class of bug for no gain — and it forbids the route
  // segment configs that express "always fresh" in one line.
  typedRoutes: true,

  /**
   * Defence in depth.
   *
   * Authentication is required by default, and the dashboard also stays bound
   * to 127.0.0.1 (see `dev`/`start` in package.json). These headers are another
   * independent layer, including for the explicitly requested open mode.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Nothing here is ever meant to be embedded by another site.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // A job URL must not leak the rest of the path to the employer.
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // Nothing loads from a third party, so say so. `form-action 'self'`
          // is what stops an injected form from posting the CV elsewhere.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next's runtime needs inline/eval in development.
              process.env.NODE_ENV === "production"
                ? "script-src 'self' 'unsafe-inline'"
                : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              // Google Fonts serve a folha em googleapis e os arquivos em
              // gstatic. Sem estas duas origens a CSP bloqueia a fonte do
              // DESIGN.md e a página cai no fallback do sistema — foi o que
              // aconteceu, silenciosamente, até um browser de verdade
              // reportar o bloqueio no console.
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data:",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default config;
