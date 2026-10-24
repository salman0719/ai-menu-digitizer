import { describe, expect, it } from "vitest";

import { appRouteHref, menuIdFromPathname, parseAppRoute } from "../src/features/navigation/routes";

describe("application routes", () => {
  it("defaults the root and unknown paths to capture", () => {
    expect(parseAppRoute("https://eateryo.example/")).toEqual({ screen: "capture" });
    expect(parseAppRoute("https://eateryo.example/unknown")).toEqual({ screen: "capture" });
  });

  it("parses top-level screen paths", () => {
    expect(parseAppRoute("/menus")).toEqual({ screen: "library" });
    expect(parseAppRoute("/orders")).toEqual({ screen: "orders" });
    expect(parseAppRoute("/tables")).toEqual({ screen: "tables" });
    expect(parseAppRoute("/settings")).toEqual({ screen: "settings" });
    expect(parseAppRoute("/")).toEqual({ screen: "capture" });
  });

  it("requires an id for a menu editor deep link", () => {
    expect(parseAppRoute("/menus/")).toEqual({ screen: "library" });
    expect(parseAppRoute("/menus/menu-1")).toEqual({
      screen: "editor",
      menuId: "menu-1",
      mode: "edit",
    });
    expect(parseAppRoute("/menus/menu-1/items/item-7")).toEqual({
      screen: "item",
      menuId: "menu-1",
      itemId: "item-7",
    });
  });

  it("gives each editor mode its own deep link", () => {
    expect(parseAppRoute("/menus/menu-1/reorder")).toEqual({
      screen: "editor",
      menuId: "menu-1",
      mode: "reorder",
    });
    // The in-editor Table QR mode is gone: menu pages never print cards.
    // A stale /qr link lands on the library, never a blank screen.
    expect(parseAppRoute("/menus/menu-1/qr")).toEqual({ screen: "library" });
    expect(parseAppRoute("/menus/menu-1/preview")).toEqual({
      screen: "editor",
      menuId: "menu-1",
      mode: "preview",
    });
    // Unknown editor sub-paths fall back to the library, never a blank screen.
    expect(parseAppRoute("/menus/menu-1/nope")).toEqual({ screen: "library" });
  });

  it("rejects malformed menu path encoding", () => {
    expect(menuIdFromPathname("/menus/%E0%A4%A")).toBeNull();
    expect(parseAppRoute("/menus/%E0%A4%A")).toEqual({ screen: "library" });
  });

  it("round-trips every supported route and URL-encodes menu ids", () => {
    const routes = [
      { screen: "capture" },
      { screen: "library" },
      { screen: "orders" },
      { screen: "tables" },
      { screen: "settings" },
      { screen: "editor", menuId: "menu id/&1", mode: "edit" },
      { screen: "editor", menuId: "menu id/&1", mode: "reorder" },
      { screen: "editor", menuId: "menu id/&1", mode: "preview" },
      { screen: "item", menuId: "menu id/&1", itemId: "item /&2" },
    ] as const;
    for (const route of routes) {
      expect(parseAppRoute(appRouteHref(route))).toEqual(route);
    }
  });
});
