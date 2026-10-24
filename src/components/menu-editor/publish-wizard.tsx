"use client";

import { useEffect, useMemo, useState } from "react";

import { MagicLinkForm } from "@/components/auth/magic-link-form";
import { Skeleton } from "@/components/ui/skeleton";
import { PhoneFrame } from "@/components/ui/phone-frame";
import type { MenuDocument } from "@/features/menu/schema";
import {
  PREVIEW_LAYOUT_IDS,
  PREVIEW_THEMES,
  PREVIEW_THEME_IDS,
  type PreviewLayoutId,
} from "@/features/menu/preview-themes";
import { SyncError } from "@/features/menus/sync";
import { fetchPublication } from "@/features/publishing/client";
import { menuSlugSchema, type PublicationStatus } from "@/features/publishing/schema";
import { slugCandidates } from "@/features/publishing/slug";
import { publishMenuWithSetup } from "@/features/publishing/setup-client";
import type { PublishSetupResult } from "@/features/publishing/setup-schema";
import {
  clearWizardState,
  defaultWizardState,
  loadWizardState,
  publishWizardPath,
  resolveWizardRestaurant,
  saveWizardState,
  type PublishWizardState,
} from "@/features/publishing/wizard-state";
import type { RestaurantOption } from "@/features/tenancy/client";

import { AvailabilityPanel } from "./availability-panel";
import { MenuPreview } from "./menu-preview";
import { QrCode } from "./qr-code";

const LAYOUTS: { id: PreviewLayoutId; label: string }[] = [
  { id: "list", label: "List" },
  { id: "columns", label: "Two columns" },
];

function itemCount(doc: MenuDocument): number {
  return doc.categories.reduce((sum, category) => sum + category.items.length, 0);
}

function errorCopy(error: unknown): string {
  if (error instanceof SyncError) {
    switch (error.code) {
      case "unauthorized":
        return "Your sign-in expired. Sign in again — your draft is still in this browser.";
      case "forbidden":
        return "Only the owner of this restaurant can publish its menus.";
      case "not_found":
        return "This menu is no longer in your account. Reopen it from My menus and try again.";
      case "invalid":
        return error.message;
      case "slug_taken":
        return "That link name is already used by another menu at this café. Pick a different one.";
      default:
        return "Could not reach the server. Your draft is safe in this browser — try again.";
    }
  }
  return "Something went wrong. Your draft is safe in this browser.";
}

function WizardSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Preparing your public link…</span>
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-3 h-9 w-full" />
          <Skeleton className="mt-2 h-9 w-full" />
          <Skeleton className="mt-4 h-10 w-40 rounded-full" />
        </div>
        <Skeleton className="h-[420px] rounded-[2.4rem]" />
      </div>
    </div>
  );
}

interface PublishWizardProps {
  doc: MenuDocument;
  signedIn: boolean;
  sessionPending: boolean;
  /** The signed-in account's id; null while signed out. */
  accountKey: string | null;
  /** Restaurants the caller owns; staff-only restaurants never appear here. */
  ownedRestaurants: RestaurantOption[];
  /** True until the owned-restaurant lookup settles. */
  restaurantsLoading: boolean;
  /** The shell updates its account/menu state from this result. */
  onPublished: (result: PublishSetupResult) => void;
  onBack: () => void;
  onOpenTables: () => void;
  onOpenEditor: () => void;
}

/**
 * "Get your public link" — the R1 publish wizard.
 *
 * The draft is already saved in IndexedDB, so signing in is a step inside the
 * flow, not a way out of it: the emailed link returns to this exact URL and
 * the short form is restored from localStorage. One submit then creates the
 * restaurant only when the owner has none, attaches the menu and publishes
 * the snapshot.
 *
 * The success screen is the reward the old flow never had: the live URL, a
 * QR code, the menu inside a phone frame, and the two optional next steps
 * (tables, hours) without a trip to a marketing page.
 */
