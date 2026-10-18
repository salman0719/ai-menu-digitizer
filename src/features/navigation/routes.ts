export type AppScreen = "capture" | "library" | "orders" | "editor" | "item";

/**
 * The surface shown for an open menu: the edit workspace, the compact
 * reorder list, the printable table QR cards, or the customer preview.
 * Mirrors the editor modes, each with its own deep-linkable URL.
 */
export type EditorMode = "edit" | "reorder" | "qr" | "preview";

export type AppRoute =
  | { screen: "capture" | "library" | "orders" }
  | { screen: "editor"; menuId: string; mode: EditorMode }
  | { screen: "item"; menuId: string; itemId: string };

/** Decode a menu URL into its menu id plus optional mode or item id. */
export function menuSelectionFromPathname(
  pathname: string
): { menuId: string; mode?: EditorMode; itemId?: string } | null {
  const menuMatch = /^\/menus\/([^/]+)(?:\/(reorder|qr|preview)|\/items\/([^/]+))?$/.exec(pathname);
  if (!menuMatch?.[1]) return null;
  try {
    const menuId = decodeURIComponent(menuMatch[1]).trim();
    if (!menuId) return null;
    const [, , modeSegment, rawItemId] = menuMatch;
    if (modeSegment === "reorder" || modeSegment === "qr" || modeSegment === "preview") {
      return { menuId, mode: modeSegment };
    }
    if (rawItemId !== undefined) {
      const itemId = decodeURIComponent(rawItemId).trim();
      return itemId ? { menuId, itemId } : null;
    }
    return { menuId };
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
  if (selection) {
    return { screen: "editor", menuId: selection.menuId, mode: selection.mode ?? "edit" };
  }
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
    case "editor": {
      const menuPath = `/menus/${encodeURIComponent(route.menuId)}`;
      return route.mode === "edit" ? menuPath : `${menuPath}/${route.mode}`;
    }
    case "item":
      return `/menus/${encodeURIComponent(route.menuId)}/items/${encodeURIComponent(route.itemId)}`;
  }
}
