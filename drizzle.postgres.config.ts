import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/core/db/schema.ts",
  out: "./drizzle/postgres",
  schemaFilter: ["production"],
  strict: true,
  verbose: true,
  ...(process.env.DATABASE_MIGRATION_URL
    ? { dbCredentials: { url: process.env.DATABASE_MIGRATION_URL } }
    : {}),
});