export function PublishWizard({
  doc,
  signedIn,
  sessionPending,
  accountKey,
  ownedRestaurants,
  restaurantsLoading,
  onPublished,
  onBack,
  onOpenTables,
  onOpenEditor,
}: PublishWizardProps) {
  const fallback = useMemo(() => defaultWizardState(doc), [doc]);
  const [form, setForm] = useState<PublishWizardState>(() => loadWizardState(doc.id, fallback));
  const publicationKey = `${accountKey ?? "anonymous"}:${doc.id}`;
  /** Which account+menu the publication state belongs to. */
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const [published, setPublished] = useState<PublicationStatus | null>(null);
  const [submitResult, setSubmitResult] = useState<PublishSetupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A taken link suggests alternatives instead of only complaining. */
  const [slugTaken, setSlugTaken] = useState(false);
  const [showHours, setShowHours] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));

  useEffect(() => {
    saveWizardState(doc.id, form);
  }, [doc.id, form]);

  // A reload after publishing (or opening a menu that is already live) must
  // show the link rather than a fresh publish form. `checkedFor` tracks the
  // answer per account+menu, so a stale success never renders while another
  // account's publication is still being read.
  useEffect(() => {
    if (!signedIn || !accountKey) return;
    let cancelled = false;
    void fetchPublication(doc.id)
      .then((status) => {
        if (cancelled) return;
        setPublished(status?.isLive ? status : null);
        setCheckedFor(publicationKey);
      })
      .catch(() => {
        // A 404 is normal for a browser-only draft; the form still works.
        if (!cancelled) {
          setPublished(null);
          setCheckedFor(publicationKey);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, doc.id, publicationKey, signedIn]);

  const menuItems = itemCount(doc);
  const choice = resolveWizardRestaurant(form, ownedRestaurants);
  const slugParsed = menuSlugSchema.safeParse(form.slug);
  const slugError =
    form.slug.length === 0
      ? null
      : slugParsed.success
        ? null
        : (slugParsed.error.issues[0]?.message ??
          "Use lowercase letters, numbers and single hyphens.");
  const checking = signedIn && checkedFor !== publicationKey;
  const canSubmit =
    signedIn &&
    !sessionPending &&
    !restaurantsLoading &&
    !checking &&
    !busy &&
    slugParsed.success &&
    (choice.kind === "existing" || choice.kind === "create");

  const publicUrl = published ? `${origin}${published.urlPath}` : "";
  const liveTheme = published?.theme ?? form.theme;
  const liveLayout = published?.layout ?? form.layout;

  const suggestedSlugs = slugTaken
    ? slugCandidates(form.slug, 6)
        .filter((candidate) => candidate !== form.slug)
        .slice(0, 3)
    : [];

  function update(patch: Partial<PublishWizardState>) {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
    setSlugTaken(false);
  }

  async function handlePublish() {
    if (!canSubmit || !slugParsed.success) return;
    setBusy(true);
    setError(null);
    try {
      const result = await publishMenuWithSetup(doc.id, {
        doc,
        theme: form.theme,
        layout: form.layout,
        slug: slugParsed.data,
        ...(choice.kind === "existing"
          ? { restaurantId: choice.id }
          : choice.kind === "create"
            ? { restaurantName: choice.name }
            : {}),
      });
      setPublished(result.publication);
      setSubmitResult(result);
      clearWizardState(doc.id);
      onPublished(result);
    } catch (publishError) {
      setSlugTaken(publishError instanceof SyncError && publishError.code === "slug_taken");
      setError(errorCopy(publishError));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (sessionPending || (signedIn && checking)) return <WizardSkeleton />;

  if (signedIn && published?.isLive) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-wide text-amber-800 uppercase">
              {submitResult?.created.menu ? "First link created" : "Your link is live"}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
              Your menu is on the internet
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">
              {submitResult?.created.restaurant
                ? `We created “${submitResult.restaurant.name}” for you — rename it in Settings whenever you like. `
                : ""}
              Anyone can open this link, no account needed. Share it, or print the QR code for your
              tables.
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            ← Back to editing
          </button>
        </div>

        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Your link
              </p>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                <code className="min-w-0 max-w-full truncate rounded-lg bg-stone-100 px-2.5 py-1.5 text-sm text-stone-900">
                  {publicUrl || published.urlPath}
                </code>
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="rounded-full bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
                <a
                  href={published.urlPath}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                >
                  Open page
                </a>
              </div>
              <p className="mt-2 text-xs leading-5 text-stone-500">
                {published.viewCount === 1
                  ? "1 view so far"
                  : `${published.viewCount} views so far`}{" "}
                · updates stay private until you publish changes from the editor.
              </p>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-stone-200 p-3">
              <QrCode value={publicUrl} alt={`QR code for ${publicUrl}`} size={112} />
              <p className="text-xs leading-5 text-stone-600">
                Print this at the door or on the tables. It works on any phone — no app needed.
              </p>
            </div>

            <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
              <h2 className="text-sm font-semibold text-stone-900">Make it work for service</h2>
              <p className="mt-1 text-xs leading-5 text-stone-600">
                These two steps are optional, and neither one changes your live link.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onOpenTables}
                  className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                >
                  Add tables &amp; print QR codes
                </button>
                <button
                  type="button"
                  onClick={() => setShowHours((value) => !value)}
                  aria-expanded={showHours}
                  className="rounded-full border border-stone-300 bg-white px-4 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                >
                  {showHours ? "Hide opening hours" : "Set your opening hours"}
                </button>
                <button
                  type="button"
                  onClick={onOpenEditor}
                  className="rounded-full border border-stone-300 bg-white px-4 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                >
                  Keep editing
                </button>
              </div>
              {showHours && (
                <div className="mt-3">
                  <AvailabilityPanel menuId={doc.id} syncMode="account" />
                </div>
              )}
            </div>
          </section>

          <aside className="flex flex-col gap-2">
            <PhoneFrame label="What customers see on their phone">
              <MenuPreview
                doc={doc}
                themeId={liveTheme}
                layout={liveLayout}
                eyebrow="Menu · live"
              />
            </PhoneFrame>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-amber-800 uppercase">
            Get your public link
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
            {signedIn ? "One short form, then your link" : "Sign in to get your link"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">
            {signedIn
              ? "We will create your café only if you don’t have one yet, attach this draft, and publish it. Nothing else is required."
              : "Your draft is saved in this browser, so it will be waiting when you come back. The emailed link returns you to this same screen."}
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          ← Back to editing
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-stone-900 px-2.5 py-0.5 font-semibold text-white">
              1 · Draft
            </span>
            <span aria-hidden="true" className="text-stone-300">
              →
            </span>
            <span
              className={
                signedIn
                  ? "rounded-full bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-900"
                  : "rounded-full bg-stone-100 px-2.5 py-0.5 font-medium text-stone-500"
              }
            >
              2 · Sign in
            </span>
            <span aria-hidden="true" className="text-stone-300">
              →
            </span>
            <span className="rounded-full bg-stone-100 px-2.5 py-0.5 font-medium text-stone-500">
              3 · Live link
            </span>
          </div>

          {!signedIn ? (
            <>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                The draft stays exactly as you left it. Use the same browser you uploaded from when
                you open the emailed link.
              </div>
              <MagicLinkForm callbackURL={publishWizardPath(doc.id)} />
              <p className="text-xs leading-5 text-stone-500">
                No password, no card — sign-in is just how the link becomes yours.
              </p>
            </>
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold text-stone-900">Your café</p>
                {restaurantsLoading ? (
                  <div role="status" aria-busy="true" className="mt-2">
                    <span className="sr-only">Loading your restaurants…</span>
                    <Skeleton className="h-9 w-full" />
                  </div>
                ) : ownedRestaurants.length === 0 ? (
                  <label className="mt-2 flex flex-col gap-1 text-xs font-medium text-stone-600">
                    Name your restaurant
                    <input
                      type="text"
                      value={form.restaurantName}
                      onChange={(event) => update({ restaurantName: event.target.value })}
                      placeholder="e.g. Sunny Side Café"
                      className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                    />
                    <span className="text-xs font-normal text-stone-500">
                      Suggested from your menu title — change it if you like. You can rename it
                      later in Settings.
                    </span>
                  </label>
                ) : ownedRestaurants.length === 1 && ownedRestaurants[0] ? (
                  <p className="mt-1 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-800">
                    Publishing under <span className="font-medium">{ownedRestaurants[0].name}</span>
                  </p>
                ) : (
                  <label className="mt-2 flex flex-col gap-1 text-xs font-medium text-stone-600">
                    Publishing under
                    <select
                      value={form.restaurantId}
                      onChange={(event) => update({ restaurantId: event.target.value })}
                      className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                    >
                      <option value="" disabled>
                        Choose a restaurant…
                      </option>
                      {ownedRestaurants.map((restaurant) => (
                        <option key={restaurant.id} value={restaurant.id}>
                          {restaurant.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
                Your link name
                <span className="flex items-center gap-1 rounded-lg border border-stone-300 px-3 py-2 focus-within:border-amber-600">
                  <span className="shrink-0 text-xs font-normal text-stone-400">/m/</span>
                  <input
                    type="text"
                    value={form.slug}
                    onChange={(event) => update({ slug: event.target.value })}
                    spellCheck={false}
                    className="min-w-0 flex-1 text-sm text-stone-900 focus:outline-none"
                  />
                </span>
                <span
                  className={`text-xs font-normal ${slugError ? "text-red-700" : "text-stone-500"}`}
                >
                  {slugError ??
                    "Lowercase letters, numbers and single hyphens. The café part of the link comes from its name."}
                </span>
                {suggestedSlugs.length > 0 && (
                  <span className="flex flex-wrap items-center gap-1.5 text-xs font-normal text-stone-600">
                    Try
                    {suggestedSlugs.map((candidate) => (
                      <button
                        key={candidate}
                        type="button"
                        onClick={() => update({ slug: candidate })}
                        className="rounded-full border border-stone-300 bg-white px-2 py-0.5 font-medium text-amber-800 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                      >
                        {candidate}
                      </button>
                    ))}
                  </span>
                )}
              </label>

              <div>
                <p className="text-xs font-medium text-stone-600">Style</p>
                <div role="group" aria-label="Menu theme" className="mt-1 flex flex-wrap gap-1.5">
                  {PREVIEW_THEME_IDS.map((themeId) => (
                    <button
                      key={themeId}
                      type="button"
                      aria-pressed={form.theme === themeId}
                      onClick={() => update({ theme: themeId })}
                      className={
                        form.theme === themeId
                          ? "rounded-full bg-amber-800 px-3 py-1 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                          : "rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                      }
                    >
                      {PREVIEW_THEMES[themeId].name}
                    </button>
                  ))}
                </div>
                <div
                  role="group"
                  aria-label="Menu layout"
                  className="mt-1.5 flex flex-wrap gap-1.5"
                >
                  {LAYOUTS.filter((layout) => PREVIEW_LAYOUT_IDS.includes(layout.id)).map(
                    (layout) => (
                      <button
                        key={layout.id}
                        type="button"
                        aria-pressed={form.layout === layout.id}
                        onClick={() => update({ layout: layout.id })}
                        className={
                          form.layout === layout.id
                            ? "rounded-full bg-stone-900 px-3 py-1 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                            : "rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                        }
                      >
                        {layout.label}
                      </button>
                    )
                  )}
                </div>
              </div>

              {choice.kind === "choose" && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                  Choose which café this menu belongs to above.
                </p>
              )}
              {choice.kind === "missing" && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                  Give your café a name above so we can create it.
                </p>
              )}

              {error && (
                <p
                  role="alert"
                  className="rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-800"
                >
                  {error}
                </p>
              )}

              <div>
                <button
                  type="button"
                  onClick={() => void handlePublish()}
                  disabled={!canSubmit}
                  className="w-full rounded-full bg-amber-700 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 sm:w-auto"
                >
                  {busy ? "Publishing…" : "Publish my menu"}
                </button>
                <p className="mt-2 text-xs text-stone-500">
                  Free while the promotion lasts. The draft is saved before anything is sent.
                </p>
              </div>
            </>
          )}
        </section>

        <aside className="flex flex-col gap-2">
          <PhoneFrame label="Preview — the live page uses this theme">
            <MenuPreview
              doc={doc}
              themeId={form.theme}
              layout={form.layout}
              eyebrow="Preview · not published"
            />
          </PhoneFrame>
          <p className="text-center text-xs text-stone-500">
            {doc.categories.length} {doc.categories.length === 1 ? "category" : "categories"} ·{" "}
            {menuItems} {menuItems === 1 ? "item" : "items"}
          </p>
        </aside>
      </div>
    </div>
  );
}
