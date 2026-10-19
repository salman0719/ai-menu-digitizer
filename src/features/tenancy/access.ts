/**
 * Client-safe role helpers. A restaurant role decides which menu controls a
 * member sees: owners can edit, publish and delete; staff can only view.
 * The server refuses staff writes regardless, so this is presentation only.
 */

/** Ids of menus whose restaurant the caller can only view as staff. */
export function staffMenuIds(
  menus: { id: string; restaurantId: string }[],
  restaurants: { id: string; role: "owner" | "staff" }[]
): Set<string> {
  const roleByRestaurant = new Map(
    restaurants.map((restaurant) => [restaurant.id, restaurant.role])
  );
  const visibleOnly = new Set<string>();
  for (const menu of menus) {
    if (roleByRestaurant.get(menu.restaurantId) === "staff") visibleOnly.add(menu.id);
  }
  return visibleOnly;
}
