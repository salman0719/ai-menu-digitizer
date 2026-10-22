"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { Skeleton } from "@/components/ui/skeleton";
import type { PreviewLayoutId, PreviewThemeId } from "@/features/menu/preview-themes";
import { menuSlugSchema, type PublicationStatus } from "@/features/publishing/schema";

/**
 * The publish surface (Step 9). It appears on the edit screen and above the
 * customer preview, because the preview's theme and layout are what get
 * snapshotted. On the edit screen the style controls are not visible, so the
 * panel offers a shortcut to Preview instead of pointing "above".
 *
 * It never overstates the state of things — "Live" only when the page is
 * actually serving, an explicit warning when draft edits (or a style change)
 * are not on the public page yet, and a plain "Unpublished" when the slug is
 * reserved but the page 404s. Publishing needs an account, so signed-out
 * owners get an explanation and a sign-in link instead of a dead button.
 */

export interface PublishingControls {
  /** Null = never published; `loaded` distinguishes that from "still loading". */
  status: PublicationStatus | null;
  loaded: boolean;
  busy: boolean;
  error: string | null;
  /** Whether this menu exists in the signed-in account (required to publish). */
  inAccount: boolean;
  onPublish: (theme: PreviewThemeId, layout: PreviewLayoutId) => void;
  onUnpublish: () => void;
  onChangeSlug: (slug: string) => void;
}

interface PublishPanelProps {
  signedIn: boolean;
  themeId: PreviewThemeId;
  layout: PreviewLayoutId;
  controls: PublishingControls;
  /**
   * Set on the edit screen, where the theme/layout controls live in Preview.
   * The panel then links there instead of telling owners to look "above".
   */
  onOpenPreview?: () => void;
}

const pill = "rounded-full px-2.5 py-0.5 text-[11px] font-semibold";

