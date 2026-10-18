import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser auth client for Better Auth (magic link sign-in + session state).
 * Talks to /api/auth on the current origin; safe in client components.
 */
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});
