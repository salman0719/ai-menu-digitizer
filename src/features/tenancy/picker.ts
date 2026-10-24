/**
 * Restaurant picker decisions shared by the Tables and Settings tabs.
 *
 * Both surfaces used to auto-select a lone restaurant but still rendered a
 * one-option `<select>` — a forced choice with nothing to choose. These
 * helpers keep the selection resilient (deleting down to one restaurant
 * still shows it) and hide the control unless there is a real choice.
 */

export function showRestaurantPicker(restaurants: readonly unknown[] | null): boolean {
  return (restaurants?.length ?? 0) > 1;
}

/**
 * The restaurant to show: the explicit choice when it is still present, or
 * the only available restaurant. With two or more and no explicit choice,
 * nothing is selected until the owner picks one.
 */
export function selectedRestaurant<T extends { id: string }>(
  restaurants: readonly T[] | null,
  selectedId: string
): T | null {
  if (!restaurants || restaurants.length === 0) return null;
  return (
    restaurants.find((restaurant) => restaurant.id === selectedId) ??
    (restaurants.length === 1 ? (restaurants[0] ?? null) : null)
  );
}
