import { NextResponse } from "next/server";

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
import { listMenusForUser } from "@/features/menus/repo";
import { listRestaurantsForUser, type TenancyDb } from "@/features/tenancy/repo";
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
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { reportError } from "@/lib/observability/alerts";
import { logEvent, requestIdFrom } from "@/lib/observability/log";

/**
 * POST /api/assistant — one chat turn, signed-in only (A1).
 *
 * The assistant explains the product; it cannot change anything yet, so this
 * route has no write path into menus and never calls a provider tool. The
 * model's answer is returned as plain text, bounded by the schema.
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

  let restaurants: AssistantContextRestaurant[];
  try {
    restaurants = await buildContext(db, userId);
  } catch (error) {
    await reportError("assistant.context_failed", error, { requestId, userId });
    return errorResponse("server_db_unavailable", PUBLIC_MESSAGES.db_unavailable, 503);
  }

  const messages = buildAssistantMessages({
    system: buildAssistantSystemPrompt(restaurants),
    history: parsed.data.history,
    message: parsed.data.message,
  });

  try {
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
