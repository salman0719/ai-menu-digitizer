import { NextResponse } from "next/server";

import { applyProposalOperations, ProposalApplyError } from "@/features/assistant/apply";
import {
  readAssistantAllowance,
  recordAssistantUsage,
  type AssistantAllowance,
} from "@/features/assistant/repo";
import {
  assistantRequestSchema,
  type AssistantErrorCode,
  type AssistantUsageSummary,
} from "@/features/assistant/schema";
import type { AssistantProposal } from "@/features/assistant/proposal";
import {
  getMenuWithRoleForUser,
  listMenusForUser,
  MenuRepoError,
  type ServerMenu,
} from "@/features/menus/repo";
import { listRestaurantsForUser, type TenancyDb } from "@/features/tenancy/repo";
import type { RestaurantRole } from "@/lib/db/schema";
import {
  AssistantProviderError,
  completeAssistantChat,
  readAssistantProviderConfig,
} from "@/lib/ai/assistant/worker-ai";
import {
  buildAssistantMessages,
  buildAssistantSystemPrompt,
  type AssistantContextRestaurant,
} from "@/lib/ai/assistant/prompt";
import { requestAssistantProposal } from "@/lib/ai/assistant/propose";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { reportError } from "@/lib/observability/alerts";
import { logEvent, requestIdFrom } from "@/lib/observability/log";

/**
 * POST /api/assistant — one chat turn, signed-in only (A1 + A2).
 *
 * Without `menuId` this is the help surface: a plain answer from the
 * capability card. With the id of a menu the caller owns, the model may
 * return a proposal (validated, dry-run, and diffed here) that the browser can
 * approve through `POST /api/assistant/apply`. Staff get the help surface
 * only, and a menu id from another tenant is a 404, never a hint that it
 * exists.
 *
 * Nothing in this route writes a menu. The dry run applies operations to an
 * in-memory clone purely to prove they are valid and to compute the preview
 * the owner will approve; the approval endpoint is the only write path.
 *
 * Guard order matters: same-origin, then the session, then the request body,
 * then the cost brakes, then the provider. A cap hit must never spend a
 * neuron, and a provider failure must never leak its body to the browser.
 *
 * GET /api/assistant — this account's allowance for the current UTC month,
 * so the panel can show what is left before the first question is sent.
 */

const PUBLIC_MESSAGES = {
  unauthorized: "Sign in to use the assistant.",
  not_configured: "The assistant is not configured on this deployment yet.",
  db_unavailable: "Server data is not available right now. Try again in a moment.",
  invalid_request: "Send a message between 1 and 1,000 characters.",
  unavailable: "The assistant is unavailable right now. Try again in a moment.",
  busy: "The assistant is busy right now. Try again in a minute.",
  menu_not_found: "That menu does not exist.",
} as const;

