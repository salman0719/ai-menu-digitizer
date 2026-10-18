import { describe, expect, it, vi } from "vitest";

import { MAX_MENU_PAGES, MAX_TOTAL_IMAGE_BYTES } from "../src/lib/image-constraints";
import { ExtractionProvider, ExtractionRequest, NO_USAGE } from "../src/lib/ai/provider";
import { extractMenuFromImages, MAX_IMAGE_BYTES, ServiceError } from "../src/lib/ai/service";

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
        return { text: next, usage: NO_USAGE };
      }),
    },
  };
}

// Full headers — the server sniffs real bytes, not file names.
const tinyPng: Uint8Array = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const tinyJpeg: Uint8Array = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function onePage(deps: { provider: ExtractionProvider | null }, bytes = tinyPng) {
  return extractMenuFromImages([{ bytes, mimeType: "image/png" }], deps);
}

describe("extractMenuFromImages", () => {
  it("returns the parsed menu on the first attempt", async () => {
    const { provider, calls } = fakeProvider([validMenuJson]);
    const { menu } = await onePage({ provider });
    expect(menu.title).toBe("Test Café");
    expect(calls()).toBe(1);
  });

  it("repairs once when the first response is malformed", async () => {
    const { provider, calls } = fakeProvider(["not json at all", validMenuJson]);
    const { menu } = await onePage({ provider });
    expect(menu.title).toBe("Test Café");
    expect(calls()).toBe(2);
  });

  it("sums token usage across the first call and the repair retry", async () => {
    const usages = [
      { inputTokens: 1000, outputTokens: 100 },
      { inputTokens: 1100, outputTokens: 120 },
    ];
    let call = 0;
    const provider: ExtractionProvider = {
      generateText: async () => ({
        text: call++ === 0 ? "not json" : validMenuJson,
        usage: usages[Math.min(call - 1, usages.length - 1)],
      }),
    };
    const outcome = await onePage({ provider });
    expect(outcome.usage).toEqual({ inputTokens: 2100, outputTokens: 220 });
  });

  it("keeps the billed usage on a failure so the cost brake sees it", async () => {
    let call = 0;
    const provider: ExtractionProvider = {
      generateText: async () => ({
        text: "still not json",
        usage: call++ === 0 ? { inputTokens: 900, outputTokens: 40 } : { inputTokens: 950, outputTokens: 45 },
      }),
    };
    const error = await onePage({ provider }).catch((e: unknown) => e);
    expect((error as ServiceError).usage).toEqual({ inputTokens: 1850, outputTokens: 85 });
  });

  it("fails usefully after the repair retry also fails", async () => {
    const { provider, calls } = fakeProvider(["oops", "still oops"]);
    const error = await onePage({ provider }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).status).toBe(502);
    expect((error as ServiceError).code).toBe("invalid_ai_response");
    expect(calls()).toBe(2);
  });

  it("rejects bad uploads before touching the provider", async () => {
    const { provider } = fakeProvider([validMenuJson]);
    const generateText = provider.generateText as ReturnType<typeof vi.fn>;

    const notAnImage = Uint8Array.from("GIF89a", (char) => char.charCodeAt(0));
    const badType = await extractMenuFromImages([{ bytes: notAnImage, mimeType: "image/gif" }], {
      provider,
    }).catch((e: unknown) => e);
    expect((badType as ServiceError).code).toBe("invalid_file_type");

    const tooBig = await extractMenuFromImages(
      [{ bytes: new Uint8Array(MAX_IMAGE_BYTES + 1), mimeType: "image/jpeg" }],
      { provider }
    ).catch((e: unknown) => e);
    expect((tooBig as ServiceError).status).toBe(413);

    const empty = await extractMenuFromImages(
      [{ bytes: new Uint8Array(0), mimeType: "image/jpeg" }],
      {
        provider,
      }
    ).catch((e: unknown) => e);
    expect((empty as ServiceError).code).toBe("empty_file");

    expect(generateText).not.toHaveBeenCalled();
  });

  it("reports missing configuration without calling the provider", async () => {
    const { provider } = fakeProvider([validMenuJson]);
    const error = await onePage({ provider: null }).catch((e: unknown) => e);
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
    const error = await onePage({ provider: failing }).catch((e: unknown) => e);
    expect((error as ServiceError).status).toBe(429);
    expect((error as ServiceError).code).toBe("quota_exhausted");
  });

  it("uses sniffed bytes over a mislabeled declared type", async () => {
    const requests: ExtractionRequest[] = [];
    const provider: ExtractionProvider = {
      generateText: vi.fn(async (request: ExtractionRequest) => {
        requests.push(request);
        return { text: validMenuJson, usage: NO_USAGE };
      }),
    };
    await extractMenuFromImages([{ bytes: tinyPng, mimeType: "image/jpeg" }], { provider });
    expect(requests[0].images[0].mimeType).toBe("image/png");
  });

  it("rejects AVIF bytes with guidance to re-upload through the app", async () => {
    const avif = new Uint8Array([
      0,
      0,
      0,
      0x1c,
      ...Uint8Array.from("ftypavif", (char) => char.charCodeAt(0)),
      0,
      0,
      0,
      0,
    ]);
    const { provider } = fakeProvider([validMenuJson]);
    const error = await extractMenuFromImages([{ bytes: avif, mimeType: "image/jpeg" }], {
      provider,
    }).catch((e: unknown) => e);
    expect((error as ServiceError).code).toBe("invalid_file_type");
    expect((error as ServiceError).message).toContain("AVIF");
    expect(provider.generateText).not.toHaveBeenCalled();
  });

  it("passes HEIC bytes through with the correct MIME type", async () => {
    const requests: ExtractionRequest[] = [];
    const provider: ExtractionProvider = {
      generateText: vi.fn(async (request: ExtractionRequest) => {
        requests.push(request);
        return { text: validMenuJson, usage: NO_USAGE };
      }),
    };
    const heic = new Uint8Array([
      0,
      0,
      0,
      0x1c,
      ...Uint8Array.from("ftypheic", (char) => char.charCodeAt(0)),
      0,
      0,
      0,
      0,
    ]);
    await extractMenuFromImages([{ bytes: heic, mimeType: "" }], { provider });
    expect(requests[0].images[0].mimeType).toBe("image/heic");
  });

  it("extracts all pages in one provider call with page-aware guidance", async () => {
    const requests: ExtractionRequest[] = [];
    const provider: ExtractionProvider = {
      generateText: vi.fn(async (request: ExtractionRequest) => {
        requests.push(request);
        return { text: validMenuJson, usage: NO_USAGE };
      }),
    };
    const { menu } = await extractMenuFromImages(
      [
        { bytes: tinyPng, mimeType: "image/png", filename: "page-1.png" },
        { bytes: tinyJpeg, mimeType: "image/jpeg", filename: "page-2.jpg" },
      ],
      { provider }
    );
    expect(menu.title).toBe("Test Café");
    expect(requests).toHaveLength(1);
    expect(requests[0].images).toHaveLength(2);
    expect(requests[0].images[0].mimeType).toBe("image/png");
    expect(requests[0].images[1].mimeType).toBe("image/jpeg");
    expect(requests[0].promptText).toContain("pages 1–2");
    expect(requests[0].promptText).toContain("do not repeat the heading");
  });

  it("rejects an empty request, too many pages, and oversized page sets", async () => {
    const { provider } = fakeProvider([validMenuJson]);
    const generateText = provider.generateText as ReturnType<typeof vi.fn>;

    const none = await extractMenuFromImages([], { provider }).catch((e: unknown) => e);
    expect((none as ServiceError).code).toBe("missing_image");

    const tooMany = await extractMenuFromImages(
      Array.from({ length: MAX_MENU_PAGES + 1 }, () => ({
        bytes: tinyPng,
        mimeType: "image/png" as const,
      })),
      { provider }
    ).catch((e: unknown) => e);
    expect((tooMany as ServiceError).status).toBe(400);
    expect((tooMany as ServiceError).code).toBe("too_many_pages");

    // Each file is under the per-file limit, but together they exceed the total.
    const halfPlusOne = new Uint8Array(Math.floor(MAX_TOTAL_IMAGE_BYTES / 2) + 1);
    const oversizedSet = await extractMenuFromImages(
      [
        { bytes: halfPlusOne, mimeType: "image/jpeg" },
        { bytes: halfPlusOne, mimeType: "image/jpeg" },
      ],
      { provider }
    ).catch((e: unknown) => e);
    expect((oversizedSet as ServiceError).status).toBe(413);
    expect((oversizedSet as ServiceError).code).toBe("file_too_large");

    expect(generateText).not.toHaveBeenCalled();
  });
});
