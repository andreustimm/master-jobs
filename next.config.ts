import type { NextConfig } from "next";

const config: NextConfig = {
  // libSQL is a native-adjacent client and must not be bundled for the server.
  serverExternalPackages: ["@libsql/client"],

  // Cache Components (Next 16) is deliberately OFF. This dashboard reads a
  // local database whose contents change on every sync, so caching would only
  // add a staleness class of bug for no gain — and it forbids the route
  // segment configs that express "always fresh" in one line.
  typedRoutes: true,
};

export default config;
