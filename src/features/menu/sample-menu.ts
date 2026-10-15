/**
 * Demo menu fixture. This is NOT AI output — it is hand-written sample data
 * for developing the editor and for demo mode when no API key is configured.
 * Identify it via `source.provider === DEMO_PROVIDER` and label it as demo
 * in the UI. Never present it as an extraction result.
 */

import type { MenuDocument } from "./schema";
import { addCategory, addItem, createMenuDocument } from "./menu-utils";

export const DEMO_PROVIDER = "demo";

/** Build a fresh sample document on every call (no shared mutable state). */
export function createSampleMenuDocument(): MenuDocument {
  let doc = createMenuDocument({ title: "Sunny Side Café", currency: "USD" });

  doc = addCategory(doc, { name: "Espresso & Coffee" });
  doc = addCategory(doc, { name: "Breakfast" });
  const [coffeeId, breakfastId] = doc.categories.map((c) => c.id);

  doc = addItem(doc, coffeeId, {
    name: "Espresso",
    description: "Double shot, syrupy and bright.",
    price: 3.0,
    variants: [
      { name: "Single", price: 2.5 },
      { name: "Double", price: 3.0 },
    ],
  });
  doc = addItem(doc, coffeeId, {
    name: "Oat Milk Latte",
    description: "Espresso with steamed oat milk.",
    price: 4.5,
    // Shown with a "(ve)" symbol on the sample menu.
    dietaryLabels: ["vegan"],
    options: [{ name: "Size", choices: [{ name: "Regular", priceDelta: null }] }],
  });
  doc = addItem(doc, breakfastId, {
    name: "Avocado Toast",
    description: "Sourdough, smashed avocado, chilli flakes.",
    price: 8.5,
    available: false,
    reviewNotes: ["Shown with a sold-out sticker on the sample menu — verify."],
  });
  doc = addItem(doc, breakfastId, {
    name: "Seasonal Special",
    description: null,
    // Priced as "market price" on the sample menu: honestly unknown.
    price: null,
    reviewNotes: ["Price shown as “market price” — enter the actual price."],
  });

  return { ...doc, source: { provider: DEMO_PROVIDER } };
}
