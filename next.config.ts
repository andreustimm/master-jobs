import type { NextConfig } from "next";

const config: NextConfig = {
  // libSQL is a native-adjacent client and must not be bundled for the server.
  serverExternalPackages: ["@libsql/client"],

  // Cache Components (Next 16) is deliberately OFF. This dashboard reads a
  // local database whose contents change on every sync, so caching would only
  // add a staleness class of bug for no gain — and it forbids the route
  // segment configs that express "always fresh" in one line.
  typedRoutes: true,

  /**
   * Defence in depth.
   *
   * This dashboard has no authentication of any kind and serves the CV, the
   * salary floor, and every application in the funnel. The real control is
   * binding to 127.0.0.1 (see `dev`/`start` in package.json) — these headers
   * are the second layer, and the one that survives someone deploying this.
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
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self' data:",
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
