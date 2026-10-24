import { NextResponse } from "next/server";

import { applyProposalOperations, ProposalApplyError } from "@/features/assistant/apply";
import { applyProposalRequestSchema } from "@/features/assistant/proposal";
import { resolveFeatureContext } from "@/features/flags/server";
import { getMenuWithRoleForUser, MenuRepoError, updateMenuForUser } from "@/features/menus/repo";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { logEvent, requestIdFrom } from "@/lib/observability/log";

/**
 * POST /api/assistant/apply — owner approval of a previewed proposal (A2).
 *
 * The browser sends the operations it was shown, the menu they apply to, and
 * the `updatedAt` the proposal was computed from. The server re-validates
 * every operation, re-checks that every id belongs to this menu, applies the
 * document with `menu-utils`, re-validates the canonical schema, and only
 * then writes through `updateMenuForUser`'s conditional UPDATE.
 *
 * There is no model call and no ledger row here: approval costs nothing. A
 * stale `expectedUpdatedAt` is a 409 with the current revision, exactly like
 * the editor's conflict path, so two tabs converge instead of overwriting.
 *
 * The public page is untouched — it keeps serving its published revision until
 * the owner publishes changes.
 */

const PUBLIC_MESSAGES = {
  unauthorized: "Sign in to continue.",
  forbidden: "Only the restaurant owner can approve menu changes.",
  not_found: "That menu does not exist.",
  invalid_body: "Expected a JSON body with menuId, expectedUpdatedAt and operations.",
  invalid_operations: "That change is not valid for this menu. Nothing was saved.",
  stale: "This menu changed since the proposal was made. Review the change again.",
  db_unavailable: "Server data is not available right now. Try again in a moment.",
  feature_disabled: "Menu changes are not available for this account yet.",
  save_failed: "Could not save the menu. Try again.",
} as const;

function errorResponse(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {}
): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function mapRepoError(error: MenuRepoError): NextResponse {
  switch (error.code) {
    case "stale":
      return errorResponse("stale_menu", PUBLIC_MESSAGES.stale, 409, {
        currentUpdatedAt: error.currentUpdatedAt,
      });
    case "forbidden":
      return errorResponse("forbidden", PUBLIC_MESSAGES.forbidden, 403);
    case "invalid_doc":
      return errorResponse("invalid_body", error.message, 400);
    case "not_found":
    default:
      return errorResponse("not_found", PUBLIC_MESSAGES.not_found, 404);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const requestId = requestIdFrom(request);

  let context: Awaited<ReturnType<typeof resolveFeatureContext>>;
  try {
    context = await resolveFeatureContext(request);
  } catch {
    return errorResponse("server_db_unavailable", PUBLIC_MESSAGES.db_unavailable, 503);
  }
  if (!context) {
    return errorResponse("unauthorized", PUBLIC_MESSAGES.unauthorized, 401);
  }
  if (!context.flags.assistant || !context.flags.assistantProposals) {
    logEvent("info", "assistant.apply_feature_disabled", {
      requestId,
      userId: context.user.id,
    });
    return errorResponse("feature_disabled", PUBLIC_MESSAGES.feature_disabled, 403);
  }
  const userId = context.user.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", PUBLIC_MESSAGES.invalid_body, 400);
  }
  const parsed = applyProposalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "invalid_body",
      parsed.error.issues[0]?.message ?? PUBLIC_MESSAGES.invalid_body,
      400
    );
  }

  const db = getDb();
  const { menuId, expectedUpdatedAt, operations } = parsed.data;

  let loaded: Awaited<ReturnType<typeof getMenuWithRoleForUser>>;
  try {
    loaded = await getMenuWithRoleForUser(db, userId, menuId);
  } catch (error) {
    if (error instanceof MenuRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", PUBLIC_MESSAGES.db_unavailable, 503);
  }

  if (loaded.role !== "owner") {
    logEvent("warn", "assistant.apply_forbidden", { requestId, userId, menuId });
    return errorResponse("forbidden", PUBLIC_MESSAGES.forbidden, 403);
  }
  if (loaded.menu.updatedAt !== expectedUpdatedAt) {
    return errorResponse("stale_menu", PUBLIC_MESSAGES.stale, 409, {
      currentUpdatedAt: loaded.menu.updatedAt,
    });
  }

  let applied: ReturnType<typeof applyProposalOperations>;
  try {
    applied = applyProposalOperations(loaded.menu.doc, operations);
  } catch (error) {
    const reason = error instanceof ProposalApplyError ? error.code : "unexpected";
    logEvent("warn", "assistant.apply_rejected", {
      requestId,
      userId,
      menuId,
      reason,
    });
    return errorResponse("invalid_operations", PUBLIC_MESSAGES.invalid_operations, 400, {
      reason,
    });
  }

  try {
    const menu = await updateMenuForUser(db, userId, menuId, applied.doc, expectedUpdatedAt);
    logEvent("info", "assistant.change_applied", {
      requestId,
      userId,
      menuId,
      operations: applied.operations.length,
    });
    return noStore(NextResponse.json({ menu, preview: applied.preview }));
  } catch (error) {
    if (error instanceof MenuRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", PUBLIC_MESSAGES.save_failed, 503);
  }
}
