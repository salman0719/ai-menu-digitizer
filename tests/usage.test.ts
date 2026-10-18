import { beforeEach, describe, expect, it } from "vitest";

import {
  countAnonymousExtractions,
  getMonthlyUsageSummary,
  recordExtractionUsage,
} from "../src/features/usage/repo";
import {
  costMicros,
  formatMicroUsd,
  tokenRatesFromEnv,
} from "../src/features/usage/pricing";
import {
  DEFAULT_MONTHLY_EXTRACTION_CAP,
  MAX_MONTHLY_EXTRACTION_CAP,
  monthWindow,
  monthlyExtractionCap,
} from "../src/features/usage/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const RATES = { GEMINI_INPUT_USD_PER_MTOK: "0.30", GEMINI_OUTPUT_USD_PER_MTOK: "2.50" };

describe("extraction pricing", () => {
  it("has no cost without both rates — never a guessed price", () => {
    expect(tokenRatesFromEnv({})).toBeNull();
    expect(tokenRatesFromEnv({ GEMINI_INPUT_USD_PER_MTOK: "0.30" })).toBeNull();
    expect(
      costMicros({ inputTokens: 1000, outputTokens: 100 }, null)
    ).toBeNull();
    expect(tokenRatesFromEnv(RATES)).toEqual({
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 2.5,
    });
  });

  it("converts tokens and per-million rates into micro-dollars", () => {
    // 1,000 tokens at $0.30/M = 300 µ$; 100 tokens at $2.50/M = 250 µ$.
    expect(costMicros({ inputTokens: 1000, outputTokens: 100 }, tokenRatesFromEnv(RATES))).toBe(550);
    expect(formatMicroUsd(550)).toBe("$0.0006");
    expect(formatMicroUsd(12_345)).toBe("$0.0123");
  });

  it("cannot price usage with a missing token count", () => {
    expect(
      costMicros({ inputTokens: null, outputTokens: 100 }, tokenRatesFromEnv(RATES))
    ).toBeNull();
  });
});