function errorResponse(code: AssistantErrorCode, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Session lookup that separates "signed out" from "database is down". */
async function sessionUser(): Promise<
  { userId: string | null; dbUnavailable: false } | { userId: null; dbUnavailable: true }
> {
  try {
    return { userId: await getSessionUserId(), dbUnavailable: false };
  } catch {
    return { userId: null, dbUnavailable: true };
  }
}

/** The account block the assistant may see: the caller's own restaurants only. */
async function buildContext(db: TenancyDb, userId: string): Promise<AssistantContextRestaurant[]> {
  const [restaurants, menus] = await Promise.all([
    listRestaurantsForUser(db, userId),
    listMenusForUser(db, userId),
  ]);
  return restaurants.map((restaurant) => ({
    name: restaurant.name,
    role: restaurant.role,
    menus: menus
      .filter((menu) => menu.restaurantId === restaurant.id)
      .map((menu) => ({ title: menu.title })),
  }));
}

function usageEnvelope(summary: AssistantUsageSummary, used: number): AssistantUsageSummary {
  return {
    ...summary,
    used,
    remaining: Math.max(0, summary.cap - used),
  };
}

/** Best-effort ledger write: bookkeeping must not fail an answered request. */
async function record(
  db: TenancyDb,
  input: Parameters<typeof recordAssistantUsage>[1]
): Promise<void> {
  try {
    await recordAssistantUsage(db, input);
  } catch (error) {
    logEvent("warn", "assistant.usage_not_recorded", {
      requestId: input.requestId,
      error,
    });
  }
}

/**
 * A proposal can be schema-valid and still reference something that is not on
 * this menu (the A0 spike caught the model inventing a category id). That is
 * a clarifying question, not an error page — nothing has been written.
 */
function clarifyFromApplyError(error: unknown): string {
  if (!(error instanceof ProposalApplyError)) {
    return "I couldn't apply that change safely. Try rephrasing it.";
  }
  switch (error.code) {
    case "missing_price":
      return error.message;
    case "unknown_item":
      return "I couldn't match that to an item on this menu. Which item did you mean?";
    case "unknown_category":
      return "I couldn't match that to a category on this menu. Which category should it go in?";
    case "duplicate_category":
    case "invalid_move":
      return error.message;
    case "no_operations":
      return "What exactly would you like to change?";
    default:
      return "I couldn't apply that change safely. Try rephrasing it.";
  }
}

async function loadMenu(
  db: TenancyDb,
  userId: string,
  menuId: string,
  requestId: string
): Promise<{ menu: ServerMenu; role: RestaurantRole } | NextResponse> {
  try {
    return await getMenuWithRoleForUser(db, userId, menuId);
  } catch (error) {
    if (error instanceof MenuRepoError && error.code === "not_found") {
      return errorResponse("not_found", PUBLIC_MESSAGES.menu_not_found, 404);
    }
    await reportError("assistant.menu_failed", error, { requestId, userId });
    return errorResponse("server_db_unavailable", PUBLIC_MESSAGES.db_unavailable, 503);
  }
}

export async function GET(): Promise<NextResponse> {
  const session = await sessionUser();
  if (session.dbUnavailable) {
    return errorResponse("server_db_unavailable", PUBLIC_MESSAGES.db_unavailable, 503);
  }
  if (!session.userId) {
    return errorResponse("unauthorized", PUBLIC_MESSAGES.unauthorized, 401);
  }

  try {
    const allowance = await readAssistantAllowance(getDb(), session.userId);
    return noStore(NextResponse.json({ usage: allowance.summary }));
  } catch (error) {
    await reportError("assistant.usage_failed", error);
    return errorResponse("server_db_unavailable", PUBLIC_MESSAGES.db_unavailable, 503);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const requestId = requestIdFrom(request);
  const session = await sessionUser();
  if (session.dbUnavailable) {
    return errorResponse("server_db_unavailable", PUBLIC_MESSAGES.db_unavailable, 503);
  }
  if (!session.userId) {
    return errorResponse("unauthorized", PUBLIC_MESSAGES.unauthorized, 401);
  }
  const userId = session.userId;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("invalid_request", PUBLIC_MESSAGES.invalid_request, 400);
  }
  const parsed = assistantRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(
      "invalid_request",
      parsed.error.issues[0]?.message ?? PUBLIC_MESSAGES.invalid_request,
      400
    );
  }

  if (!readAssistantProviderConfig()) {
    logEvent("warn", "assistant.not_configured", { requestId, userId });
    return errorResponse("assistant_not_configured", PUBLIC_MESSAGES.not_configured, 503);
  }

  const db = getDb();
  let allowance: AssistantAllowance;
  try {
    allowance = await readAssistantAllowance(db, userId);
  } catch (error) {
    await reportError("assistant.allowance_failed", error, { requestId });
    return errorResponse("server_db_unavailable", PUBLIC_MESSAGES.db_unavailable, 503);
  }

  if (allowance.monthlyUsed >= allowance.monthlyCap) {
    logEvent("warn", "assistant.cap_reached", {
      requestId,
      userId,
      used: allowance.monthlyUsed,
      cap: allowance.monthlyCap,
    });
    return errorResponse(
      "assistant_cap_reached",
      `This account has used all ${allowance.monthlyCap} assistant messages for this month. The allowance resets on ${allowance.summary.periodEnd.slice(0, 10)}.`,
      429
    );
  }
  if (allowance.dailyCalls >= allowance.dailyCeiling) {
    logEvent("warn", "assistant.daily_ceiling_reached", {
      requestId,
      calls: allowance.dailyCalls,
      ceiling: allowance.dailyCeiling,
    });
    return errorResponse(
      "assistant_budget_exhausted",
      "The assistant has reached its shared daily limit. Try again after 00:00 UTC.",
      429
    );
  }

  let targetMenu: ServerMenu | null = null;
  if (parsed.data.menuId) {
    const loaded = await loadMenu(db, userId, parsed.data.menuId, requestId);
    if (loaded instanceof NextResponse) return loaded;
    // Staff are read-only for menus by design, so they only get the help
    // surface even when the browser sends a menu id.
    targetMenu = loaded.role === "owner" ? loaded.menu : null;
  }

  let restaurants: AssistantContextRestaurant[];
  try {
    restaurants = await buildContext(db, userId);
  } catch (error) {
    await reportError("assistant.context_failed", error, { requestId, userId });
    return errorResponse("server_db_unavailable", PUBLIC_MESSAGES.db_unavailable, 503);
  }

  const messages = buildAssistantMessages({
    system: buildAssistantSystemPrompt(restaurants, targetMenu?.doc),
    history: parsed.data.history,
    message: parsed.data.message,
  });

  try {
    if (targetMenu) {
      const menu = targetMenu;
      const result = await requestAssistantProposal({ messages });
      const usage = usageEnvelope(allowance.summary, allowance.monthlyUsed + 1);

      let outcome = result.args.outcome;
      let reply = result.args.message;
      let proposal: AssistantProposal | null = null;

      if (outcome === "propose") {
        try {
          const applied = applyProposalOperations(menu.doc, result.args.operations);
          proposal = {
            menuId: menu.id,
            outcome: "propose",
            operations: applied.operations,
            preview: applied.preview,
            basedOnUpdatedAt: menu.updatedAt,
          };
        } catch (error) {
          const reason = error instanceof ProposalApplyError ? error.code : "unexpected";
          logEvent("warn", "assistant.proposal_rejected", {
            requestId,
            userId,
            menuId: menu.id,
            reason,
          });
          outcome = "clarify";
          reply = clarifyFromApplyError(error);
        }
      }

      if (result.invalid) {
        logEvent("warn", "assistant.proposal_invalid", {
          requestId,
          userId,
          menuId: menu.id,
          repaired: result.repaired,
        });
      }

      await record(db, {
        userId,
        requestId,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        neurons: result.usage.neurons,
        latencyMs: result.latencyMs,
        status: result.invalid ? "failed" : "succeeded",
        errorCode: result.invalid ? "invalid_proposal" : null,
      });
      logEvent("info", "assistant.proposal", {
        requestId,
        userId,
        menuId: menu.id,
        outcome,
        operations: proposal?.operations.length ?? 0,
        repaired: result.repaired,
      });

      const body: {
        outcome: typeof outcome;
        reply: string;
        usage: AssistantUsageSummary;
        proposal?: AssistantProposal;
      } = { outcome, reply, usage };
      if (proposal) body.proposal = proposal;
      return noStore(NextResponse.json(body));
    }

    const completion = await completeAssistantChat({ messages });
    await record(db, {
      userId,
      requestId,
      model: completion.model,
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
      neurons: completion.usage.neurons,
      latencyMs: completion.latencyMs,
      status: "succeeded",
    });
    logEvent("info", "assistant.reply", {
      requestId,
      userId,
      model: completion.model,
      latencyMs: completion.latencyMs,
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
      neurons: completion.usage.neurons,
    });
    return noStore(
      NextResponse.json({
        reply: completion.text,
        usage: usageEnvelope(allowance.summary, allowance.monthlyUsed + 1),
      })
    );
  } catch (error) {
    const providerCode = error instanceof AssistantProviderError ? error.code : "unexpected";
    await record(db, {
      userId,
      requestId,
      model: readAssistantProviderConfig()?.model ?? "unknown",
      inputTokens: null,
      outputTokens: null,
      neurons: null,
      latencyMs: null,
      status: "failed",
      errorCode: providerCode,
    });
    logEvent("warn", "assistant.failed", {
      requestId,
      userId,
      code: providerCode,
      status: error instanceof AssistantProviderError ? error.status : null,
    });
    await reportError("assistant.failed", error, { requestId, userId, code: providerCode });

    return errorResponse(
      "assistant_unavailable",
      providerCode === "rate_limited" ? PUBLIC_MESSAGES.busy : PUBLIC_MESSAGES.unavailable,
      503
    );
  }
}
