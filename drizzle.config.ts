import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated offline (`npm run db:generate`) and applied
 * explicitly (`npm run db:migrate`) — never at request time
 * (PHASE-2.md §3.3). The placeholder URL only exists so `generate` parses;
 * `migrate` requires a real `DATABASE_URL` from the environment.
 */
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://127.0.0.1:5432/postgres",
  },
});
