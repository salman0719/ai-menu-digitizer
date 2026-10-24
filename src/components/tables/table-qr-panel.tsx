"use client";

/**
 * Printable table cards for one restaurant.
 *
 * One QR code per table, not per menu: when the restaurant has claimed its
 * `/r/<slug>` link, every code encodes `{origin}/r/<slug>/t/<label>` — the
 * table landing that shows every currently-open menu, so a scanned code
 * works on any phone (Steps 1–4). The panel has two homes: the
 * restaurant-level Tables tab (`context="restaurant"`, the canonical one)
 * and a menu editor (`context="menu"`), where it is only the fallback for a
 * menu that exists only in this browser.
 *
 * Fallbacks preserve the older flows: a browser-only menu keeps the Phase 1
 * `{origin}/order?menu=<menuId>&table=<label>` codes (this device's storage
 * only), and an account menu the panel cannot resolve right now keeps its
 * own public `/r/<restaurant>/m/<menu>/order` code. Per-menu codes are
 * currently switched off (see ENABLE_MENU_QR_LINKS below) — the generation
 * code stays so they can be re-enabled.
 *
 * Claiming is one tap for the owner; staff see cards but never the claim
 * button. Codes are generated in the browser (no third-party image API);
 * slugs and table labels are not sensitive either way.
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";

import type { MenuDocument } from "@/features/menu/schema";
import { fetchServerMenus } from "@/features/menus/sync";
import { SyncError } from "@/features/menus/sync";
import {
  defaultTableLabels,
  displayTableUrl,
  formatTableLabel,
  MAX_TABLE_LABEL_LENGTH,
  MAX_TABLES,
  normalizeTableLabel,
  publicTableOrderUrl,
  restaurantTableUrl,
  sanitizeTableLabels,
  tableOrderUrl,
} from "@/features/orders/table-links";
import { fetchRestaurants } from "@/features/tenancy/client";
import { ensureRestaurantLink, fetchRestaurantLink } from "@/features/tables/client";

const COUNT_STORAGE_KEY = "table-qr-count";
const PREFIX_STORAGE_KEY = "table-qr-prefix";
const LABELS_STORAGE_KEY = "table-qr-labels";
const CUSTOM_FLAG_KEY = "table-qr-custom";

/**
 * Kill switch for per-menu table codes from the menu editor's Table QR view.
 * The direction is one code per table scoped to the restaurant
 * (`/r/<slug>/t/<label>`, printed from the Tables tab), so the per-menu
 * codes (`/order?menu=…` and `/r/…/m/…/order`) are disabled for now. Nothing
 * is removed: flip this back to `true` to re-enable the menu-page codes.
 */
const ENABLE_MENU_QR_LINKS: boolean = false;

type TableQrPanelProps =
  | {
      /** Menu editor: codes fall back to this menu when no restaurant link is live. */
      context: "menu";
      doc: MenuDocument;
      /** This menu's own public address; the fallback code target when no table link is live. */
      publicRestaurantSlug?: string | null;
      publicSlug?: string | null;
      menuId: string;
      syncMode: "local" | "account";
      canManage?: boolean;
    }
  | {
      /** Tables tab: the cards belong to the restaurant, never to one menu. */
      context: "restaurant";
      restaurantId: string;
      restaurantName: string;
      /** Owners may claim the link; staff print cards but never claim it. */
      isOwner: boolean;
    };

interface TableCode {
  label: string;
  url: string;
  dataUrl: string;
}

type LinkState =
  | { status: "local" }
  | { status: "loading" }
  | { status: "legacy" }
  | { status: "unclaimed"; restaurantId: string; restaurantName: string; isOwner: boolean }
  | { status: "live"; restaurantName: string; slug: string }
  | { status: "unavailable"; message: string };

function readStored(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* preference only — the session value still applies */
  }
}

