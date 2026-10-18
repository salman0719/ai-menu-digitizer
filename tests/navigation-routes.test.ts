import { describe, expect, it } from "vitest";

import { appRouteHref, menuIdFromPathname, parseAppRoute } from "../src/features/navigation/routes";

describe("application routes", () => {
  it("defaults the root and unknown paths to capture", () => {
    expect(parseAppRoute("https://tablepass.example/")).toEqual({ screen: "capture" });
    expect(parseAppRoute("https://tablepass.example/unknown")).toEqual({ screen: "capture" });
  });

  it("parses top-level screen paths", () => {
    expect(parseAppRoute("/menus")).toEqual({ screen: "library" });
    expect(parseAppRoute("/orders")).toEqual({ screen: "orders" });
    expect(parseAppRoute("/")).toEqual({ screen: "capture" });
  });

  it("requires an id for a menu editor deep link", () => {
    expect(parseAppRoute("/menus/")).toEqual({ screen: "library" });
    expect(parseAppRoute("/menus/menu-1")).toEqual({ screen: "editor", menuId: "menu-1" });
    expect(parseAppRoute("/menus/menu-1/items/item-7")).toEqual({
      screen: "item",
      menuId: "menu-1",
      itemId: "item-7",
    });
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
      { screen: "editor", menuId: "menu id/&1" },
      { screen: "item", menuId: "menu id/&1", itemId: "item /&2" },
    ] as const;
    for (const route of routes) {
      expect(parseAppRoute(appRouteHref(route))).toEqual(route);
    }
  });
});
