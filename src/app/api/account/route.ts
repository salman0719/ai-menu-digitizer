import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteAccountForUser } from "@/features/retention/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { logInfo } from "@/lib/observability/log";
import { reportError } from "@/lib/observability/alerts";

/**
 * DELETE /api/account — delete the signed-in account.
 *
 * The body must repeat an exact phrase, so a stray fetch or a mis-wired
 * button cannot delete a café. The user row goes first and Postgres cascades
 * remove the restaurants they created (menus, revisions, publications,
 * orders); restaurants they merely work at keep running. Clients must sign
 * out afterwards — the session row is gone with the user.
 */

const bodySchema = z.object({
  confirm: z.literal("delete my account"),
});

export async function DELETE(request: Request): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  let userId: string | null;
  try {
    userId = await getSessionUserId();
  } catch {
    return NextResponse.json(
      { error: { code: "server_db_unavailable", message: "Account deletion is not available yet." } },
      { status: 503 }
    );
  }
  if (!userId) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to delete your account." } },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "Expected a JSON body." } },
      { status: 400 }
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "confirmation_required",
          message: 'Send { "confirm": "delete my account" } to confirm.',
        },
      },
      { status: 400 }
    );
  }

  try {
    const result = await deleteAccountForUser(getDb(), userId);
    logInfo("account.deleted", { userId, restaurants: result.restaurants });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await reportError("account.delete_failed", error, { userId });
    return NextResponse.json(
      { error: { code: "delete_failed", message: "Could not delete the account. Try again." } },
      { status: 503 }
    );
  }
}
