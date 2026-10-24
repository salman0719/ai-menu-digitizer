import { beforeEach, describe, expect, it } from "vitest";

import { getAssistantSpendSummary, recordAssistantUsage } from "@/features/assistant/repo";
import { MICRO_USD_PER_NEURON } from "@/lib/ai/assistant/worker-ai";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * The spend panel reads the same ledger the cap counts. These tests pin the
 * honesty rule inherited from extraction usage: a month containing one call
 * with no reported neurons has an unknown cost, never a partial one.
 */

const NOW = new Date("2026-10-24T12:00:00.000Z");

function row(userId: string, overrides: Partial<Parameters<typeof recordAssistantUsage>[1]> = {}) {
  return {
    userId,
    requestId: "req-spend",
    model: "test-model",
    inputTokens: 100,
    outputTokens: 20,
    neurons: 5.3,
    latencyMs: 1200,
    status: "succeeded" as const,
    ...overrides,
  };
}

describe("assistant spend summary", () => {
  let db: TestDb;
  let userId: string;
  let otherId: string;

  beforeEach(async () => {
    const { createTestDb, seedUser } = await import("./helpers/pg-test-db");
    ({ db } = await createTestDb());
    userId = await seedUser(db, "spend-owner@cafe.test", "Owner");
    otherId = await seedUser(db, "spend-other@cafe.test", "Other");
  }, 30_000);

  it("reports an empty month as zero messages and a real $0.00", async () => {
    await expect(getAssistantSpendSummary(db, userId, NOW, {})).resolves.toMatchObject({
      messages: 0,
      cap: 300,
      remaining: 300,
      neurons: null,
      costMicros: 0,
      unpricedMessages: 0,
    });
  });

  it("sums only this account's calls in the current UTC month", async () => {
    await recordAssistantUsage(db, row(userId, { requestId: "a", neurons: 5.3, now: NOW }));
    await recordAssistantUsage(db, row(userId, { requestId: "b", neurons: 2.1, now: NOW }));
    await recordAssistantUsage(db, row(userId, { requestId: "old", now: new Date("2026-09-30T23:59:00.000Z") }));
    await recordAssistantUsage(db, row(otherId, { requestId: "c", now: NOW }));

    const summary = await getAssistantSpendSummary(db, userId, NOW, {});
    expect(summary).toMatchObject({
      messages: 2,
      neurons: 7.4,
      costMicros: Math.round(5.3 * MICRO_USD_PER_NEURON) + Math.round(2.1 * MICRO_USD_PER_NEURON),
      unpricedMessages: 0,
    });
  });

  it("counts failed calls too, and reports cost as unknown when one omitted neurons", async () => {
    await recordAssistantUsage(db, row(userId, { requestId: "ok", neurons: 5.3, now: NOW }));
    await recordAssistantUsage(
      db,
      row(userId, {
        requestId: "failed-before-usage",
        neurons: null,
        status: "failed",
        errorCode: "http_error",
        now: NOW,
      })
    );

    const summary = await getAssistantSpendSummary(db, userId, NOW, {});
    expect(summary.messages).toBe(2);
    expect(summary.neurons).toBe(5.3);
    expect(summary.costMicros).toBeNull();
    expect(summary.unpricedMessages).toBe(1);
  });

  it("uses the same configured cap the chat route enforces", async () => {
    await recordAssistantUsage(db, row(userId, { requestId: "a", neurons: 1, now: NOW }));
    const summary = await getAssistantSpendSummary(db, userId, NOW, {
      ASSISTANT_MONTHLY_MESSAGE_CAP: "40",
    });
    expect(summary).toMatchObject({ messages: 1, cap: 40, remaining: 39 });
  });
});
