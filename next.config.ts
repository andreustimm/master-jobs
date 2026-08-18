import type { NextConfig } from "next";

const config: NextConfig = {
  // The ingest layer talks to public ATS endpoints from the server only.
  serverExternalPackages: ["@libsql/client"],
  experimental: {
    // Next.js 16 Cache Components — dashboard reads are cached per revalidate tag.
    cacheComponents: true,
  },
  typedRoutes: true,
};

export default config;
