import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { schema } from "./schema";

/**
 * Server-side Drizzle client (Neon HTTP driver).
 *
 * Created lazily so importing this module is safe without `DATABASE_URL`
 * (next build, vitest, and the anonymous local-first flow must not need it).
 * Never import this from client components — it is server-only.
 */
export function createDb(connectionString?: string) {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The server DB is optional (signed-out = local mode); " +
        "set DATABASE_URL in .env.local / Vercel env vars to enable accounts."
    );
  }
  return drizzle(neon(url), { schema });
}

export type Db = ReturnType<typeof createDb>;

let cachedUrl: string | undefined;
let cachedDb: Db | undefined;

/** Shared lazy singleton for app code (per-process). */
export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!cachedDb || cachedUrl !== url) {
    cachedDb = createDb(url);
    cachedUrl = url;
  }
  return cachedDb;
}

export { schema };
