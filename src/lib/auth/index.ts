import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";

import { getDb } from "@/lib/db";
import { schema } from "@/lib/db/schema";

import { sendMagicLinkEmail } from "./email";

/** Magic links are single-use and expire fast (PHASE-2.md §3.6). */
const MAGIC_LINK_EXPIRES_IN_SECONDS = 5 * 60;
/** Café owner laptops / staff-board devices should stay signed in (§3.6). */
const SESSION_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
/** Rolling refresh: the 30-day window slides forward on daily use. */
const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

type SendMagicLink = NonNullable<Parameters<typeof magicLink>[0]>["sendMagicLink"];

export interface CreateAuthOptions {
  /** Drizzle instance (Neon HTTP in the app, PGlite in tests). */
  db: Parameters<typeof drizzleAdapter>[0];
  /** Override link delivery (tests capture links instead of sending). */
  sendMagicLink?: SendMagicLink;
  baseURL?: string;
  secret?: string;
}

/**
 * Better Auth instance factory. Magic link is the only human sign-in:
 * rising and signing in are the same one-time-link flow; diners and public
 * menu visitors never authenticate (PHASE-2.md §3.6). Bearer API keys for
 * the (parked) B2B API are a separate plugin, deliberately not configured
 * here yet.
 */
export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    baseURL: options.baseURL ?? process.env.BETTER_AUTH_URL,
    secret: options.secret ?? process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(options.db, {
      provider: "pg",
      schema,
    }),
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    plugins: [
      magicLink({
        sendMagicLink: options.sendMagicLink ?? sendMagicLinkEmail,
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
      }),
      // Must stay last: re-applies Set-Cookie headers in the Next.js handler.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let cached: Auth | undefined;

/**
 * Lazy singleton for app code. Creating it needs DATABASE_URL, so it must
 * only be called inside request handlers — never at module import time
 * (keeps `next build` and signed-out local mode DB-free).
 */
export function getAuth(): Auth {
  if (!cached) {
    cached = createAuth({ db: getDb() });
  }
  return cached;
}
