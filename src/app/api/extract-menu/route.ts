import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { ANONYMOUS_EXTRACTION_LIMIT_PER_HOUR } from "@/features/usage/schema";
import {
  countAnonymousExtractions,
  getMonthlyUsageSummary,
  recordExtractionUsage,
} from "@/features/usage/repo";
import type { ProviderName, ProviderUsage } from "@/lib/ai/provider";
import { buildProviderChain } from "@/lib/ai/provider-config";
import { extractMenuFromImages, ServiceError } from "@/lib/ai/service";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { alertOps, reportError } from "@/lib/observability/alerts";
import { logEvent, requestIdFrom } from "@/lib/observability/log";

/**
 * POST /api/extract-menu — multipart form with one or more `image` file
 * fields (pages of the same menu, in order).
 * Success: { menu, provider, model } (validated extraction result, no stable
 * IDs yet; the vendor/model that answered are recorded so the menu's source
 * is honest even when the request failed over).
 * Failure: { error: { code, message } } — never provider internals,
 * credentials, or stack traces. Uploaded bytes are not stored server-side.
 *
 * Free-launch cost brake (Step 11): every attempt is written to
 * `extraction_usage`, failed attempts included, because the provider bills for
 * both. A signed-in account is limited to its monthly cap; an anonymous caller
 * is limited per hour by a hash of its address. When the database is not
 * configured (the local-first prototype), bookkeeping is skipped rather than
 * breaking extraction — the skip is logged.
 */

const HOUR_MS = 60 * 60 * 1000;

/** One-way caller id: no raw address is stored, only a truncated hash. */
function callerHash(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  return createHash("sha256").update(address).digest("hex").slice(0, 32);
}

async function sessionUser(): Promise<string | null> {
  try {
    return await getSessionUserId();
  } catch {
    // No DB / auth unavailable: the request is treated as anonymous.
    return null;
  }
}

/**
 * Refuse the request when the caller is out of allowance. Returns null when
 * extraction may proceed. Never blocks on a bookkeeping failure.
 */
async function checkAllowance(request: Request, requestId: string): Promise<NextResponse | null> {
  try {
    const db = getDb();
    const userId = await sessionUser();
    if (userId) {
      const usage = await getMonthlyUsageSummary(db, userId);
      if (usage.remaining <= 0) {
        logEvent("warn", "extract.cap_reached", {
          requestId,
          userId,
          requests: usage.requests,
          cap: usage.cap,
        });
        await alertOps({
          subject: "Extraction cap reached",
          details: `Account ${userId} used all ${usage.cap} free extractions for this month (${usage.requests} attempts). Further requests are refused until ${usage.periodEnd.slice(0, 10)}.`,
          dedupeKey: `extract.cap:${userId}`,
        });
        return NextResponse.json(
          {
            error: {
              code: "extraction_cap_reached",
              message: `This account has used all ${usage.cap} free extractions for this month. The allowance resets on ${usage.periodEnd.slice(0, 10)}.`,
            },
          },
          { status: 429 }
        );
      }
      return null;
    }

    const recent = await countAnonymousExtractions(
      db,
      callerHash(request),
      new Date(Date.now() - HOUR_MS)
    );
    if (recent >= ANONYMOUS_EXTRACTION_LIMIT_PER_HOUR) {
      logEvent("warn", "extract.rate_limited", { requestId, recent });
      const response = NextResponse.json(
        {
          error: {
            code: "rate_limited",
            message: `Too many extractions from this connection (${ANONYMOUS_EXTRACTION_LIMIT_PER_HOUR} per hour). Sign in for a higher allowance, or try again later.`,
          },
        },
        { status: 429 }
      );
      response.headers.set("Retry-After", "900");
      return response;
    }
    return null;
  } catch (error) {
    // The local-first prototype has no database; extraction must still work.
    logEvent("warn", "extract.allowance_check_skipped", { requestId, error });
    return null;
  }
}

interface UsageRecordInput {
  request: Request;
  requestId: string;
  provider: ProviderName;
  model: string;
  pages: number;
  imageBytes: number;
  usage: ProviderUsage | null;
  status: "succeeded" | "failed";
  errorCode?: string | null;
}

/** Best-effort ledger write; a bookkeeping failure must not fail the request. */
async function recordUsage(input: UsageRecordInput): Promise<void> {
  try {
    const userId = await sessionUser();
    await recordExtractionUsage(getDb(), {
      userId,
      callerHash: userId ? null : callerHash(input.request),
      requestId: input.requestId,
      provider: input.provider,
      model: input.model,
      pages: input.pages,
      imageBytes: input.imageBytes,
      usage: input.usage,
      status: input.status,
      errorCode: input.errorCode ?? null,
    });
  } catch (error) {
    logEvent("warn", "extract.usage_not_recorded", { requestId: input.requestId, error });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = requestIdFrom(request);
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: { code: "missing_image", message: "Upload an image file in the `image` field." } },
        { status: 400 }
      );
    }
    const files = form.getAll("image").filter((entry): entry is File => entry instanceof File);

    // Vendors come from the environment (see provider-config): the primary
    // first, then an optional fallback. An empty chain means no key is set.
    const chain = buildProviderChain({ requestId });

    const images = await Promise.all(
      files.map(async (file) => ({
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type,
        filename: file.name,
      }))
    );

    const allowance = await checkAllowance(request, requestId);
    if (allowance) return allowance;

    const imageBytes = images.reduce((sum, image) => sum + image.bytes.length, 0);
    try {
      const outcome = await extractMenuFromImages(images, { chain, requestId });
      await recordUsage({
        request,
        requestId,
        provider: outcome.provider,
        model: outcome.model,
        pages: images.length,
        imageBytes,
        usage: outcome.usage,
        status: "succeeded",
      });
      return NextResponse.json({
        menu: outcome.menu,
        provider: outcome.provider,
        model: outcome.model,
      });
    } catch (error) {
      // A rejected upload never reached the provider (usage is null), so it
      // must not consume the cap. A call that failed after reaching the
      // provider still cost tokens, and its usage is non-null.
      if (error instanceof ServiceError && error.usage) {
        await recordUsage({
          request,
          requestId,
          // The failing vendor is known during a provider call; upload
          // rejections never reach one, so fall back to the primary.
          provider: error.provider ?? chain[0].name,
          model: error.model ?? chain[0].model,
          pages: images.length,
          imageBytes,
          usage: error.usage,
          status: "failed",
          errorCode: error.code,
        });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ServiceError) {
      // Two provider codes mean the deployment needs a human: a rejected key
      // and exhausted quota. Others (a blurry photo) are the caller's
      // problem, and alerting on them would train us to ignore the inbox.
      if (error.code === "provider_auth_failed" || error.code === "quota_exhausted") {
        await alertOps({
          subject: `Extraction needs attention: ${error.code}`,
          details: `${error.message} (request ${requestId})`,
          dedupeKey: `extract:${error.code}`,
        });
      }
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }
    // Server log + operator alert carry the request id; the browser only
    // ever sees the plain message below.
    await reportError("extract_menu.failed", error, { requestId });
    return NextResponse.json(
      { error: { code: "internal_error", message: "Something went wrong. Try again." } },
      { status: 500 }
    );
  }
}
