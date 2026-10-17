"use client";

/**
 * Printable table cards. Each QR encodes
 * `{origin}/order?menu=<menuId>&table=<label>`, which opens the ordering
 * screen with this menu and table preset.
 *
 * Codes are generated in the browser (no third-party image API), so the menu
 * id and table labels never leave the device. The cards say plainly that the
 * link needs this browser's storage, because a QR scanned on an unrelated
 * phone cannot see a local menu.
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";

import type { MenuDocument } from "@/features/menu/schema";
import {
  defaultTableLabels,
  MAX_TABLE_LABEL_LENGTH,
  tableOrderUrl,
} from "@/features/orders/table-links";

const COUNT_STORAGE_KEY = "table-qr-count";
const PREFIX_STORAGE_KEY = "table-qr-prefix";
const MAX_TABLES = 40;

interface TableQrPanelProps {
  doc: MenuDocument;
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

export function TableQrPanel({ doc }: TableQrPanelProps) {
  // Origin is only available in the browser; codes are generated after mount,
  // so the server-rendered shell never depends on it.
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin
  );
  const [count, setCount] = useState(() => {
    const stored = Number(readStored(COUNT_STORAGE_KEY, "8"));
    return Number.isInteger(stored) && stored >= 1 && stored <= MAX_TABLES ? stored : 8;
  });
  const [prefix, setPrefix] = useState(() => readStored(PREFIX_STORAGE_KEY, "Table"));
  const [codes, setCodes] = useState<TableCode[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    const labels = defaultTableLabels(count, prefix.trim());
    Promise.all(
      labels.map(async (label) => {
        const url = tableOrderUrl(origin, doc.id, label);
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
  }, [origin, count, prefix, doc.id]);

  function changeCount(next: number) {
    const clamped = Math.min(Math.max(Math.trunc(next) || 1, 1), MAX_TABLES);
    setCount(clamped);
    writeStored(COUNT_STORAGE_KEY, String(clamped));
  }

  function changePrefix(next: string) {
    setPrefix(next.slice(0, MAX_TABLE_LABEL_LENGTH - 3));
    writeStored(PREFIX_STORAGE_KEY, next.slice(0, MAX_TABLE_LABEL_LENGTH - 3));
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
            onChange={(event) => changeCount(Number(event.target.value))}
            className="mt-1 block w-24 rounded-xl border border-stone-300 px-3 py-1.5 text-sm font-normal focus:border-amber-700 focus:outline-none"
          />
        </label>
        <label className="text-xs font-semibold text-stone-600">
          Label prefix
          <input
            type="text"
            value={prefix}
            onChange={(event) => changePrefix(event.target.value)}
            placeholder="Table"
            className="mt-1 block w-40 rounded-xl border border-stone-300 px-3 py-1.5 text-sm font-normal focus:border-amber-700 focus:outline-none"
          />
        </label>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800"
        >
          Print cards
        </button>
      </div>

      <p data-print-hide className="text-xs leading-5 text-stone-500">
        Each code opens the ordering screen for one table. Menus live in this browser, so the codes
        work on this device (or wherever this browser storage is available). Scanning one on an
        unrelated phone shows a clear “not on this device” message with a demo instead.
      </p>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div
        data-qr-sheet
        className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:grid-cols-2"
      >
        {codes.map((code) => (
          <article
            key={code.label}
            data-qr-card
            className="flex flex-col items-center gap-2 rounded-xl border border-stone-200 p-4 text-center"
          >
            <p className="text-xs font-semibold tracking-widest text-stone-500 uppercase">
              {doc.title.trim() || "Untitled menu"}
            </p>
            <p className="text-xl font-bold text-stone-900">{code.label}</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- QR data URLs are inherently local and unoptimized */}
            <img
              src={code.dataUrl}
              alt={`QR code for ${code.label}`}
              width={200}
              height={200}
              className="h-44 w-44"
            />
            <p className="text-[10px] leading-4 break-all text-stone-400">Scan to order</p>
          </article>
        ))}
      </div>
    </div>
  );
}
