import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TableOrderTabs } from "@/components/order/table-order-tabs";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";

const doc = createSampleMenuDocument();

const base = { restaurantName: "Cafe", restaurantSlug: "cafe", tableLabel: "3" };

function render(props: Parameters<typeof TableOrderTabs>[0]) {
  return renderToStaticMarkup(createElement(TableOrderTabs, props));
}

describe("TableOrderTabs closed menus", () => {
  it("renders closed menus as disabled, inert tabs beside the open ones", () => {
    const html = render({
      ...base,
      menus: [{ menuId: "open-1", menuSlug: "lunch", title: "Lunch", doc }],
      closedMenus: [
        { menuId: "closed-1", title: "Dinner", availability: [{ days: [5, 6], start: "18:00", end: "22:00" }] },
      ],
    });
    // Open tab: selectable, with the All tab alongside.
    expect(html).toContain('aria-current="true"');
    expect(html).toContain(">All<");
    // Closed tab: present but marked disabled, with an honest label.
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-label="Dinner, closed right now"');
    // It must not be selectable: no aria-current on the disabled button.
    const disabledButton = html.match(/<button[^>]*aria-disabled="true"[^>]*>/)?.[0] ?? "";
    expect(disabledButton).toContain("cursor-not-allowed");
    expect(disabledButton).not.toContain("aria-current");
    // The reveal strip is hidden until hover/press.
    expect(html).not.toContain("is closed right now");
    // Closed menus never enter search scope or the cart: no reference to them.
    expect(html).not.toContain("closed-1");
  });

  it("hides search and the All tab when nothing is open", () => {
    const html = render({
      ...base,
      menus: [],
      closedMenus: [
        { menuId: "closed-1", title: "Dinner", availability: [{ days: [5], start: "18:00", end: "22:00" }] },
      ],
    });
    expect(html).not.toContain(">All<");
    expect(html).not.toContain('type="search"');
    expect(html).toContain("Nothing to order at the moment");
    expect(html).toContain('aria-label="Dinner, closed right now"');
  });
});
