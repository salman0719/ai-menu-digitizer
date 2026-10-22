import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  alertOps,
  buildAlertEmail,
  reportError,
  resetAlertDedupe,
  shouldSendAlert,
} from "../src/lib/observability/alerts";
import {
  buildLogRecord,
  errorFields,
  redactValue,
  requestIdFrom,
  sanitizeRequestId,
  scrubText,
} from "../src/lib/observability/log";

const now = new Date("2026-10-18T12:00:00.000Z");

beforeEach(() => {
  resetAlertDedupe();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("structured logs", () => {
  it("builds one flat record with a timestamp, level, and event", () => {
    const record = buildLogRecord("info", "orders.created", { orderId: "o1" }, now);
    expect(record).toEqual({
      ts: "2026-10-18T12:00:00.000Z",
      level: "info",
      event: "orders.created",
      orderId: "o1",
    });
  });

  it("drops credential-shaped fields but keeps usage counts", () => {
    const redacted = redactValue({
      apiKey: "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
      password: "hunter2",
      sessionToken: "abc123",
      authorization: "Bearer xyz",
      inputTokens: 1200,
      outputTokens: 300,
      nested: { databaseUrl: "postgres://u:p@host/db" },
    }) as Record<string, unknown>;

    expect(redacted.apiKey).toBe("[redacted]");
    expect(redacted.password).toBe("[redacted]");
    expect(redacted.sessionToken).toBe("[redacted]");
    expect(redacted.authorization).toBe("[redacted]");
    // Counts are the whole point of spend logging — they must survive.
    expect(redacted.inputTokens).toBe(1200);
    expect(redacted.outputTokens).toBe(300);
    expect((redacted.nested as Record<string, unknown>).databaseUrl).toBe("[redacted]");
  });

  it("scrubs credentials embedded in free text", () => {
    expect(scrubText("failed with key AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345")).not.toContain(
      "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345"
    );
    expect(scrubText("Authorization: Bearer abcdefghijklmnop")).not.toContain("abcdefghijklmnop");
    expect(scrubText("postgres://user:secret@db.example.com/app")).toBe(
      "postgres://[redacted]@db.example.com/app"
    );
    expect(scrubText("https://api.example.com?token=abc123&x=1")).toBe(
      "https://api.example.com?token=[redacted]&x=1"
    );
  });

  it("serializes errors without a stack", () => {
    const error = new Error("boom");
    const fields = errorFields(error);
    expect(fields).toEqual({ name: "Error", message: "boom" });
    expect(Object.keys(fields)).not.toContain("stack");
    expect(JSON.stringify(redactValue({ error }))).not.toContain("at ");
  });

  it("truncates long strings so a log line stays one line", () => {
    const long = "x".repeat(1000);
    expect(String(redactValue(long)).length).toBeLessThanOrEqual(301);
    expect(redactValue([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]))
      .toContain("…1 more");
  });

  it("accepts only id-shaped request ids", () => {
    expect(sanitizeRequestId("3f2b9c1e-7a44-4b9e-9f0a-1234567890ab")).toBe(
      "3f2b9c1e-7a44-4b9e-9f0a-1234567890ab"
    );
    expect(sanitizeRequestId("bad\nid")).toBeNull();
    expect(sanitizeRequestId("short")).toBeNull();
    expect(sanitizeRequestId(null)).toBeNull();
  });

  it("reads the id the proxy attached", () => {
    const headers = new Headers({ "x-request-id": "abcdefgh-1234" });
    expect(requestIdFrom({ headers })).toBe("abcdefgh-1234");
    expect(requestIdFrom({ headers: new Headers() })).toBe("unknown");
  });
});

describe("operator alerts", () => {
  it("throttles repeats of the same alert", () => {
    const at = 1_000_000;
    expect(shouldSendAlert("error:orders:x", at)).toBe(true);
    expect(shouldSendAlert("error:orders:x", at + 1_000)).toBe(false);
    expect(shouldSendAlert("error:orders:x", at + 60 * 60 * 1000)).toBe(true);
  });

  it("builds a scrubbed, escaped email", () => {
    const email = buildAlertEmail(
      {
        subject: "Server error: <orders>",
        details: 'payload {"note":"<script>"} key AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
        dedupeKey: "error:orders:x",
      },
      now
    );
    expect(email.subject).toBe("[Eateryo] Server error: <orders>");
    expect(email.text).toContain("When: 2026-10-18T12:00:00.000Z");
    expect(email.text).not.toContain("AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).not.toContain("<script>");
  });

  it("sends through Resend once per key and reports the outcome", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const alert = { subject: "Order rate limit", details: "12 in a minute", dedupeKey: "rate" };

    await expect(
      alertOps(alert, { fetchImpl, apiKey: "k", from: "a@b.c", to: "ops@b.c" })
    ).resolves.toBe("sent");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ["ops@b.c"] });
    // The key travels in the header, never in the URL or body.
    expect(url).not.toContain("k");
    expect(String(init.body)).not.toContain('"k"');

    await expect(
      alertOps(alert, { fetchImpl, apiKey: "k", from: "a@b.c", to: "ops@b.c" })
    ).resolves.toBe("suppressed");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("stays silent when email is not configured, and never throws on failure", async () => {
    await expect(alertOps({ subject: "s", details: "d", dedupeKey: "unconfigured" }, {})).resolves.toBe(
      "not_configured"
    );
    const failing = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(
      alertOps({ subject: "s", details: "d", dedupeKey: "failing" }, {
        fetchImpl: failing,
        apiKey: "k",
        from: "a@b.c",
        to: "ops@b.c",
      })
    ).resolves.toBe("failed");
  });

  it("reports an error as a log line and an alert without leaking the secret", async () => {
    const spy = vi.spyOn(console, "error");
    await reportError("orders.place_failed", new Error("db said no"), {
      requestId: "abcdefgh-1234",
      apiKey: "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
    });
    const line = String(spy.mock.calls[0]?.[0] ?? "");
    expect(line).toContain('"event":"orders.place_failed"');
    expect(line).toContain('"requestId":"abcdefgh-1234"');
    expect(line).not.toContain("AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
  });
});
