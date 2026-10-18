import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { moveLocalMenusToAccount } from "@/features/menus/move-to-account";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import type { MenuDocument } from "@/features/menu/schema";
import { closeDatabase, DB_NAME } from "@/features/menu/indexeddb";
import { deleteMenu, saveMenu } from "@/features/menu/storage";

/**
 * Step 8 acceptance: "Move my menus to my account" imports local documents
 * intact — ids, order, variants, and review notes — through the same
 * validated API the editor uses. The server is stubbed at the fetch layer
 * with a tiny in-memory "server" that enforces import-by-id + skip-existing,
 * exactly like the real route's 409 menu_exists.
 */

interface ServerState {
  /** id → the document the "server" stored, as sent by the client. */
  menus: Map<string, unknown>;
  /** Which restaurant each request claimed (for assertions). */
  restaurants: string[];
}

function stubServer(state: ServerState, options: { offline?: boolean } = {}): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (options.offline) throw new TypeError("Failed to fetch");
    const url = String(input);
    const method = init?.method ?? "GET";

    if (method === "POST" && url.endsWith("/api/menus")) {
      const body = JSON.parse(String(init?.body)) as { restaurantId: string; doc: MenuDocument };
      state.restaurants.push(body.restaurantId);
      if (state.menus.has(body.doc.id)) {
        return new Response(
          JSON.stringify({ error: { code: "menu_exists", message: "Already moved." } }),
          { status: 409, headers: { "content-type": "application/json" } }
        );
      }
      state.menus.set(body.doc.id, body.doc);
      return new Response(
        JSON.stringify({
          menu: {
            id: body.doc.id,
            restaurantId: body.restaurantId,
            restaurantName: "Sunny Side Café",
            title: body.doc.title,
            currency: body.doc.currency,
            createdAt: body.doc.updatedAt,
            updatedAt: body.doc.updatedAt,
            doc: body.doc,
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: { code: "not_found", message: "Unhandled route." } }),
      { status: 404, headers: { "content-type": "application/json" } }
    );
  });
}

function resetDatabase(): Promise<void> {
  closeDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await resetDatabase();
});

