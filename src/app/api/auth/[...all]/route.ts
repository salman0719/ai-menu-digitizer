import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";

// Better Auth catch-all: /api/auth/sign-in/magic-link, /api/auth/get-session,
// magic-link verification, sign-out, etc. The auth instance is created lazily
// on first request so builds and DB-less local mode stay unaffected.
export const { GET, POST } = toNextJsHandler((request) => getAuth().handler(request));
