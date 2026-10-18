import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createServerMenu,
  deleteServerMenu,
  fetchServerMenu,
  fetchServerMenus,
  SyncError,
  updateServerMenu,
} from "@/features/menus/sync";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";

/**
 * The sync client is the browser's typed edge over /api/menus. These tests
 * stub `fetch` and verify: envelope decoding (Zod-validated), error-code
 * mapping, the conflict path carrying `currentUpdatedAt`, and network
 * failure degrading to `unavailable` — never a crash, never a silent write.
 */

const serverMenuPayload = {
  menu: {
    id: "menu-1",
    restaurantId: "r-1",
    restaurantName: "Sunny Side Café",
    title: "Sunny Side Café",
    currency: "USD",
    createdAt: "2026-10-18T05:00:00.000Z",
    updatedAt: "2026-10-18T06:00:00.000Z",
    doc: createSampleMenuDocument(),
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchServerMenus", () => {
  it("decodes the list envelope", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ menus: [serverMenuPayload.menu] }));
    vi.stubGlobal("fetch", fetchMock);

    const menus = await fetchServerMenus();
    expect(menus).toHaveLength(1);
    expect(menus[0].id).toBe("menu-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/menus", undefined);
  });

  it("throws unavailable when the payload shape is wrong", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse({ unexpected: true }));

    await expect(fetchServerMenus()).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("fetchServerMenu", () => {
  it("decodes a single menu envelope", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse(serverMenuPayload));

    const menu = await fetchServerMenu("menu-1");
    expect(menu.id).toBe("menu-1");
    expect(menu.doc.categories.length).toBeGreaterThan(0);
  });
});

describe("error mapping", () => {
  it.each([
    [401, "unauthorized", "unauthorized"],
    [403, "forbidden", "forbidden"],
    [404, "not_found", "not_found"],
    [400, "invalid_body", "invalid"],
    [503, "server_db_unavailable", "unavailable"],
  ] as const)("maps %s %s to %s", async (status, serverCode, clientCode) => {
    vi.stubGlobal(
      "fetch",
      async () => jsonResponse({ error: { code: serverCode, message: "nope" } }, status)
    );

    await expect(fetchServerMenus()).rejects.toMatchObject({ code: clientCode });
  });

  it("maps a network failure to unavailable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(fetchServerMenus()).rejects.toMatchObject({ code: "unavailable" });
  });

  it("maps a non-JSON error body by status", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>gateway</html>", { status: 502 }));

    const error = await fetchServerMenus().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncError);
    expect((error as SyncError).code).toBe("unavailable");
  });
});

describe("createServerMenu", () => {
  it("POSTs the document and reports an existing id as exists", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { code: "menu_exists", message: "already there" } }, 409)
    );
    vi.stubGlobal("fetch", fetchMock);

    const doc = createSampleMenuDocument();
    await expect(createServerMenu("r-1", doc)).rejects.toMatchObject({ code: "exists" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/menus");
    expect(JSON.parse(String(init.body))).toEqual({ restaurantId: "r-1", doc });
  });
});

describe("updateServerMenu", () => {
  it("sends expectedUpdatedAt and returns the new revision", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(serverMenuPayload));
    vi.stubGlobal("fetch", fetchMock);

    const doc = { ...createSampleMenuDocument(), id: "menu-1" };
    const updated = await updateServerMenu("menu-1", doc, "2026-10-18T05:00:00.000Z");
    expect(updated.updatedAt).toBe("2026-10-18T06:00:00.000Z");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.expectedUpdatedAt).toBe("2026-10-18T05:00:00.000Z");
    expect(body.doc.id).toBe("menu-1");
  });

  it("surfaces a stale write as conflict with the server's current updatedAt", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        jsonResponse(
          {
            error: {
              code: "stale_menu",
              message: "changed elsewhere",
              currentUpdatedAt: "2026-10-18T07:00:00.000Z",
            },
          },
          409
        )
    );

    const error = await updateServerMenu("menu-1", createSampleMenuDocument(), "stale").catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(SyncError);
    expect((error as SyncError).code).toBe("conflict");
    expect((error as SyncError).currentUpdatedAt).toBe("2026-10-18T07:00:00.000Z");
  });
});

describe("deleteServerMenu", () => {
  it("accepts a 204 with no body", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteServerMenu("menu-1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/menus/menu-1", { method: "DELETE" });
  });
});
