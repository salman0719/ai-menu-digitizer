"use client";

/**
 * Printable table cards.
 *
 * When the menu is published, each QR encodes the public table link
 * `{origin}/m/<slug>/order?table=<label>` — that page reads the server
 * snapshot, so a scanned code works on any phone (Step 10). For a menu that
 * exists only in this browser, the Phase 1 link
 * `{origin}/order?menu=<menuId>&table=<label>` is kept, and the cards say
 * plainly that it needs this browser's storage.
 *
 * Codes are generated in the browser (no third-party image API); a public
 * slug and table labels are not sensitive either way.
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";

import type { MenuDocument } from "@/features/menu/schema";
import {
  defaultTableLabels,
  displayTableUrl,
  formatTableLabel,
  MAX_TABLE_LABEL_LENGTH,
  MAX_TABLES,
  normalizeTableLabel,
  publicTableOrderUrl,
  sanitizeTableLabels,
  tableOrderUrl,
} from "@/features/orders/table-links";

const COUNT_STORAGE_KEY = "table-qr-count";
const PREFIX_STORAGE_KEY = "table-qr-prefix";
const LABELS_STORAGE_KEY = "table-qr-labels";
const CUSTOM_FLAG_KEY = "table-qr-custom";

interface TableQrPanelProps {
  doc: MenuDocument;
  /** Published menu slug; when present the codes target the public server page. */
  publicSlug?: string | null;
}

interface TableCode {
  label: string;
  url: string;
  dataUrl: string;
}

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

export function TableQrPanel({ doc, publicSlug }: TableQrPanelProps) {
  // Origin is only available in the browser; codes are generated after mount,
  // so the server-rendered shell never depends on it.
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const [count, setCount] = useState(() => {
    const stored = Number(readStored(COUNT_STORAGE_KEY, "8"));
    return Number.isInteger(stored) && stored >= 1 && stored <= MAX_TABLES ? stored : 8;
  });
  const [prefix, setPrefix] = useState(() => readStored(PREFIX_STORAGE_KEY, "Table"));
  /**
   * Explicit per-table names. Null means "generate from count + prefix";
   * a list means the owner pressed "Edit table names" and owns each row.
   */
  const [custom, setCustom] = useState<string[] | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      if (window.localStorage.getItem(CUSTOM_FLAG_KEY) !== "1") return null;
      const parsed = sanitizeTableLabels(
        JSON.parse(window.localStorage.getItem(LABELS_STORAGE_KEY) ?? "[]") as string[]
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
  const labels = custom ?? defaultTableLabels(count, prefix.trim());
  const focusedLabel = labels.includes(focusLabel) ? focusLabel : null;
  const visibleCodes = focusedLabel ? codes.filter((code) => code.label === focusedLabel) : codes;

  useEffect(() => {
    if (custom) {
      writeStored(LABELS_STORAGE_KEY, JSON.stringify(sanitizeTableLabels(custom)));
      writeStored(CUSTOM_FLAG_KEY, "1");
    }
  }, [custom]);

  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    const labels = custom ?? defaultTableLabels(count, prefix.trim());
    Promise.all(
      labels.map(async (label) => {
        const url = publicSlug
          ? publicTableOrderUrl(origin, publicSlug, label)
          : tableOrderUrl(origin, doc.id, label);
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
        if (!cancelled) setCodes(result);
      })
      .catch(() => {
        if (!cancelled) setError("Could not generate the QR codes in this browser.");
      });
    return () => {
      cancelled = true;
    };
  }, [origin, count, prefix, custom, doc.id, publicSlug]);

  function changeCount(next: number) {
    const clamped = Math.min(Math.max(Math.trunc(next) || 1, 1), MAX_TABLES);
    setCount(clamped);
    setFocusLabel("");
    setEditingLabel(null);
    writeStored(COUNT_STORAGE_KEY, String(clamped));
  }

  function changePrefix(next: string) {
    setPrefix(next.slice(0, MAX_TABLE_LABEL_LENGTH - 3));
    setFocusLabel("");
    setEditingLabel(null);
    writeStored(PREFIX_STORAGE_KEY, next.slice(0, MAX_TABLE_LABEL_LENGTH - 3));
  }

  function resetNames() {
    setCustom(null);
    setEditingLabel(null);
    setFocusLabel("");
    try {
      window.localStorage.removeItem(CUSTOM_FLAG_KEY);
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

  return (
    <div className="flex flex-col gap-4">
      <div
        data-print-hide
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200 bg-white p-4"
      >
        <label className="text-xs font-semibold text-stone-600">
          Tables
          <input
            type="number"
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
        {publicSlug ? (
          <>
            Each code opens this menu&apos;s live ordering page for one table. The menu comes from
            the server, so the cards work on any phone — nothing needs to be installed, and every
            order lands on your Orders board within seconds.
          </>
        ) : (
          <>
            Each code opens the ordering screen for one table. This menu lives only in this browser,
            so the codes work on this device (or wherever this browser storage is available).
            Publish the menu to get cards that work on any phone.
          </>
        )}
      </p>

      <p
        data-print-hide
        className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"
      >
        <span className="font-bold">Name your tables:</span> click any table&apos;s name right on
        its card and type — for example, change “Table 3” to “Patio 2” or “Bar”, then press Enter or
        click anywhere else to save. While you&apos;re typing, the Print button takes a break; it
        wakes up again as soon as you click away.
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
              {doc.title.trim() || "Untitled menu"}
            </p>
            {editingLabel === code.label ? (
              <input
                autoFocus
                type="text"
                value={draft}
                size={Math.min(Math.max(draft.length + 1, 8), MAX_TABLE_LABEL_LENGTH)}
                maxLength={MAX_TABLE_LABEL_LENGTH}
                onChange={(event) => setDraft(event.target.value.slice(0, MAX_TABLE_LABEL_LENGTH))}
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
            {publicSlug && (
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
    </div>
  );
}
