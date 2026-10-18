import { headers } from "next/headers";

import { getAuth } from "./index";

/** The signed-in session (owner/staff), or null for anonymous visitors. */
export async function getSession() {
  return getAuth().api.getSession({ headers: await headers() });
}

export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/**
 * Server guard for API routes: returns the authenticated user or null.
 * Callers must respond 401 themselves so each route owns its error shape.
 */
export async function getSessionUserId(): Promise<string | null> {
  const session = await getSession();
  return session?.user.id ?? null;
}
