/**
 * Derived menu helper types. The Zod schemas in `./schema` are canonical —
 * this file only adds small input/patch shapes used by edit helpers and,
 * later, the editor UI and API mapping. No competing representations.
 */

import type { MenuCategory, MenuDocument, MenuItem } from "./schema";

export type { MenuCategory, MenuDocument, MenuItem };
export type { MenuOption, MenuOptionChoice, MenuSource, MenuVariant } from "./schema";

/** Fields allowed when creating an item; `id`/`sortOrder` are assigned. */
export type NewItemInput = Pick<MenuItem, "name"> &
  Partial<Omit<MenuItem, "id" | "sortOrder" | "name">>;

/** Fields allowed when patching an item; `id`/`sortOrder` are immutable. */
export type ItemPatch = Partial<Omit<MenuItem, "id" | "sortOrder">>;

/** Fields allowed when creating a category; `id`/`sortOrder` are assigned. */
export type NewCategoryInput = Pick<MenuCategory, "name">;
