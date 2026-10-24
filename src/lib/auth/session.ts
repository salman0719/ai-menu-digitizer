import { headers } from "next/headers";

import { getAuth } from "./index";

/** The signed-in session (owner/staff), or null for anonymous visitors. */
export async function getSession() {
  return getAuth().api.getSession({ headers: await headers() });
}

export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** The signed-in account, as feature access and audit code need it. */
export type SessionUser = {
  id: string;
  email: string;
};

/** The signed-in account, or null for anonymous visitors. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email };
}

/**
 * Server guard for API routes: returns the authenticated user or null.
 * Callers must respond 401 themselves so each route owns its error shape.
 */
export async function getSessionUserId(): Promise<string | null> {
  return (await getSessionUser())?.id ?? null;
}
