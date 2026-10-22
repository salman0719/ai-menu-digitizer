"use client";

/**
 * The free-launch onboarding checklist (Step 11).
 *
 * Signed out, it explains what signing in is for and links to the one sign-in
 * flow. Signed in, it reports the account's real state: five steps are
 * derived on the server, and the one step only a human can confirm (printing
 * table cards) is a labelled manual tick stored on this device.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { fetchLaunchStatus } from "@/features/launch/client";
import type { LaunchStatus } from "@/features/launch/schema";
import { launchSteps, verifiedProgress, type LaunchStep } from "@/features/launch/steps";
import { formatMicroUsd } from "@/features/usage/pricing";
import { SyncError } from "@/features/menus/sync";

const CARDS_PRINTED_KEY = "tablepass:launch:cards-printed";

type State =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "error"; message: string }
  | { kind: "ready"; status: LaunchStatus };

function cardsPrintedOnThisDevice(): boolean {
  try {
    return window.localStorage.getItem(CARDS_PRINTED_KEY) === "yes";
  } catch {
    return false;
  }
}

function stepHref(step: LaunchStep, status: LaunchStatus): string {
  // Table cards belong to the restaurant, not to a menu: the Tables tab is
  // the only place that can print them for every open menu at once.
  if (step.id === "cards") return "/tables";
  if (step.id === "order" && status.livePath) return status.livePath;
  return "/";
}

function stepActionLabel(step: LaunchStep): string {
  switch (step.id) {
    case "extract":
      return "Upload a menu";
    case "review":
      return "Open the editor";
    case "theme":
      return "Preview themes";
    case "cards":
      return "Open Tables";
    case "publish":
      return "Publish";
    case "order":
      return "Open the public menu";
  }
}

export function LaunchChecklist() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [cardsPrinted, setCardsPrinted] = useState(false);

  /** Shared error mapping for the first load and the retry button. */
  const fail = useCallback((error: unknown) => {
    if (error instanceof SyncError && error.code === "unauthorized") {
      setState({ kind: "signed_out" });
      return;
    }
    setState({
      kind: "error",
      message: error instanceof Error ? error.message : "Could not load your checklist. Try again.",
    });
  }, []);

  // State is only written from the promise callbacks (never synchronously in
  // the effect), so a load cannot trigger a cascading render.
  useEffect(() => {
    let cancelled = false;
    fetchLaunchStatus()
      .then((status) => {
        if (cancelled) return;
        // The manual tick is read in the browser, once the server data lands.
        setCardsPrinted(cardsPrintedOnThisDevice());
        setState({ kind: "ready", status });
      })
      .catch((error: unknown) => {
        if (!cancelled) fail(error);
      });
    return () => {
      cancelled = true;
    };
  }, [fail]);

  async function retry() {
    setState({ kind: "loading" });
    try {
      const status = await fetchLaunchStatus();
      setCardsPrinted(cardsPrintedOnThisDevice());
      setState({ kind: "ready", status });
    } catch (error) {
      fail(error);
    }
  }

  function toggleCardsPrinted(next: boolean) {
    setCardsPrinted(next);
    try {
      if (next) window.localStorage.setItem(CARDS_PRINTED_KEY, "yes");
      else window.localStorage.removeItem(CARDS_PRINTED_KEY);
    } catch {
      // Storage blocked: the tick still applies for this page view.
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5" role="status">
        <p className="text-sm text-stone-500">Checking your account…</p>
      </div>
    );
  }

  if (state.kind === "signed_out") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-base font-semibold text-amber-950">Sign in to start the checklist</h2>
        <p className="mt-1 text-sm text-amber-900">
          Your menus, public link, and table orders need an account so a phone at the table can
          reach the same menu your laptop published. It is still free, and there is no card step.
        </p>
        <Link
          href="/sign-in"
          className="mt-4 inline-flex rounded-lg bg-amber-800 px-3.5 py-2 text-sm font-semibold text-white hover:bg-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          Sign in with an email link
        </Link>
        <p className="mt-3 text-xs text-amber-900/80">
          Working offline first?{" "}
          <Link href="/" className="underline underline-offset-2">
            Try the local editor
          </Link>{" "}
          — nothing leaves this browser and no account is needed.
        </p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <h2 className="text-base font-semibold text-red-900">The checklist could not load</h2>
        <p className="mt-1 text-sm text-red-800">{state.message}</p>
        <button
          type="button"
          onClick={() => void retry()}
          className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
        >
          Try again
        </button>
      </div>
    );
  }

  const { status } = state;
  const steps = launchSteps(status).map((step) =>
    step.manual ? { ...step, done: cardsPrinted } : step
  );
  const progress = verifiedProgress(steps);
  const allDone = steps.every((step) => step.done);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-stone-900">Your launch checklist</h2>
          <p className="text-xs text-stone-500">
            {progress.done} of {progress.total} steps we can verify
            {cardsPrinted ? " · table cards ticked" : ""}
          </p>
        </div>
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-100"
          role="img"
          aria-label={`${progress.done} of ${progress.total} verifiable steps complete`}
        >
          <div
            className="h-full rounded-full bg-amber-700 transition-all"
            style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
          />
        </div>

        <ol className="mt-4 space-y-3">
          {steps.map((step, index) => (
            <li key={step.id} className="flex gap-3">
              <span
                aria-hidden="true"
                className={
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold " +
                  (step.done
                    ? "border-amber-700 bg-amber-700 text-white"
                    : "border-stone-300 bg-white text-stone-400")
                }
              >
                {step.done ? "✓" : index + 1}
              </span>
              <div className="min-w-0">
                <p
                  className={
                    "text-sm font-medium " + (step.done ? "text-stone-500 line-through" : "text-stone-900")
                  }
                >
                  {step.title}
                </p>
                <p className="mt-0.5 text-xs text-stone-600">{step.guidance}</p>
                <p className="mt-1 text-xs text-stone-500">{step.detail}</p>
                {/* Manual steps keep their control after being ticked,
                    otherwise a mis-click could never be undone. */}
                {!step.done || step.manual ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-3">
                    <Link
                      href={stepHref(step, status)}
                      className="text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
                    >
                      {stepActionLabel(step)}
                    </Link>
                    {step.manual ? (
                      <label className="flex items-center gap-1.5 text-xs text-stone-600">
                        <input
                          type="checkbox"
                          checked={cardsPrinted}
                          onChange={(event) => toggleCardsPrinted(event.target.checked)}
                          className="h-3.5 w-3.5 rounded border-stone-300 accent-amber-700"
                        />
                        {cardsPrinted ? "I printed them (untick to undo)" : "I printed them"}
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>

        {allDone ? (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            That is the whole launch. New orders appear on the Orders tab, and the public page keeps
            showing your latest published menu.
          </p>
        ) : null}
      </section>

      <UsageCard status={status} />
    </div>
  );
}

function UsageCard({ status }: { status: LaunchStatus }) {
  const usage = status.usage;
  if (!usage) return null;

  const used = usage.requests;
  const percent = Math.min(100, Math.round((used / usage.cap) * 100));

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-base font-semibold text-stone-900">AI extraction this month</h2>
      <p className="mt-1 text-sm text-stone-600">
        {used} of {usage.cap} free extractions used · {usage.remaining} left
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100">
        <div className="h-full rounded-full bg-stone-500" style={{ width: `${percent}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-stone-600">
        <dt>Successful</dt>
        <dd className="text-right tabular-nums">{usage.succeeded}</dd>
        <dt>Failed attempts</dt>
        <dd className="text-right tabular-nums">{usage.failed}</dd>
        <dt>Pages read</dt>
        <dd className="text-right tabular-nums">{usage.pages}</dd>
        <dt>Tokens</dt>
        <dd className="text-right tabular-nums">
          {usage.inputTokens === null && usage.outputTokens === null
            ? "not reported"
            : `${usage.inputTokens ?? "?"} in / ${usage.outputTokens ?? "?"} out`}
        </dd>
      </dl>
      <p className="mt-3 text-xs text-stone-500">
        {usage.costMicros !== null
          ? `Provider cost this month: ${formatMicroUsd(usage.costMicros)}.`
          : usage.ratesConfigured
            ? "Cost is unknown for this month because some calls did not report token counts or used a vendor without configured rates."
            : "Provider cost is not configured on this server yet, so only usage is counted."}
      </p>
      <p className="mt-1 text-xs text-stone-400">
        Failed attempts that reached the AI still count: the provider bills them.
      </p>
    </section>
  );
}
