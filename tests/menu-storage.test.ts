import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase, DB_NAME, idbPut, MENUS_STORE, tx } from "../src/features/menu/indexeddb";
import { createMenuDocument } from "../src/features/menu/menu-utils";
import {
  cacheMenu,
  createMenu,
  deleteMenu,
  getImage,
  getMenu,
  listMenus,
  renameMenu,
  saveImage,
  saveMenu,
  StorageError,
} from "../src/features/menu/storage";

function resetDatabase(): Promise<void> {
  closeDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

beforeEach(() => resetDatabase());
afterEach(() => closeDatabase());

describe("menu storage", () => {
  it("creates, saves, reads, and lists menus", async () => {
    const created = await createMenu("Café");
    created.categories.push({
      id: "c1",
      name: "Drinks",
      sortOrder: 0,
      items: [
        {
          id: "i1",
          name: "Espresso",
          description: null,
          price: 3,
          currency: null,
          sortOrder: 0,
          available: null,
          dietaryLabels: [],
          variants: [],
          options: [],
          reviewNotes: [],
        },
      ],
    });
    const saved = await saveMenu(created);

    const fetched = await getMenu(saved.id);
    expect(fetched.title).toBe("Café");
    expect(fetched.categories).toHaveLength(1);

    const menus = await listMenus();
    expect(menus).toHaveLength(1);
    expect(menus[0]).toMatchObject({
      id: saved.id,
      title: "Café",
      categoryCount: 1,
      itemCount: 1,
      corrupt: false,
    });
  });

  it("renames menus and rejects empty titles", async () => {
    const created = await createMenu("Old");
    const renamed = await renameMenu(created.id, "  New  ");
    expect(renamed.title).toBe("New");
    await expect(renameMenu(created.id, "   ")).rejects.toMatchObject({ code: "corrupt" });
  });

  it("reports missing menus distinctly", async () => {
    await expect(getMenu("nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("deletes menus together with their images", async () => {
    const created = await createMenu("Temp");
    await saveImage(created.id, new Blob(["img"], { type: "image/png" }));
    expect(await getImage(created.id)).not.toBeNull();
    await deleteMenu(created.id);
    expect(await listMenus()).toHaveLength(0);
    expect(await getImage(created.id)).toBeNull();
  });

  it("round-trips image blobs", async () => {
    const created = await createMenu("With photo");
    const blob = new Blob(["fake-bytes"], { type: "image/jpeg" });
    await saveImage(created.id, blob);
    const stored = await getImage(created.id);
    expect(stored?.mimeType).toBe("image/jpeg");
    expect(await stored?.blob.text()).toBe("fake-bytes");
  });

  it("flags corrupt records in listings and refuses them on open", async () => {
    const created = await createMenu("Will corrupt");
    await tx(MENUS_STORE, "readwrite", ([store]) => idbPut(store, { id: created.id, title: 42 }));
    const menus = await listMenus();
    expect(menus).toHaveLength(1);
    expect(menus[0].corrupt).toBe(true);
    await expect(getMenu(created.id)).rejects.toMatchObject({ code: "corrupt" });
  });

  it("refuses to save invalid documents", async () => {
    const created = await createMenu("Valid");
    await expect(saveMenu({ ...created, title: "" })).rejects.toBeInstanceOf(StorageError);
  });
});

describe("cacheMenu", () => {
  it("caches a server document without restamping updatedAt", async () => {
    const serverDoc = {
      ...createMenuDocument({ title: "Server menu" }),
      id: "server-1",
      updatedAt: "2026-10-18T05:00:00.000Z",
    };

    const cached = await cacheMenu(serverDoc);
    expect(cached.updatedAt).toBe("2026-10-18T05:00:00.000Z");

    // The stored revision time survives a read (the library shows it).
    const fetched = await getMenu("server-1");
    expect(fetched.updatedAt).toBe("2026-10-18T05:00:00.000Z");
    expect(fetched.title).toBe("Server menu");
  });

  it("refuses invalid documents", async () => {
    await expect(cacheMenu({ id: "x", title: "Bad" } as never)).rejects.toMatchObject({
      code: "corrupt",
    });
  });
});