describe("moveLocalMenusToAccount", () => {
  it("imports local documents intact: ids, order, variants, review notes", async () => {
    const original = createSampleMenuDocument();
    // A document with the details that must survive the round trip: a
    // variant, an option with a price delta, dietary labels, review notes,
    // and an honest null price.
    const detailed: MenuDocument = {
      ...original,
      id: "menu-detailed",
      title: "Lunch Board",
      categories: [
        {
          id: "cat-1",
          name: "Brunch",
          sortOrder: 0,
          items: [
            {
              id: "item-1",
              name: "Eggs Benedict",
              description: "House-made hollandaise",
              price: 12.5,
              currency: "$",
              sortOrder: 0,
              available: true,
              dietaryLabels: ["vegetarian"],
              variants: [
                { name: "With bacon", price: 14.5 },
                { name: "Smoked salmon", price: null },
              ],
              options: [
                {
                  name: "Bread",
                  choices: [
                    { name: "Sourdough", priceDelta: null },
                    { name: "Gluten-free", priceDelta: 2 },
                  ],
                },
              ],
              reviewNotes: ["Confirm salmon price with the kitchen"],
            },
            {
              id: "item-2",
              name: "Soup of the day",
              description: null,
              price: null,
              currency: null,
              sortOrder: 1,
              available: null,
              dietaryLabels: [],
              variants: [],
              options: [],
              reviewNotes: ["Price not on the board — ask before printing"],
            },
          ],
        },
      ],
    };
    await saveMenu(detailed);
    await saveMenu({ ...createSampleMenuDocument(), id: "menu-second", title: "Second menu" });

    const state: ServerState = { menus: new Map(), restaurants: [] };
    stubServer(state);

    const report = await moveLocalMenusToAccount("r-1");

    expect(report.imported.sort()).toEqual(["menu-detailed", "menu-second"]);
    expect(report.skipped).toEqual([]);
    expect(report.failed).toEqual([]);

    // The stored server document is byte-identical to the local one apart
    // from nothing: the client sends the document as-is, ids included.
    const stored = state.menus.get("menu-detailed") as MenuDocument;
    expect(stored).toMatchObject({
      id: "menu-detailed",
      title: "Lunch Board",
      categories: detailed.categories,
    });
    // Explicit fidelity checks for the acceptance criterion.
    const item = stored.categories[0].items[0];
    expect(item.variants).toEqual(detailed.categories[0].items[0].variants);
    expect(item.options).toEqual(detailed.categories[0].items[0].options);
    expect(item.reviewNotes).toEqual(["Confirm salmon price with the kitchen"]);
    expect(stored.categories[0].items[1].price).toBeNull();
    // Order is preserved exactly as stored locally.
    expect(stored.categories[0].items.map((i) => i.id)).toEqual(["item-1", "item-2"]);
    expect(state.restaurants).toEqual(["r-1", "r-1"]);
  });

  it("is idempotent: a second run skips menus that already exist", async () => {
    await saveMenu({ ...createSampleMenuDocument(), id: "menu-once" });

    const state: ServerState = { menus: new Map(), restaurants: [] };
    stubServer(state);

    const first = await moveLocalMenusToAccount("r-1");
    expect(first.imported).toEqual(["menu-once"]);

    const second = await moveLocalMenusToAccount("r-1");
    expect(second.imported).toEqual([]);
    expect(second.skipped).toEqual(["menu-once"]);
    expect(second.failed).toEqual([]);
    // The server still holds exactly one copy.
    expect(state.menus.size).toBe(1);
  });

  it("keeps going after a per-menu failure and never deletes local data", async () => {
    await saveMenu({ ...createSampleMenuDocument(), id: "menu-good" });
    await saveMenu({ ...createSampleMenuDocument(), id: "menu-broken" });

    const state: ServerState = { menus: new Map(), restaurants: [] };
    // The "server" rejects menu-broken specifically.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/api/menus")) {
        const body = JSON.parse(String(init.body)) as { doc: MenuDocument };
        if (body.doc.id === "menu-broken") {
          return new Response(
            JSON.stringify({ error: { code: "server_db_unavailable", message: "Down." } }),
            { status: 503, headers: { "content-type": "application/json" } }
          );
        }
        state.menus.set(body.doc.id, body.doc);
        return new Response(
          JSON.stringify({
            menu: {
              id: body.doc.id,
              restaurantId: "r-1",
              restaurantName: "Sunny Side Café",
              title: body.doc.title,
              currency: body.doc.currency,
              createdAt: body.doc.updatedAt,
              updatedAt: body.doc.updatedAt,
              doc: body.doc,
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("{}", { status: 404 });
    });

    const report = await moveLocalMenusToAccount("r-1");

    expect(report.imported).toEqual(["menu-good"]);
    expect(report.failed).toEqual([
      { id: "menu-broken", title: expect.any(String), reason: expect.any(String) },
    ]);
    expect(report.failed[0]?.reason).toMatch(/unreachable|connection/i);

    // One-way: both local menus still exist afterwards.
    const { listMenus } = await import("@/features/menu/storage");
    const local = await listMenus();
    expect(local.map((m) => m.id).sort()).toEqual(["menu-broken", "menu-good"]);
  });

  it("reports offline as unavailable for every menu instead of throwing", async () => {
    await saveMenu({ ...createSampleMenuDocument(), id: "menu-offline" });
    const state: ServerState = { menus: new Map(), restaurants: [] };
    stubServer(state, { offline: true });

    const report = await moveLocalMenusToAccount("r-1");

    expect(report.imported).toEqual([]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.id).toBe("menu-offline");
    expect(report.failed[0]?.reason).toMatch(/unreachable/i);
  });

  it("refuses to move damaged local records but moves the rest", async () => {
    const good = { ...createSampleMenuDocument(), id: "menu-valid" };
    await saveMenu(good);
    // Bypass saveMenu's validation to plant a damaged record, as an
    // interrupted write or an older app version could leave behind.
    const { idbPut, MENUS_STORE, tx } = await import("@/features/menu/indexeddb");
    await tx(MENUS_STORE, "readwrite", ([store]) =>
      idbPut(store, { id: "menu-damaged", title: 42 })
    );

    const state: ServerState = { menus: new Map(), restaurants: [] };
    stubServer(state);

    const report = await moveLocalMenusToAccount("r-1");

    expect(report.imported).toEqual(["menu-valid"]);
    expect(report.failed.map((f) => f.id)).toEqual(["menu-damaged"]);
    expect(report.failed[0]?.reason).toMatch(/damaged/i);

    // And the damaged local record was not deleted either.
    await deleteMenu("menu-valid");
    const { listMenus } = await import("@/features/menu/storage");
    const remaining = await listMenus();
    expect(remaining.map((m) => m.id)).toEqual(["menu-damaged"]);
  });
});