export function TableQrPanel(props: TableQrPanelProps) {
  // One panel, two homes: the Tables tab knows its restaurant up front,
  // while a menu editor has to resolve it from the open menu.
  const doc = props.context === "menu" ? props.doc : null;
  const menuId = props.context === "menu" ? props.menuId : null;
  const publicSlug = props.context === "menu" ? (props.publicSlug ?? null) : null;
  const publicRestaurantSlug =
    props.context === "menu" ? (props.publicRestaurantSlug ?? null) : null;
  const syncMode: "local" | "account" = props.context === "menu" ? props.syncMode : "account";
  const canManage = props.context === "menu" ? (props.canManage ?? true) : props.isOwner;
  const restaurantId = props.context === "restaurant" ? props.restaurantId : null;
  const restaurantName = props.context === "restaurant" ? props.restaurantName : null;
  const isOwner = props.context === "restaurant" ? props.isOwner : false;
  /** Table names are a venue preference, so the Tables tab scopes them. */
  const storageSuffix = restaurantId ? `:${restaurantId}` : "";
  const countKey = `${COUNT_STORAGE_KEY}${storageSuffix}`;
  const prefixKey = `${PREFIX_STORAGE_KEY}${storageSuffix}`;
  const labelsKey = `${LABELS_STORAGE_KEY}${storageSuffix}`;
  const customFlagKey = `${CUSTOM_FLAG_KEY}${storageSuffix}`;

  // Origin is only available in the browser; codes are generated after mount,
  // so the server-rendered shell never depends on it.
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const [count, setCount] = useState(() => {
    const stored = Number(readStored(countKey, "8"));
    return Number.isInteger(stored) && stored >= 1 && stored <= MAX_TABLES ? stored : 8;
  });
  const [prefix, setPrefix] = useState(() => readStored(prefixKey, "Table"));
  /**
   * Explicit per-table names. Null means "generate from count + prefix";
   * a list means the owner pressed "Edit table names" and owns each row.
   */
  const [custom, setCustom] = useState<string[] | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      if (window.localStorage.getItem(customFlagKey) !== "1") return null;
      const parsed = sanitizeTableLabels(
        JSON.parse(window.localStorage.getItem(labelsKey) ?? "[]") as string[]
      );
      return parsed.length > 0 ? parsed : null;
    } catch {
      return null;
    }
  });
  const [codes, setCodes] = useState<TableCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** One table shown large for a demo; empty shows the whole sheet. */
  const [focusLabel, setFocusLabel] = useState("");
  /** The card name being renamed inline; while set, printing is paused. */
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [linkState, setLinkState] = useState<LinkState>(
    restaurantId || syncMode === "account" ? { status: "loading" } : { status: "local" }
  );
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const labels = custom ?? defaultTableLabels(count, prefix.trim());
  const focusedLabel = labels.includes(focusLabel) ? focusLabel : null;
  const visibleCodes = focusedLabel ? codes.filter((code) => code.label === focusedLabel) : codes;

  // Resolve the restaurant link. The Tables tab is handed the restaurant id;
  // a menu editor walks menu → restaurant → `/r/<slug>`. Anything the menu
  // context cannot resolve keeps the older per-menu codes (the `legacy`
  // path) so printing never dead-ends offline.
  useEffect(() => {
    if (restaurantId) {
      let cancelled = false;
      void (async () => {
        try {
          const link = await fetchRestaurantLink(restaurantId);
          if (cancelled) return;
          if (link.slug) {
            setLinkState({ status: "live", restaurantName: link.name, slug: link.slug });
          } else {
            setLinkState({
              status: "unclaimed",
              restaurantId: link.id,
              restaurantName: link.name,
              isOwner,
            });
          }
        } catch (loadError: unknown) {
          if (cancelled) return;
          setLinkState({
            status: "unavailable",
            message:
              loadError instanceof SyncError ? loadError.message : "Could not reach the account.",
          });
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    if (syncMode !== "account") return;
    let cancelled = false;
    (async () => {
      try {
        const [serverMenus, restaurants] = await Promise.all([
          fetchServerMenus(),
          fetchRestaurants(),
        ]);
        const summary = serverMenus.find((menu) => menu.id === menuId);
        const restaurant = summary
          ? restaurants.find((candidate) => candidate.id === summary.restaurantId)
          : undefined;
        if (!summary || !restaurant) {
          if (!cancelled) setLinkState({ status: "legacy" });
          return;
        }
        const link = await fetchRestaurantLink(restaurant.id);
        if (cancelled) return;
        if (link.slug) {
          setLinkState({ status: "live", restaurantName: link.name, slug: link.slug });
        } else {
          setLinkState({
            status: "unclaimed",
            restaurantId: link.id,
            restaurantName: link.name,
            isOwner: restaurant.role === "owner",
          });
        }
      } catch (loadError: unknown) {
        if (cancelled) return;
        setLinkState({
          status: "unavailable",
          message:
            loadError instanceof SyncError ? loadError.message : "Could not reach the account.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // publicSlug intentionally excluded: resolving the restaurant must not
    // depend on this menu's publication state.
  }, [restaurantId, isOwner, syncMode, menuId]);

  const tableSlug = linkState.status === "live" ? linkState.slug : null;
  const cardEyebrow =
    linkState.status === "live" || linkState.status === "unclaimed"
      ? linkState.restaurantName
      : (doc?.title ?? restaurantName ?? "");

  useEffect(() => {
    if (!origin) return;
    // The Tables tab has no per-menu fallback: until the link is claimed
    // there is nothing honest to encode.
    if (restaurantId && !tableSlug) return;
    let cancelled = false;
    const labels = custom ?? defaultTableLabels(count, prefix.trim());
    Promise.all(
      labels.map(async (label) => {
        // Per-menu codes are switched off (ENABLE_MENU_QR_LINKS): only a live
        // restaurant link encodes cards from a menu page. The per-menu
        // branches stay so the flow can be re-enabled.
        const url = tableSlug
          ? restaurantTableUrl(origin, tableSlug, label)
          : ENABLE_MENU_QR_LINKS && publicSlug && publicRestaurantSlug
            ? publicTableOrderUrl(origin, publicRestaurantSlug, publicSlug, label)
            : ENABLE_MENU_QR_LINKS && menuId
              ? tableOrderUrl(origin, menuId, label)
              : null;
        if (!url) return null;
        const dataUrl = await QRCode.toDataURL(url, {
          width: 320,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#1c1917", light: "#ffffff" },
        });
        return { label, url, dataUrl };
      })
    )
      .then((result) => {
        if (!cancelled) setCodes(result.filter((code): code is TableCode => code !== null));
      })
      .catch(() => {
        if (!cancelled) setError("Could not generate the QR codes in this browser.");
      });
    return () => {
      cancelled = true;
    };
  }, [origin, count, prefix, custom, menuId, publicSlug, publicRestaurantSlug, tableSlug, restaurantId]);

  useEffect(() => {
    if (custom) {
      writeStored(labelsKey, JSON.stringify(sanitizeTableLabels(custom)));
      writeStored(customFlagKey, "1");
    }
  }, [custom, labelsKey, customFlagKey]);

  async function handleClaim(restaurantId: string, restaurantName: string) {
    if (claiming) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const link = await ensureRestaurantLink(restaurantId, restaurantName);
      if (link.slug) {
        setLinkState({ status: "live", restaurantName: link.name, slug: link.slug });
      } else {
        setClaimError("The link could not be claimed. Try again.");
      }
    } catch (claimFailure: unknown) {
      setClaimError(
        claimFailure instanceof SyncError ? claimFailure.message : "The link could not be claimed."
      );
    } finally {
      setClaiming(false);
    }
  }

  function changeCount(next: number) {
    const clamped = Math.min(Math.max(Math.trunc(next) || 1, 1), MAX_TABLES);
    setCount(clamped);
    setFocusLabel("");
    setEditingLabel(null);
    writeStored(countKey, String(clamped));
  }

  function changePrefix(next: string) {
    setPrefix(next.slice(0, MAX_TABLE_LABEL_LENGTH - 3));
    setFocusLabel("");
    setEditingLabel(null);
    writeStored(prefixKey, next.slice(0, MAX_TABLE_LABEL_LENGTH - 3));
  }

  function resetNames() {
    setCustom(null);
    setEditingLabel(null);
    setFocusLabel("");
    try {
      window.localStorage.removeItem(customFlagKey);
    } catch {
      /* preference only */
    }
  }

  function startEditing(label: string) {
    setEditingLabel(label);
    setDraft(label);
  }

  function cancelEditing() {
    setEditingLabel(null);
  }

  function commitEditing() {
    const target = editingLabel;
    setEditingLabel(null);
    if (!target) return;
    const clean = normalizeTableLabel(draft);
    // Empty or duplicate names revert instead of breaking cards.
    if (!clean || clean === target) return;
    if (focusLabel === target) setFocusLabel(clean);
    setCustom((prev) => {
      const base = prev ?? defaultTableLabels(count, prefix.trim());
      if (base.includes(clean)) return prev;
      return base.map((label) => (label === target ? clean : label));
    });
  }

  const resolvingLink = linkState.status === "loading";
  /**
   * Per-menu codes are switched off (see ENABLE_MENU_QR_LINKS): on a menu
   * page with no live restaurant link there is nothing honest to encode, so
   * the sheet is replaced with a pointer to the Tables tab.
   * Restaurant-scoped cards (`tableSlug`) are unaffected.
   */
  const menuLinksDisabled =
    !ENABLE_MENU_QR_LINKS && props.context === "menu" && !tableSlug && !resolvingLink;

  return (
    <div className="flex flex-col gap-4">
      {linkState.status === "unclaimed" ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-5 text-center">
          <p className="text-base font-bold text-stone-900">
            One link for every table at {linkState.restaurantName}
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-stone-600">
            Table cards point at your restaurant link —{" "}
            <code className="rounded bg-white px-1.5 py-0.5">/r/…/t/3</code> — where diners see
            every menu that is open right now. Claim it once, then print the cards below.
          </p>
          {linkState.isOwner && canManage ? (
            <>
              <button
                type="button"
                onClick={() => void handleClaim(linkState.restaurantId, linkState.restaurantName)}
                disabled={claiming}
                className="mt-3 rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {claiming ? "Claiming…" : "Claim your restaurant link"}
              </button>
              {claimError && (
                <p
                  role="alert"
                  className="mx-auto mt-2 max-w-md rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800"
                >
                  {claimError}
                </p>
              )}
            </>
          ) : (
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-stone-600">
              The link isn&apos;t claimed yet — ask the restaurant owner to claim it from their
              sign-in, then the cards can be printed.
            </p>
          )}
        </div>
      ) : restaurantId && !tableSlug ? (
        <p
          data-print-hide
          role={linkState.status === "unavailable" ? "alert" : "status"}
          className={
            linkState.status === "unavailable"
              ? "rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"
              : "text-xs text-stone-500"
          }
        >
          {linkState.status === "loading"
            ? "Finding your restaurant link…"
            : linkState.status === "unavailable"
              ? `${linkState.message} Table cards need the restaurant link — try again when you're back online.`
              : "Table cards will appear here once the restaurant link is live."}
        </p>
      ) : menuLinksDisabled ? (
        <p
          data-print-hide
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"
        >
          <span className="font-bold">Table codes moved.</span> This menu no longer prints
          its own table cards — print them from the Tables tab instead, where one code per
          table covers the whole restaurant.
        </p>
      ) : (
        <>
          <div
            data-print-hide
            className="flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200 bg-white p-4"
          >
            <label className="text-xs font-semibold text-stone-600">
              Tables
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_TABLES}
                value={count}
                disabled={custom !== null}
                title={
                  custom
                    ? "You renamed tables by hand — reset the names to use count + prefix again."
                    : undefined
                }
                onChange={(event) => changeCount(Number(event.target.value))}
                className="mt-1 block w-24 rounded-xl border border-stone-300 px-3 py-1.5 text-sm font-normal focus:border-amber-700 focus:outline-none disabled:opacity-50"
              />
            </label>
            <label className="text-xs font-semibold text-stone-600">
              Label prefix
              <input
                type="text"
                value={prefix}
                disabled={custom !== null}
                title={
                  custom
                    ? "You renamed tables by hand — reset the names to use count + prefix again."
                    : undefined
                }
                onChange={(event) => changePrefix(event.target.value)}
                placeholder="Table"
                className="mt-1 block w-40 rounded-xl border border-stone-300 px-3 py-1.5 text-sm font-normal focus:border-amber-700 focus:outline-none disabled:opacity-50"
              />
            </label>
            {custom && (
              <button
                type="button"
                onClick={resetNames}
                className="rounded-full border border-stone-300 px-4 py-1.5 text-xs font-semibold text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-800"
              >
                Reset names
              </button>
            )}
            <label className="text-xs font-semibold text-stone-600">
              Show
              <select
                value={focusedLabel ?? ""}
                onChange={(event) => setFocusLabel(event.target.value)}
                className="mt-1 block w-40 rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-sm font-normal focus:border-amber-700 focus:outline-none"
              >
                <option value="">All tables</option>
                {labels.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => window.print()}
              disabled={editingLabel !== null}
              title={
                editingLabel !== null
                  ? "Finish typing the table name first — click anywhere else, then print."
                  : undefined
              }
              className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {focusedLabel ? "Print this card" : "Print cards"}
            </button>
          </div>

          <p data-print-hide className="text-xs leading-5 text-stone-500">
            Showing one table makes a single large card for demos — only that card prints.{" "}
            {resolvingLink ? (
              <>Finding your restaurant link…</>
            ) : tableSlug ? (
              <>
                Each code opens this table&apos;s page with every open menu — lunch, dinner, bar,
                all on one screen. The page comes from the server, so the cards work on any phone —
                nothing needs to be installed, and every order lands on your Orders board within
                seconds.
              </>
            ) : publicSlug ? (
              <>
                Each code opens this menu&apos;s live ordering page for one table. The menu comes
                from the server, so the cards work on any phone — nothing needs to be installed, and
                every order lands on your Orders board within seconds.
              </>
            ) : (
              <>
                Each code opens the ordering screen for one table. This menu lives only in this
                browser, so the codes work on this device (or wherever this browser storage is
                available). Move the menu to your account to print cards that work on any phone.
              </>
            )}
          </p>

          {linkState.status === "unavailable" && (
            <p
              data-print-hide
              className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"
            >
              {linkState.message} Showing this menu&apos;s own codes below — claim the restaurant
              link when you&apos;re back online for one code per table.
            </p>
          )}

          <p
            data-print-hide
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"
          >
            <span className="font-bold">Name your tables:</span> click any table&apos;s name right
            on its card and type — for example, change “Table 3” to “Patio 2” or “Bar”, then press
            Enter or click anywhere else to save. While you&apos;re typing, the Print button takes a
            break; it wakes up again as soon as you click away.
          </p>

          {error && (
            <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}

          <div
            data-qr-sheet
            data-qr-single={focusedLabel ? "" : undefined}
            className={`grid gap-3 rounded-2xl border border-stone-200 bg-white p-4 ${
              focusedLabel ? "mx-auto w-full max-w-sm grid-cols-1" : "sm:grid-cols-2"
            }`}
          >
            {visibleCodes.map((code) => (
              <article
                key={code.label}
                data-qr-card
                className="flex flex-col items-center gap-2 rounded-xl border border-stone-200 p-4 text-center"
              >
                <p className="text-xs font-semibold tracking-widest text-stone-500 uppercase">
                  {cardEyebrow.trim() || "Untitled menu"}
                </p>
                {editingLabel === code.label ? (
                  <input
                    autoFocus
                    type="text"
                    value={draft}
                    size={Math.min(Math.max(draft.length + 1, 8), MAX_TABLE_LABEL_LENGTH)}
                    maxLength={MAX_TABLE_LABEL_LENGTH}
                    onChange={(event) =>
                      setDraft(event.target.value.slice(0, MAX_TABLE_LABEL_LENGTH))
                    }
                    onBlur={commitEditing}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                      if (event.key === "Escape") cancelEditing();
                    }}
                    aria-label="Table name"
                    // Same type scale as the name button, zero padding and an outline
                    // (not a border) so the swap never moves the card layout.
                    className={
                      focusedLabel
                        ? "rounded-sm bg-white p-0 text-center text-3xl font-bold text-stone-900 outline-2 outline-amber-700 outline-offset-2"
                        : "rounded-sm bg-white p-0 text-center text-xl font-bold text-stone-900 outline-2 outline-amber-700 outline-offset-2"
                    }
                  />
                ) : (
                  <button
                    type="button"
                    data-qr-name
                    onClick={() => startEditing(code.label)}
                    title="Click to rename this table"
                    // Dotted underline appears on hover only: nothing can leak onto paper,
                    // since printed pages never match :hover.
                    className={
                      focusedLabel
                        ? "cursor-text text-3xl font-bold text-stone-900 hover:underline hover:decoration-dotted hover:decoration-amber-600 hover:underline-offset-8"
                        : "cursor-text text-xl font-bold text-stone-900 hover:underline hover:decoration-dotted hover:decoration-amber-600 hover:underline-offset-4"
                    }
                  >
                    {formatTableLabel(code.label)}
                  </button>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element -- QR data URLs are inherently local and unoptimized */}
                <img
                  src={code.dataUrl}
                  alt={`QR code for ${code.label}`}
                  width={200}
                  height={200}
                  className={focusedLabel ? "h-64 w-64" : "h-44 w-44"}
                />
                <p className="text-[10px] leading-4 text-stone-400">Scan to order</p>
                {(tableSlug || publicSlug) && (
                  <p className="text-[10px] font-medium leading-4 break-all text-stone-600">
                    {displayTableUrl(code.url)}
                  </p>
                )}
                {focusedLabel && (
                  <a
                    data-print-hide
                    href={code.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900"
                  >
                    Open this table&apos;s order page
                  </a>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
