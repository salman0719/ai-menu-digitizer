/**
 * Client-side state for the R1 publish wizard.
 *
 * The draft itself already survives a round trip through the magic-link email
 * because it lives in IndexedDB. This module covers the rest of the form:
 * restaurant name, chosen restaurant, link and style are kept in
 * localStorage so signing in never makes the owner fill the form again.
 *
 * The helpers are pure except for the three storage functions, which fail
 * silently when storage is unavailable (private mode, quota, SSR).
 */

import { suggestRestaurantName } from "@/features/menu/menu-utils";
import type { MenuDocument } from "@/features/menu/schema";
import {
  DEFAULT_PREVIEW_LAYOUT_ID,
  DEFAULT_PREVIEW_THEME_ID,
  isPreviewLayoutId,
  isPreviewThemeId,
  type PreviewLayoutId,
  type PreviewThemeId,
} from "@/features/menu/preview-themes";
import type { RestaurantOption } from "@/features/tenancy/client";

import { slugifyMenuTitle } from "./slug";

export interface PublishWizardState {
  /** Only used to create a restaurant when the owner has none. */
  restaurantName: string;
  /** The owner's choice when they have more than one restaurant. */
  restaurantId: string;
  slug: string;
  theme: PreviewThemeId;
  layout: PreviewLayoutId;
}

const STORAGE_PREFIX = "eateryo:publish-wizard:";

/** Deep link for the wizard; also the magic-link return address. */
export function publishWizardPath(menuId: string): string {
  return `/menus/${encodeURIComponent(menuId)}/publish`;
}

export function wizardStorageKey(menuId: string): string {
  return `${STORAGE_PREFIX}${menuId}`;
}

/** Prefill the short form from the draft, with nothing invented. */
export function defaultWizardState(doc: Pick<MenuDocument, "title">): PublishWizardState {
  return {
    restaurantName: suggestRestaurantName([doc.title]) ?? "",
    restaurantId: "",
    slug: slugifyMenuTitle(doc.title),
    theme: DEFAULT_PREVIEW_THEME_ID,
    layout: DEFAULT_PREVIEW_LAYOUT_ID,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate stored state field by field instead of trusting the whole blob:
 * a single stale enum value must not discard the rest of the form.
 */
export function parseWizardState(value: unknown, fallback: PublishWizardState): PublishWizardState {
  if (!isRecord(value)) return fallback;
  return {
    restaurantName:
      typeof value.restaurantName === "string" ? value.restaurantName : fallback.restaurantName,
    restaurantId:
      typeof value.restaurantId === "string" ? value.restaurantId : fallback.restaurantId,
    slug: typeof value.slug === "string" ? value.slug : fallback.slug,
    theme: isPreviewThemeId(value.theme) ? value.theme : fallback.theme,
    layout: isPreviewLayoutId(value.layout) ? value.layout : fallback.layout,
  };
}

function browserStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadWizardState(menuId: string, fallback: PublishWizardState): PublishWizardState {
  const storage = browserStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(wizardStorageKey(menuId));
    if (!raw) return fallback;
    return parseWizardState(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
}

export function saveWizardState(menuId: string, state: PublishWizardState): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(wizardStorageKey(menuId), JSON.stringify(state));
  } catch {
    // Filling the form again is recoverable; failing the publish is not.
  }
}

export function clearWizardState(menuId: string): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.removeItem(wizardStorageKey(menuId));
  } catch {
    // Nothing to do: a stale form is harmless.
  }
}

/** Where the menu will land, given the account and the form. */
export type WizardRestaurantChoice =
  | { kind: "existing"; id: string; name: string }
  | { kind: "create"; name: string }
  | { kind: "choose" }
  | { kind: "missing" };

/**
 * The auto-provision rule in one place: an existing restaurant is always
 * preferred; a new one is only created when the owner has none and has
 * confirmed a name. Multiple restaurants without a choice ask instead of
 * guessing.
 */
export function resolveWizardRestaurant(
  state: Pick<PublishWizardState, "restaurantId" | "restaurantName">,
  owned: readonly RestaurantOption[]
): WizardRestaurantChoice {
  if (owned.length === 1 && owned[0]) {
    return { kind: "existing", id: owned[0].id, name: owned[0].name };
  }
  const selected = owned.find((candidate) => candidate.id === state.restaurantId);
  if (selected) {
    return { kind: "existing", id: selected.id, name: selected.name };
  }
  if (owned.length > 0) return { kind: "choose" };

  const name = state.restaurantName.trim();
  return name ? { kind: "create", name } : { kind: "missing" };
}
