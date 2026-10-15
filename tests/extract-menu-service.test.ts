import { describe, expect, it, vi } from "vitest";

import { ExtractionProvider } from "../src/lib/ai/provider";
import { extractMenuFromImage, MAX_IMAGE_BYTES, ServiceError } from "../src/lib/ai/service";

const validMenuJson = JSON.stringify({
  title: "Test Café",
  currency: "USD",
  categories: [{ name: "Drinks", items: [{ name: "Espresso", price: 3 }] }],
});

function fakeProvider(responses: string[]): { provider: ExtractionProvider; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    provider: {
      generateText: vi.fn(async () => {
        const next = responses[Math.min(calls, responses.length - 1)];
        calls += 1;
        return next;
      }),
    },
  };
}

const tinyPng: Uint8Array = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("extractMenuFromImage", () => {
  it("returns the parsed menu on the first attempt", async () => {
    const { provider, calls } = fakeProvider([validMenuJson]);
    const menu = await extractMenuFromImage(
      { bytes: tinyPng, mimeType: "image/png" },
      { provider }
    );
    expect(menu.title).toBe("Test Café");
    expect(calls()).toBe(1);
  });

  it("repairs once when the first response is malformed", async () => {
    const { provider, calls } = fakeProvider(["not json at all", validMenuJson]);
    const menu = await extractMenuFromImage(
      { bytes: tinyPng, mimeType: "image/png" },
      { provider }
    );
    expect(menu.title).toBe("Test Café");
    expect(calls()).toBe(2);
  });

  it("fails usefully after the repair retry also fails", async () => {
    const { provider, calls } = fakeProvider(["oops", "still oops"]);
    const error = await extractMenuFromImage(
      { bytes: tinyPng, mimeType: "image/png" },
      { provider }
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).status).toBe(502);
    expect((error as ServiceError).code).toBe("invalid_ai_response");
    expect(calls()).toBe(2);
  });

  it("rejects bad uploads before touching the provider", async () => {
    const { provider } = fakeProvider([validMenuJson]);
    const generateText = provider.generateText as ReturnType<typeof vi.fn>;

    const badType = await extractMenuFromImage(
      { bytes: tinyPng, mimeType: "image/gif" },
      { provider }
    ).catch((e: unknown) => e);
    expect((badType as ServiceError).code).toBe("invalid_file_type");

    const tooBig = await extractMenuFromImage(
      { bytes: new Uint8Array(MAX_IMAGE_BYTES + 1), mimeType: "image/jpeg" },
      { provider }
    ).catch((e: unknown) => e);
    expect((tooBig as ServiceError).status).toBe(413);

    const empty = await extractMenuFromImage(
      { bytes: new Uint8Array(0), mimeType: "image/jpeg" },
      { provider }
    ).catch((e: unknown) => e);
    expect((empty as ServiceError).code).toBe("empty_file");

    expect(generateText).not.toHaveBeenCalled();
  });

  it("reports missing configuration without calling the provider", async () => {
    const { provider } = fakeProvider([validMenuJson]);
    const error = await extractMenuFromImage(
      { bytes: tinyPng, mimeType: "image/png" },
      { provider: null }
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).status).toBe(503);
    expect((error as ServiceError).code).toBe("missing_api_key");
    expect(provider.generateText).not.toHaveBeenCalled();
  });

  it("maps quota failures to 429", async () => {
    const { ProviderError } = await import("../src/lib/ai/provider");
    const failing: ExtractionProvider = {
      generateText: async () => {
        throw new ProviderError("quota", "slow down");
      },
    };
    const error = await extractMenuFromImage(
      { bytes: tinyPng, mimeType: "image/png" },
      { provider: failing }
    ).catch((e: unknown) => e);
    expect((error as ServiceError).status).toBe(429);
    expect((error as ServiceError).code).toBe("quota_exhausted");
  });
});
