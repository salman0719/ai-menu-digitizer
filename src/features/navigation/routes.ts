export type AppScreen = "capture" | "library" | "orders" | "editor";

export type AppRoute =
  { screen: "capture" | "library" | "orders" } | { screen: "editor"; menuId: string };

/** Read a Tablepass screen from the root URL, defaulting unknown URLs to capture. */
export function parseAppRoute(input: string | URL): AppRoute {
  const url = input instanceof URL ? input : new URL(input, "https://tablepass.invalid");
  if (url.pathname !== "/") return { screen: "capture" };

  switch (url.searchParams.get("view")) {
    case "menus":
      return { screen: "library" };
    case "orders":
      return { screen: "orders" };
    case "menu": {
      const menuId = url.searchParams.get("id")?.trim();
      return menuId ? { screen: "editor", menuId } : { screen: "library" };
    }
    case "capture":
    case null:
      return { screen: "capture" };
    default:
      return { screen: "capture" };
  }
}

/** Build the canonical root URL for an application screen. */
export function appRouteHref(route: AppRoute): string {
  if (route.screen === "capture") return "/";
  if (route.screen === "library") return "/?view=menus";
  if (route.screen === "orders") return "/?view=orders";

  const params = new URLSearchParams({ view: "menu", id: route.menuId });
  return `/?${params.toString()}`;
}