describe("cap configuration", () => {
  it("defaults, parses, and clamps the monthly cap", () => {
    expect(monthlyExtractionCap({})).toBe(DEFAULT_MONTHLY_EXTRACTION_CAP);
    expect(monthlyExtractionCap({ EXTRACTION_MONTHLY_CAP: "40" })).toBe(40);
    expect(monthlyExtractionCap({ EXTRACTION_MONTHLY_CAP: "0" })).toBe(
      DEFAULT_MONTHLY_EXTRACTION_CAP
    );
    expect(monthlyExtractionCap({ EXTRACTION_MONTHLY_CAP: "abc" })).toBe(
      DEFAULT_MONTHLY_EXTRACTION_CAP
    );
    expect(monthlyExtractionCap({ EXTRACTION_MONTHLY_CAP: "999999" })).toBe(
      MAX_MONTHLY_EXTRACTION_CAP
    );
  });

  it("uses the UTC calendar month", () => {
    const { start, end } = monthWindow(NOW);
    expect(start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("usage ledger", () => {
  let db: TestDb;
  let userId: string;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    userId = await seedUser(db, "usage-owner@cafe.test", "Owner");
  }, 30_000);

  it("sums a month of attempts, including failed ones", async () => {
    const base = { requestId: "req-1", model: "gemini-test", pages: 1, imageBytes: 1000 };
    await recordExtractionUsage(db, {
      ...base,
      userId,
      callerHash: null,
      usage: { inputTokens: 1000, outputTokens: 100 },
      status: "succeeded",
      rates: tokenRatesFromEnv(RATES),
      now: NOW,
    });
    await recordExtractionUsage(db, {
      ...base,
      requestId: "req-2",
      userId,
      callerHash: null,
      usage: { inputTokens: 500, outputTokens: 50 },
      status: "failed",
      errorCode: "invalid_ai_response",
      rates: tokenRatesFromEnv(RATES),
      now: NOW,
    });

    const summary = await getMonthlyUsageSummary(db, userId, NOW, {
      ...RATES,
      EXTRACTION_MONTHLY_CAP: "10",
    });
    expect(summary).toMatchObject({
      requests: 2,
      succeeded: 1,
      failed: 1,
      pages: 2,
      inputTokens: 1500,
      outputTokens: 150,
      cap: 10,
      remaining: 8,
      unpricedRequests: 0,
      ratesConfigured: true,
    });
    expect(summary.costMicros).toBe(1000 * 0.3 + 100 * 2.5 + 500 * 0.3 + 50 * 2.5);
  });

  it("reports no cost at all when one attempt is unpriced", async () => {
    const base = { requestId: "req", model: "gemini-test", pages: 1, imageBytes: 10 };
    await recordExtractionUsage(db, {
      ...base,
      userId,
      callerHash: null,
      usage: { inputTokens: 1000, outputTokens: 100 },
      status: "succeeded",
      rates: tokenRatesFromEnv(RATES),
      now: NOW,
    });
    // A network failure after the call: we know it cost money, not how much.
    await recordExtractionUsage(db, {
      ...base,
      requestId: "req-2",
      userId,
      callerHash: null,
      usage: null,
      status: "failed",
      rates: tokenRatesFromEnv(RATES),
      now: NOW,
    });

    const summary = await getMonthlyUsageSummary(db, userId, NOW, RATES);
    expect(summary.costMicros).toBeNull();
    expect(summary.unpricedRequests).toBe(1);
  });

  it("reports cost as unavailable when no rates are configured", async () => {
    await recordExtractionUsage(db, {
      userId,
      callerHash: null,
      requestId: "req",
      model: "gemini-test",
      pages: 1,
      imageBytes: 10,
      usage: { inputTokens: 1000, outputTokens: 100 },
      status: "succeeded",
      rates: tokenRatesFromEnv({}),
      now: NOW,
    });
    const summary = await getMonthlyUsageSummary(db, userId, NOW, {});
    expect(summary.costMicros).toBeNull();
    expect(summary.ratesConfigured).toBe(false);
    expect(summary.inputTokens).toBe(1000);
  });

  it("leaves last month out of this month's total, and no month is $0.00 when unpriced", async () => {
    await recordExtractionUsage(db, {
      userId,
      callerHash: null,
      requestId: "last-month",
      model: "gemini-test",
      pages: 1,
      imageBytes: 10,
      usage: { inputTokens: 9999, outputTokens: 9999 },
      status: "succeeded",
      rates: tokenRatesFromEnv(RATES),
      now: new Date("2026-09-30T23:59:00.000Z"),
    });
    const summary = await getMonthlyUsageSummary(db, userId, NOW, RATES);
    expect(summary.requests).toBe(0);
    expect(summary.costMicros).toBe(0);
    expect(summary.remaining).toBe(summary.cap);
  });

  it("counts anonymous callers by hash within the window only", async () => {
    const base = { userId: null, model: "gemini-test", pages: 1, imageBytes: 10 };
    await recordExtractionUsage(db, {
      ...base,
      callerHash: "hash-a",
      requestId: "a-1",
      usage: { inputTokens: 1, outputTokens: 1 },
      status: "succeeded",
      now: new Date("2026-10-18T11:30:00.000Z"),
    });
    await recordExtractionUsage(db, {
      ...base,
      callerHash: "hash-a",
      requestId: "a-2",
      usage: { inputTokens: 1, outputTokens: 1 },
      status: "failed",
      now: new Date("2026-10-18T09:00:00.000Z"),
    });
    await recordExtractionUsage(db, {
      ...base,
      callerHash: "hash-b",
      requestId: "b-1",
      usage: { inputTokens: 1, outputTokens: 1 },
      status: "succeeded",
      now: new Date("2026-10-18T11:45:00.000Z"),
    });

    const recent = await countAnonymousExtractions(
      db,
      "hash-a",
      new Date("2026-10-18T10:30:00.000Z")
    );
    expect(recent).toBe(1);
  });
});
