import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { createAuth } from "@/lib/auth";
import { account, session, user, verification } from "@/lib/db/schema";
import { createTestDb, type TestDb } from "./helpers/pg-test-db";

/**
 * End-to-end magic-link sign-in against real Better Auth HTTP handlers on
 * an in-process Postgres (migrations included). This proves the whole Step
 * 7 chain — adapter ↔ our Drizzle schema ↔ generated DDL — without any
 * external service: link delivery is captured instead of emailed (the same
 * seam the dev fallback uses when RESEND_API_KEY is absent).
 */
const BASE_URL = "http://localhost:3000/api/auth";

describe("magic-link sign-in", () => {
  let db: TestDb;
  let auth: ReturnType<typeof createAuth>;
  const sentLinks: string[] = [];

  beforeAll(async () => {
    ({ db } = await createTestDb());
    auth = createAuth({
      db,
      baseURL: "http://localhost:3000",
      secret: "test-secret-test-secret-test-secret-1234",
      sendMagicLink: async ({ url }) => {
        sentLinks.push(url);
      },
    });
  }, 30_000);

  it("signs a new email up and in through one link, single-use", async () => {
    // 1. Request the link — user does not exist yet (implicit sign-up).
    const request = await auth.handler(
      new Request(`${BASE_URL}/sign-in/magic-link`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email: "owner@cafe.test", callbackURL: "/" }),
      })
    );
    expect(request.status).toBe(200);
    expect(sentLinks).toHaveLength(1);
    expect(sentLinks[0].startsWith("http://localhost:3000/api/auth/")).toBe(true);
    // The one-time token is parked in the verification table until used.
    expect((await db.select().from(verification)).length).toBeGreaterThanOrEqual(1);

    // 2. "Click" the link through the same handler the route serves.
    const verify = await auth.handler(new Request(sentLinks[0]));
    const cookies = verify.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);

    // 3. The session cookie identifies the user via /get-session.
    const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");
    const sessionRes = await auth.handler(
      new Request(`${BASE_URL}/get-session`, { headers: { cookie: cookieHeader } })
    );
    expect(sessionRes.status).toBe(200);
    const payload = (await sessionRes.json()) as { user?: { email?: string } | null };
    expect(payload.user?.email).toBe("owner@cafe.test");

    // 4. Single-use: replaying the same link mints no fresh session cookie.
    const replay = await auth.handler(new Request(sentLinks[0]));
    expect(replay.headers.getSetCookie().filter((c) => c.includes("token"))).toHaveLength(0);

    // 5. Schema round-trip: exactly one user and one session. Magic link
    // stores no credential, so Better Auth writes no `account` row here
    // (the table exists and is queryable — it is part of the required core
    // schema, and rows appear only for credential/OAuth providers).
    const users = await db.select().from(user).where(eq(user.email, "owner@cafe.test"));
    expect(users).toHaveLength(1);
    const sessions = await db.select().from(session).where(eq(session.userId, users[0].id));
    expect(sessions).toHaveLength(1);
    const accounts = await db.select().from(account).where(eq(account.userId, users[0].id));
    expect(Array.isArray(accounts)).toBe(true);
    // …and consumed on first use: no reusable token remains afterwards.
    const verifications = await db.select().from(verification);
    expect(verifications).toHaveLength(0);
  }, 30_000);

  it("rejects a bogus verification token without minting a session", async () => {
    const fake = await auth.handler(
      new Request(`${BASE_URL}/magic-link/verify?token=bogus-token&callbackURL=/`)
    );
    const sessionCookies = fake.headers
      .getSetCookie()
      .filter((c) => c.toLowerCase().includes("session"));
    expect(sessionCookies).toHaveLength(0);
  }, 30_000);
});
