export type AppScreen = "capture" | "library" | "orders" | "editor" | "item";

export type AppRoute =
  | { screen: "capture" | "library" | "orders" }
  | { screen: "editor"; menuId: string }
  | { screen: "item"; menuId: string; itemId: string };

/** Decode a menu and optional item id from a stable menu URL. */
export function menuSelectionFromPathname(
  pathname: string
): { menuId: string; itemId?: string } | null {
  const menuMatch = /^\/menus\/([^/]+)(?:\/items\/([^/]+))?$/.exec(pathname);
  if (!menuMatch?.[1]) return null;
  try {
    const menuId = decodeURIComponent(menuMatch[1]).trim();
    if (!menuId) return null;
    if (!menuMatch[2]) return { menuId };
    const itemId = decodeURIComponent(menuMatch[2]).trim();
    return itemId ? { menuId, itemId } : null;
  } catch {
    return null;
  }
}

export function menuIdFromPathname(pathname: string): string | null {
  return menuSelectionFromPathname(pathname)?.menuId ?? null;
}

/** Read an application screen from a URL, defaulting unknown URLs to capture. */
export function parseAppRoute(input: string | URL): AppRoute {
  const url = input instanceof URL ? input : new URL(input, "https://tablepass.invalid");
  if (url.pathname === "/") return { screen: "capture" };
  if (url.pathname === "/menus") return { screen: "library" };
  if (url.pathname === "/orders") return { screen: "orders" };

  const selection = menuSelectionFromPathname(url.pathname);
  if (selection?.itemId) {
    return { screen: "item", menuId: selection.menuId, itemId: selection.itemId };
  }
  if (selection) return { screen: "editor", menuId: selection.menuId };
  if (url.pathname.startsWith("/menus/")) return { screen: "library" };
  return { screen: "capture" };
}

/** Build the canonical path for an application screen. */
export function appRouteHref(route: AppRoute): string {
  switch (route.screen) {
    case "capture":
      return "/";
    case "library":
      return "/menus";
    case "orders":
      return "/orders";
    case "editor":
      return `/menus/${encodeURIComponent(route.menuId)}`;
    case "item":
      return `/menus/${encodeURIComponent(route.menuId)}/items/${encodeURIComponent(route.itemId)}`;
  }
}
