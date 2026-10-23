"use client";

/**
 * Multi-menu table ordering (Step 3c): `/r/<restaurant>/t/<table>`.
 *
 * The diner sees one tab per open menu plus an "All" tab showing everything
 * at once, a search box filtering dish names and descriptions, and a single
 * shared cart. One "Send order" posts a combined ticket — each line remembers
 * its menu, and the server re-prices every line from the right snapshot.
 *
 * Menu presentation reuses `OrderMenuSection` (the same list both the local
 * and single-menu server flows render), and search reuses the editor's
 * `searchMenu` matching so filtering behaves identically everywhere.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { MenuAvailability } from "@/features/availability/schema";
import { formatAvailability } from "@/features/availability/format";
import type { MenuDocument, MenuItem } from "@/features/menu/schema";
import { searchMenu, type SearchMatch } from "@/features/menu/search";
import { formatPreviewPrice } from "@/features/menu/preview-utils";
import { placeOrder } from "@/features/orders/client";
import {
  addLine,
  orderCode,
  orderTotal,
  setLineQuantity,
  type Order,
  type OrderLine,
} from "@/features/orders/schema";
import { SyncError } from "@/features/menus/sync";
import { formatTableLabel } from "@/features/orders/table-links";

import { OrderMenuSection, OrderShell, StickyCartBar, formatOrderTotal } from "./order-menu";

/** One open menu on the table landing (serializable for the client). */
export interface TableOrderMenu {
  menuId: string;
  menuSlug: string;
  title: string;
  doc: MenuDocument;
}

/**
 * A live menu that is published but not being served at the diner's visit:
 * shown in the tab row as a disabled entry so they know it exists, and
 * kept out of the tab scope, the search and the cart.
 */
export interface ClosedTableOrderMenu {
  menuId: string;
  title: string;
  availability: MenuAvailability;
}

/** Where a closed menu's tooltip sits: viewport coords measured on reveal. */
interface ClosedInfo {
  menuId: string;
  x: number;
  y: number;
  above: boolean;
}

const ALL_TAB = "all";

interface TableOrderTabsProps {
  restaurantName: string;
  restaurantSlug: string;
  tableLabel: string;
  menus: TableOrderMenu[];
  closedMenus: ClosedTableOrderMenu[];
}

function menuLabel(menu: { title: string }): string {
  return menu.title.trim() || "Untitled menu";
}