function StatusPill({ status }: { status: PublicationStatus | null }) {
  if (!status) {
    return <span className={`${pill} bg-stone-100 text-stone-600`}>Not published</span>;
  }
  if (!status.isLive) {
    return <span className={`${pill} bg-amber-100 text-amber-900`}>Unpublished</span>;
  }
  return <span className={`${pill} bg-emerald-100 text-emerald-900`}>Live</span>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PublishPanel({
  signedIn,
  themeId,
  layout,
  controls,
  onOpenPreview,
}: PublishPanelProps) {
  const { status, loaded, busy, error, inAccount, onPublish, onUnpublish, onChangeSlug } = controls;
  // The panel only mounts client-side (the editor opens after interaction), so
  // reading the origin in an initializer is hydration-safe — same pattern as
  // the table QR panel.
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin
  );
  /** Local edit of the address; null = show the server's current slug. */
  const [slugDraft, setSlugDraft] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const publicUrl = status ? `${origin}${status.urlPath}` : "";
  const slugValue = slugDraft ?? status?.slug ?? "";

  useEffect(() => {
    if (!showQr || !publicUrl) return;
    let cancelled = false;
    QRCode.toDataURL(publicUrl, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1c1917", light: "#ffffff" },
    })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        // QR generation is a convenience: the URL above is the source of truth.
      });
    return () => {
      cancelled = true;
    };
  }, [showQr, publicUrl]);

  const styleDiffers =
    status?.isLive === true && (status.theme !== themeId || status.layout !== layout);
  const needsPublish = status?.isLive === true && (status.hasUnpublishedChanges || styleDiffers);

  function commitSlug() {
    const parsed = menuSlugSchema.safeParse(slugValue);
    if (!parsed.success) {
      setSlugError(parsed.error.issues[0]?.message ?? "That link is not valid.");
      return;
    }
    setSlugError(null);
    setSlugDraft(null);
    if (parsed.data !== status?.slug) onChangeSlug(parsed.data);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied: the URL is still visible and selectable.
      setCopied(false);
    }
  }

  if (!signedIn) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-4" data-print-hide>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-stone-900">Public link</h3>
          <StatusPill status={null} />
        </div>
        <p className="mt-2 text-xs leading-5 text-stone-600">
          Publishing puts this menu on a public link anyone can open — no account needed to view
          it.{" "}
          <a
            href="/sign-in"
            className="font-medium text-amber-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            Sign in
          </a>{" "}
          to publish it (free while the promotion lasts).
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4" data-print-hide>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-stone-900">Public link</h3>
        <StatusPill status={status} />
        {status?.isLive && (
          <span className="text-xs text-stone-500">
            {status.viewCount === 1 ? "1 view" : `${status.viewCount} views`}
          </span>
        )}
        <span className="flex-1" />
        {status && (
          <button
            type="button"
            onClick={() =>
              onPublish(themeId, layout)
            }
            disabled={busy || !inAccount}
            className="rounded-full bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            {busy
              ? "Publishing…"
              : status.isLive
                ? needsPublish
                  ? "Publish changes"
                  : "Republish"
                : "Publish menu"}
          </button>
        )}
      </div>

      {!inAccount && (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          This menu is still only in this browser. Move it to your account (in My menus) before
          publishing, so the public page has an account copy to serve.
        </p>
      )}

      {!loaded && (
        <div role="status" aria-busy="true" className="mt-2 flex flex-col gap-2">
          <span className="sr-only">Checking the public link…</span>
          <Skeleton className="h-3 w-2/3" />
          <div className="flex gap-2">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-28 rounded-full" />
          </div>
        </div>
      )}

      {loaded && !status && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs leading-5 text-stone-600">
            {onOpenPreview
              ? "This menu has never been published. Publishing creates a link from the menu title, using the theme and layout chosen in Preview menu."
              : "This menu has never been published. Publishing creates a link from the menu title — check the theme and layout above first, since those are what visitors see."}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onPublish(themeId, layout)}
              disabled={busy || !inAccount}
              className="rounded-full bg-amber-700 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              {busy ? "Publishing…" : "Publish menu"}
            </button>
            {onOpenPreview && (
              <button
                type="button"
                onClick={onOpenPreview}
                className="text-xs font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
              >
                Choose theme and layout
              </button>
            )}
          </div>
        </div>
      )}

      {status && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded-lg bg-stone-100 px-2 py-1 text-xs text-stone-800">
              {publicUrl || status.urlPath}
            </code>
            {status.isLive && (
              <>
                <a
                  href={status.urlPath}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-amber-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                >
                  Open
                </a>
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="text-xs font-medium text-amber-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowQr((value) => !value)}
                  aria-expanded={showQr}
                  className="text-xs font-medium text-amber-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                >
                  {showQr ? "Hide QR" : "QR code"}
                </button>
              </>
            )}
          </div>

          {!status.isLive && (
            <p className="text-xs leading-5 text-stone-600">
              This menu is not being served right now. The link is reserved for it, so publishing
              again reuses the same address.
            </p>
          )}

          {status.isLive && status.publishedAt && (
            <p className="text-xs text-stone-500">
              Published {formatDate(status.publishedAt)}
              {styleDiffers && !status.hasUnpublishedChanges
                ? onOpenPreview
                  ? " · the style chosen in Preview differs from the live page"
                  : " · the style above differs from the live page"
                : ""}
            </p>
          )}

          {needsPublish && (
            <p
              role="status"
              className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"
            >
              Draft changes are not on the public page yet — visitors still see the last published
              version until you press “Publish changes”.
            </p>
          )}

          {showQr && qrDataUrl && (
            <div className="flex items-center gap-3 rounded-xl border border-stone-200 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- QR data URL, generated locally */}
              <img
                src={qrDataUrl}
                alt={`QR code for ${publicUrl}`}
                width={120}
                height={120}
                className="h-28 w-28"
              />
              <p className="text-xs leading-5 text-stone-600">
                Print this at the door or on the tables. Unlike the table-order codes, this link
                works on any phone.
              </p>
            </div>
          )}

          <label className="block text-xs font-semibold text-stone-600">
            Link address
            <span className="mt-1 flex items-center gap-2">
              <span className="text-xs font-normal text-stone-400">
                {origin}/r/{status.restaurantSlug}/m/
              </span>
              <input
                type="text"
                value={slugValue}
                onChange={(event) => {
                  setSlugDraft(event.target.value);
                  if (slugError) setSlugError(null);
                }}
                onBlur={commitSlug}
                onKeyDown={(event) => {
                  if (event.key === "Enter") (event.target as HTMLElement).blur();
                  if (event.key === "Escape") {
                    setSlugDraft(null);
                    setSlugError(null);
                    (event.target as HTMLElement).blur();
                  }
                }}
                spellCheck={false}
                className={`min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm font-normal text-stone-900 focus:border-amber-700 focus:outline-none ${
                  slugError ? "border-red-500" : "border-stone-300"
                }`}
              />
            </span>
            {slugError && <span className="mt-1 block text-xs text-red-700">{slugError}</span>}
            <span className="mt-1 block text-xs font-normal text-stone-500">
              Lowercase letters, numbers, and single hyphens. Changing it after printing QR codes
              breaks those codes.
            </span>
          </label>

          {status.isLive && (
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Unpublish this menu? The link stops working for everyone, though the address stays reserved for this menu."
                  )
                ) {
                  onUnpublish();
                }
              }}
              disabled={busy}
              className="self-start rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              {busy ? "Working…" : "Unpublish"}
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
