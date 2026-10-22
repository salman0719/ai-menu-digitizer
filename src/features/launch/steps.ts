/**
 * The onboarding checklist: extract → review → theme → print table cards →
 * publish → first order.
 *
 * Five of the six steps are derived from real server state. Printing is the
 * exception — the server cannot see a printer — so that step is marked
 * `manual` and the browser remembers the tick, labelled as such. A checklist
 * that claims "done" for something we did not observe would be a lie.
 */

import type { LaunchSnapshot } from "./schema";

export const LAUNCH_STEP_IDS = [
  "extract",
  "review",
  "theme",
  "cards",
  "publish",
  "order",
] as const;

export type LaunchStepId = (typeof LAUNCH_STEP_IDS)[number];

export interface LaunchStep {
  id: LaunchStepId;
  title: string;
  /** What to do, in the owner's words. */
  guidance: string;
  /** Derived from server state, or ticked by the owner when `manual`. */
  done: boolean;
  /** True when only the browser can know this happened. */
  manual: boolean;
  /** Current state, e.g. "3 items still need a price". */
  detail: string;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function launchSteps(snapshot: LaunchSnapshot): LaunchStep[] {
  const hasMenu = snapshot.menuCount > 0;
  const reviewed = hasMenu && snapshot.unpricedItems === 0 && snapshot.reviewNotes === 0;
  const published = snapshot.publishedCount > 0;
  const reviewLeft = snapshot.unpricedItems + snapshot.reviewNotes;

  return [
    {
      id: "extract",
      title: "Turn a menu photo into a draft",
      guidance: "Upload or photograph your menu — one to four pages at a time.",
      done: hasMenu,
      manual: false,
      detail: hasMenu ? `${plural(snapshot.menuCount, "menu")} in your account` : "No menus yet",
    },
    {
      id: "review",
      title: "Check names and prices",
      guidance: "Fix anything the AI was unsure about. Nothing is published from this step.",
      done: reviewed,
      manual: false,
      detail: !hasMenu
        ? "Starts after your first extraction"
        : reviewLeft === 0
          ? "Every item has a price and no open review notes"
          : `${plural(reviewLeft, "item")} still need a look`,
    },
    {
      id: "theme",
      title: "Pick how the menu looks",
      guidance: "Preview the four themes and choose a layout; your choice is saved with the publish.",
      done: published,
      manual: false,
      detail: published ? "Saved with your published menu" : "Choose it in the preview",
    },
    {
      id: "cards",
      title: "Print the table cards",
      guidance: "Open the Tables tab and print one card per table; each card covers every open menu.",
      done: false,
      manual: true,
      detail: "Tick this on the device you printed from — we can't see your printer",
    },
    {
      id: "publish",
      title: "Publish the menu",
      guidance: "Publishing gives you a public link and a QR code anyone can scan.",
      done: published,
      manual: false,
      detail: snapshot.livePath ? `Live at ${snapshot.livePath}` : "Not published yet",
    },
    {
      id: "order",
      title: "Take your first table order",
      guidance: "Scan a table card and send an order — it lands on your board in a few seconds.",
      done: snapshot.orderCount > 0,
      manual: false,
      detail:
        snapshot.orderCount > 0
          ? `${plural(snapshot.orderCount, "order")} received`
          : "No orders yet",
    },
  ];
}

/** Steps the server can verify (the manual ones are excluded). */
export function verifiedProgress(steps: readonly LaunchStep[]): {
  done: number;
  total: number;
} {
  const verified = steps.filter((step) => !step.manual);
  return { done: verified.filter((step) => step.done).length, total: verified.length };
}
