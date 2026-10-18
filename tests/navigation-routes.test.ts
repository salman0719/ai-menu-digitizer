import { describe, expect, it } from "vitest";

import { appRouteHref, parseAppRoute } from "../src/features/navigation/routes";

describe("application routes", () => {
  it("defaults the root and unknown paths to capture", () => {
    expect(parseAppRoute("https://tablepass.example/")).toEqual({ screen: "capture" });
    expect(parseAppRoute("https://tablepass.example/unknown")).toEqual({ screen: "capture" });
    expect(parseAppRoute("/?view=unexpected")).toEqual({ screen: "capture" });
  });

  it("parses top-level screen query routes", () => {
    expect(parseAppRoute("/?view=menus")).toEqual({ screen: "library" });
    expect(parseAppRoute("/?view=orders")).toEqual({ screen: "orders" });
    expect(parseAppRoute("/?view=capture")).toEqual({ screen: "capture" });
  });

  it("requires an id for a menu editor deep link", () => {
    expect(parseAppRoute("/?view=menu")).toEqual({ screen: "library" });
    expect(parseAppRoute("/?view=menu&id=%20%20")).toEqual({ screen: "library" });
    expect(parseAppRoute("/?view=menu&id=menu-1")).toEqual({ screen: "editor", menuId: "menu-1" });
  });

  it("round-trips every supported route and URL-encodes menu ids", () => {
    const routes = [
      { screen: "capture" },
      { screen: "library" },
      { screen: "orders" },
      { screen: "editor", menuId: "menu id/&1" },
    ] as const;
    for (const route of routes) {
      expect(parseAppRoute(appRouteHref(route))).toEqual(route);
    }
  });
});