export function TableOrderTabs({
  restaurantName,
  restaurantSlug,
  tableLabel,
  menus,
  closedMenus,
}: TableOrderTabsProps) {
  const [activeTab, setActiveTab] = useState<string>(ALL_TAB);
  const [query, setQuery] = useState("");
  const [closedInfo, setClosedInfo] = useState<ClosedInfo | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [note, setNote] = useState("");
  const [variantChoice, setVariantChoice] = useState<Record<string, string>>({});
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState<Order | null>(null);

  const searching = query.trim().length > 0;

  /** The closed menu whose opening times are currently revealed, if any. */
  const infoMenu =
    closedInfo === null ? null : closedMenus.find((menu) => menu.menuId === closedInfo.menuId) ?? null;

  /**
   * Reveal a closed menu's opening times as a fixed-position tooltip: it
   * floats over the page, so revealing never shifts the layout, and it
   * cannot be clipped by the horizontally scrolling tab row. Anchored to
   * the tab, flipped above when there is no room below, and clamped to the
   * viewport edges.
   */
  function showClosedInfo(menu: ClosedTableOrderMenu, anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    // Half of the 16rem tooltip plus breathing room, used to clamp x.
    const half = 136;
    const x = Math.min(
      Math.max(rect.left + rect.width / 2, half),
      Math.max(window.innerWidth - half, half)
    );
    const belowY = rect.bottom + 8;
    const roomBelow = belowY + 76 <= window.innerHeight;
    setClosedInfo({
      menuId: menu.menuId,
      x,
      y: roomBelow ? belowY : rect.top - 8,
      above: !roomBelow,
    });
  }

  function hideClosedInfo() {
    setClosedInfo(null);
  }

  // While the tooltip is up: dismiss on Escape, on any press outside the
  // closed tabs, and on any scroll (the anchor would move under it).
  const tooltipVisible = closedInfo !== null;
  useEffect(() => {
    if (!tooltipVisible) return;
    const hide = () => setClosedInfo(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-closed-tab]")) return;
      hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onScroll = () => hide();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [tooltipVisible]);

  /** Menus in scope for the visible list: the tab, or every menu on All. */
  const scopedMenus = useMemo(
    () => (activeTab === ALL_TAB ? menus : menus.filter((menu) => menu.menuId === activeTab)),
    [activeTab, menus]
  );

  /** Filtered categories per in-scope menu (search matches like the editor). */
  const filtered = useMemo(
    () =>
      scopedMenus.map((menu) => ({
        menu,
        result: searchMenu(menu.doc, query),
      })),
    [scopedMenus, query]
  );

  const visibleCount = filtered.reduce((sum, entry) => sum + entry.result.matchCount, 0);

  const total = orderTotal(lines);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const showMenuBadges = menus.length > 1;

  /**
   * One menu means no navigation: the tab row (All + one identical tab)
   * collapses to just search, and a lone closed menu states its hours
   * inline instead of hiding them behind a tab. Closed menus count here —
   * a single out-of-hours menu is still "the menu" to the diner.
   */
  const singleMenu = menus.length + closedMenus.length <= 1;
  const onlyClosedMenu = singleMenu && menus.length === 0 ? closedMenus[0] ?? null : null;

  function choiceKey(menuId: string, itemId: string): string {
    return `${menuId}:${itemId}`;
  }

  /**
   * The variant map `OrderMenuSection` reads, scoped to one menu: choices
   * are stored under `choiceKey` (two menus can hold the same item id),
   * but the list reads plain item ids — passing the raw map left the
   * dropdown stuck on the first variant while adding still used the
   * stored (correct) one.
   */
  function scopedVariantChoice(menuId: string, items: MenuItem[]): Record<string, string> {
    const scoped: Record<string, string> = {};
    for (const item of items) {
      const chosen = variantChoice[choiceKey(menuId, item.id)];
      if (chosen !== undefined) scoped[item.id] = chosen;
    }
    return scoped;
  }

  function chosenVariantName(menu: TableOrderMenu, item: MenuItem): string | null {
    if (item.variants.length === 0) return null;
    const chosen = variantChoice[choiceKey(menu.menuId, item.id)];
    if (chosen && item.variants.some((variant) => variant.name === chosen)) return chosen;
    return item.variants[0]?.name ?? null;
  }

  function addItem(menu: TableOrderMenu, item: MenuItem) {
    const variantName = chosenVariantName(menu, item);
    const variant = variantName ? item.variants.find((v) => v.name === variantName) : null;
    setLines((current) =>
      addLine(current, {
        menuItemId: item.id,
        name: item.name,
        variantName,
        unitPrice: variant ? variant.price : item.price,
        menuId: menu.menuId,
        menuTitle: menu.title,
      })
    );
    setError(null);
  }

  function menuSlugForLine(line: OrderLine): string | null {
    return menus.find((menu) => menu.menuId === line.menuId)?.menuSlug ?? null;
  }

  async function sendOrder() {
    if (lines.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const order = await placeOrder({
        restaurantSlug,
        tableLabel,
        note: note.trim() ? note : null,
        lines: lines.map((line) => {
          const menuSlug = menuSlugForLine(line);
          if (!menuSlug) throw new Error("A line names a menu that is no longer open.");
          return {
            menuSlug,
            menuItemId: line.menuItemId,
            variantName: line.variantName,
            quantity: line.quantity,
          };
        }),
        website: honeypot,
      });
      setPlaced(order);
      setLines([]);
      setNote("");
    } catch (submitError: unknown) {
      setError(
        submitError instanceof SyncError
          ? submitError.code === "not_found"
            ? "This table link is no longer live. Ask staff for the current QR code."
            : submitError.message
          : submitError instanceof Error && submitError.message.includes("no longer open")
            ? "One of these menus just closed. Send what is still open, or start over."
            : "The order could not be sent. Check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const frame = "rounded-2xl border border-stone-200 bg-white";

  if (placed) {
    return (
      <OrderShell tableLabel={tableLabel}>
        <div className={`${frame} p-8 text-center`}>
          <p className="text-sm font-semibold tracking-wider text-green-800 uppercase">
            Order received
          </p>
          <p className="mt-3 text-2xl font-bold text-stone-900">
            #{orderCode(placed.id)} · {formatTableLabel(placed.tableLabel)}
          </p>
          <p className="mt-2 text-sm text-stone-600">
            {placed.lines.length} {placed.lines.length === 1 ? "line" : "lines"} ·{" "}
            {formatOrderTotal(placed.currency, orderTotal(placed.lines))}
          </p>
          <p className="mx-auto mt-4 max-w-md text-xs leading-5 text-stone-500">
            The kitchen sees this on their board right away. The total is confirmed when your order
            is prepared.
          </p>
          <button
            type="button"
            onClick={() => setPlaced(null)}
            className="mt-5 rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800"
          >
            Order something else
          </button>
        </div>
      </OrderShell>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <nav aria-label={singleMenu ? "Search the menu" : "Menus"} className={`${frame} p-3`}>
          {!singleMenu && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {menus.length > 0 && (
                <TabButton
                  active={activeTab === ALL_TAB}
                  onClick={() => {
                    hideClosedInfo();
                    setActiveTab(ALL_TAB);
                  }}
                  label="All"
                />
              )}
              {menus.map((menu) => (
                <TabButton
                  key={menu.menuId}
                  active={activeTab === menu.menuId}
                  onClick={() => {
                    hideClosedInfo();
                    setActiveTab(menu.menuId);
                  }}
                  label={menuLabel(menu)}
                />
              ))}
              {closedMenus.map((menu) => (
                <ClosedTabButton
                  key={menu.menuId}
                  menu={menu}
                  show={closedInfo?.menuId === menu.menuId}
                  onShow={(anchor) => showClosedInfo(menu, anchor)}
                  onHide={hideClosedInfo}
                />
              ))}
            </div>
          )}
          {onlyClosedMenu ? (
            <div>
              <p className="text-sm font-semibold text-stone-900">
                {menuLabel(onlyClosedMenu)} is closed right now
              </p>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                Open {formatAvailability(onlyClosedMenu.availability).join("; ")}.
              </p>
            </div>
          ) : menus.length > 0 ? (
            <>
              <label className={!singleMenu ? "mt-2 block" : "block"}>
                <span className="sr-only">Search dishes</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={
                    singleMenu
                      ? "Search dishes…"
                      : `Search across ${activeTab === ALL_TAB ? "all menus" : "this menu"}…`
                  }
                  className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm focus:border-amber-700 focus:outline-none"
                />
              </label>
              {searching && (
                <p className="mt-2 text-xs text-stone-500" role="status">
                  {visibleCount === 0
                    ? `No dishes match “${query.trim()}”.`
                    : `${visibleCount} ${visibleCount === 1 ? "dish" : "dishes"} match “${query.trim()}”.`}
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-xs text-stone-500">
              Nothing to order at the moment — tap a menu to see when it opens.
            </p>
          )}
        </nav>

        {menus.length === 0 ? (
          <div className={`${frame} p-8 text-center`}>
            <p className="text-lg font-semibold text-stone-900">Nothing is open right now</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">
              {singleMenu
                ? "The kitchen is between services — opening hours are shown above."
                : "Every menu is between services — tap one above to see when it opens."}
            </p>
          </div>
        ) : visibleCount === 0 ? (
          <div className={`${frame} p-8 text-center`}>
            <p className="text-lg font-semibold text-stone-900">No dishes match</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">
              Nothing on {activeTab === ALL_TAB ? "these menus" : "this menu"} matches “
              {query.trim()}”. Try a shorter search,{" "}
              {singleMenu ? "or clear it to browse the whole menu." : "or browse the tabs above."}
            </p>
          </div>
        ) : (
          filtered.map(({ menu, result }) =>
            result.categories.length === 0 ? null : (
              <div key={menu.menuId} className="flex flex-col gap-4">
                {activeTab === ALL_TAB && menus.length > 1 && (
                  <h2 className="px-1 text-sm font-bold tracking-wider text-stone-500 uppercase">
                    {menuLabel(menu)}
                  </h2>
                )}
                {result.categories.map((match: SearchMatch) => (
                  <OrderMenuSection
                    key={`${menu.menuId}:${match.category.id}`}
                    category={{ ...match.category, items: match.items }}
                    currency={menu.doc.currency}
                    variantChoice={scopedVariantChoice(menu.menuId, match.items)}
                    onVariantChange={(itemId, name) =>
                      setVariantChoice((current) => ({
                        ...current,
                        [choiceKey(menu.menuId, itemId)]: name,
                      }))
                    }
                    onAdd={(item) => addItem(menu, item)}
                    itemCount={(item, variantName) =>
                      lines.find(
                        (line) =>
                          line.menuId === menu.menuId &&
                          line.menuItemId === item.id &&
                          (line.variantName ?? null) === (variantName ?? null)
                      )?.quantity ?? 0
                    }
                  />
                ))}
              </div>
            )
          )
        )}
      </div>

      <aside
        id="your-order"
        className={`${frame} h-fit scroll-mt-4 p-5 lg:sticky lg:top-4`}
        aria-label="Your order"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-stone-900">Your order</h2>
          <span className="text-xs font-medium text-stone-500">
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </span>
        </div>

        {lines.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
            Nothing added yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100">
            {lines.map((line, index) => (
              <li key={`${line.menuId ?? ""}:${line.menuItemId}-${line.variantName ?? "base"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 text-sm font-medium text-stone-900">
                    <span className="block truncate">
                      {line.name}
                      {line.variantName && (
                        <span className="ml-1 text-xs font-normal text-stone-500">
                          {line.variantName}
                        </span>
                      )}
                    </span>
                    {showMenuBadges && line.menuTitle && (
                      <span className="mt-0.5 inline-block rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-600">
                        {line.menuTitle.trim() || "Menu"}
                      </span>
                    )}
                  </p>
                  <p className="shrink-0 text-sm tabular-nums text-stone-800">
                    {line.unitPrice === null
                      ? "—"
                      : formatPreviewPrice(line.unitPrice * line.quantity, null, null)}
                  </p>
                </div>
                <div className="mt-1.5 flex items-center gap-2 pb-3">
                  <button
                    type="button"
                    aria-label={`Decrease ${line.name}`}
                    onClick={() => setLines((current) => setLineQuantity(current, index, line.quantity - 1))}
                    className="h-7 w-7 rounded-full border border-stone-300 text-sm font-semibold text-stone-700 hover:border-amber-700"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                  <button
                    type="button"
                    aria-label={`Increase ${line.name}`}
                    onClick={() => setLines((current) => setLineQuantity(current, index, line.quantity + 1))}
                    className="h-7 w-7 rounded-full border border-stone-300 text-sm font-semibold text-stone-700 hover:border-amber-700"
                  >
                    +
                  </button>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => setLines((current) => setLineQuantity(current, index, 0))}
                    className="text-xs font-medium text-stone-500 underline hover:text-red-800"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-2 text-xs text-stone-500">
          {restaurantName} · {formatTableLabel(tableLabel)}
        </p>

        <label htmlFor="order-note" className="mt-3 block text-xs font-semibold text-stone-600">
          Note for the kitchen (optional)
        </label>
        <textarea
          id="order-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={280}
          placeholder="Allergies, no onions…"
          className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm focus:border-amber-700 focus:outline-none"
        />

        <label aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
          Website
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(event) => setHoneypot(event.target.value)}
          />
        </label>

        <div className="mt-4 flex items-baseline justify-between border-t border-stone-200 pt-3">
          <p className="text-sm font-medium text-stone-600">Total</p>
          <p className="text-lg font-bold tabular-nums text-stone-900">
            {formatOrderTotal(
              distinctCurrency(menus.map((menu) => menu.doc)),
              total
            )}
          </p>
        </div>
        {total === null && lines.length > 0 && (
          <p className="mt-1 text-xs text-amber-800">
            Some items have no price on the menu, so no total is shown. Staff confirm the price.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={lines.length === 0 || submitting}
          onClick={() => void sendOrder()}
          className="mt-4 w-full rounded-full bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-40"
        >            {submitting ? "Sending…" : "Send order to the kitchen"}
          </button>
      </aside>
        <StickyCartBar
          itemCount={itemCount}
          total={total}
          currency={distinctCurrency(menus.map((menu) => menu.doc))}
        />

      {closedInfo &&
        infoMenu &&
        createPortal(
          <div
            role="status"
            className="pointer-events-none fixed z-50"
            style={{
              left: closedInfo.x,
              top: closedInfo.y,
              transform: closedInfo.above ? "translate(-50%, -100%)" : "translateX(-50%)",
            }}
          >
            <div
              role="tooltip"
              className="w-max max-w-[16rem] rounded-xl bg-stone-900 px-3 py-2 text-left text-xs leading-5 text-white shadow-lg"
            >
              <span className="font-semibold">{menuLabel(infoMenu)}</span> is closed right now.
              Open {formatAvailability(infoMenu.availability).join("; ")}.
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

/** One currency for the ticket when every menu agrees, else an em dash. */
function distinctCurrency(docs: MenuDocument[]): string | null {
  const values = new Set(docs.map((doc) => doc.currency));
  if (values.size !== 1) return null;
  return docs[0]?.currency ?? null;
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ${
        active
          ? "bg-stone-900 text-white"
          : "border border-stone-300 text-stone-700 hover:border-amber-700 hover:text-amber-900"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * A published menu that is not being served now: listed in the tab row
 * but inert — pressing it never selects a tab, so it stays out of the
 * search scope and the cart by construction. Hovering with a mouse or
 * pressing it (touch or keyboard) reveals when it opens, as a floating
 * tooltip anchored to the tab. Pointer type decides the press behaviour:
 * a tap toggles the tooltip, while a mouse click only keeps it shown, so
 * hover-then-click never flickers it away.
 */
function ClosedTabButton({
  menu,
  show,
  onShow,
  onHide,
}: {
  menu: ClosedTableOrderMenu;
  show: boolean;
  onShow: (anchor: HTMLElement) => void;
  onHide: () => void;
}) {
  const lastPointerType = useRef<string | null>(null);
  const label = menuLabel(menu);
  return (
    <button
      type="button"
      data-closed-tab=""
      aria-disabled="true"
      aria-label={`${label}, closed right now`}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") onShow(event.currentTarget);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") onHide();
      }}
      onPointerDown={(event) => {
        lastPointerType.current = event.pointerType;
      }}
      onClick={(event) => {
        if (lastPointerType.current === "mouse" || !show) onShow(event.currentTarget);
        else onHide();
      }}
      className={`shrink-0 cursor-not-allowed rounded-full border border-dashed px-4 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ${
        show
          ? "border-stone-400 bg-white text-stone-600"
          : "border-stone-300 bg-stone-50 text-stone-400"
      }`}
    >
      {label}
    </button>
  );
}
