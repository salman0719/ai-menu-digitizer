import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { schema } from "@/lib/db/schema";

/**
 * In-process Postgres (PGlite) with the real generated migrations applied.
 * Tests therefore exercise the actual DDL that will run on Neon, with zero
 * external services — the same reason Step 7 picked drizzle-kit generate
 * (offline) over a live DB.
 */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  return { client, db };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];

/** Seed a Better Auth-compatible user row directly (signup path tested separately). */
export async function seedUser(db: TestDb, email: string, name: string): Promise<string> {
  const { user } = await import("@/lib/db/schema");
  const id = crypto.randomUUID();
  await db.insert(user).values({ id, name, email });
  return id;
}
