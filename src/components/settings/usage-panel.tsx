"use client";

/**
 * Settings "Usage" (R0.5, moved off `/launch`): this month's extraction and
 * assistant spend against their caps, plus a nudge to spend the remaining
 * free extractions on a real menu photo. Nothing renders unless signed in —
 * Settings only mounts it for signed-in accounts anyway, and the launch API
 * 401s without a session.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { fetchLaunchStatus } from "@/features/launch/client";
import type { LaunchStatus } from "@/features/launch/schema";
import type { UsageSummary } from "@/features/usage/schema";
import { formatMicroUsd } from "@/features/usage/pricing";
import { authClient } from "@/lib/auth-client";
import { SyncError } from "@/features/menus/sync";

export interface ExtractNudge {
  href: string;
  label: string;
  body: string;
}

/**
 * Pure nudge decision, tested without rendering: while free extractions
 * remain, point at capture; at zero there is nothing to nudge toward — the
 * panel says when the cap resets instead.
 */
export function extractNudge(usage: UsageSummary): ExtractNudge | null {
  if (usage.remaining <= 0) return null;
  return {
    href: "/",
    label: "Upload a menu photo",
    body: `${usage.remaining} of ${usage.cap} free extractions left this month.`,
  };
}

type State =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "error"; message: string }
  | { kind: "ready"; status: LaunchStatus };

export function UsagePanel() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [state, setState] = useState<State>({ kind: "loading" });

  /** Shared error mapping for the first load and the retry button. */
  const fail = useCallback((error: unknown) => {
    if (error instanceof SyncError && error.code === "unauthorized") {
      setState({ kind: "signed_out" });
      return;
    }
    setState({
      kind: "error",
      message: error instanceof Error ? error.message : "Could not load your usage. Try again.",
    });
  }, []);

  // State is only written from the promise callbacks (never synchronously in
  // the effect), so a load cannot trigger a cascading render.
  useEffect(() => {
    if (sessionPending || !session?.user) return;
    let cancelled = false;
    fetchLaunchStatus()
      .then((status) => {
        if (!cancelled) setState({ kind: "ready", status });
      })
      .catch((error: unknown) => {
        if (!cancelled) fail(error);
      });
    return () => {
      cancelled = true;
    };
  }, [fail, sessionPending, session?.user]);

  async function retry() {
    setState({ kind: "loading" });
    try {
      setState({ kind: "ready", status: await fetchLaunchStatus() });
    } catch (error) {
      fail(error);
    }
  }

  // No session, no card: the effect above never fetches without a user, so
  // without this a signed-out visitor would hang on the skeleton forever.
  if (!sessionPending && !session?.user) return null;

  if (sessionPending || state.kind === "loading") {
    return (
      <div
        role="status"
        aria-busy="true"
        className="rounded-2xl border border-stone-200 bg-white p-5"
      >
        <span className="sr-only">Checking your usage…</span>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-3 w-2/3" />
        <Skeleton className="mt-2 h-1.5 w-full" />
      </div>
    );
  }

  if (state.kind === "signed_out") return null;
  if (state.kind === "error") {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <h3 className="text-sm font-bold tracking-tight text-red-900">Usage</h3>
        <p className="mt-1 text-xs text-red-800">{state.message}</p>
        <button
          type="button"
          onClick={() => void retry()}
          className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
        >
          Try again
        </button>
      </div>
    );
  }

  const usage = state.status.usage;
  if (!usage) return null;
  const nudge = extractNudge(usage);
  const used = usage.requests;
  const percent = Math.min(100, Math.round((used / usage.cap) * 100));

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h3 className="text-sm font-bold tracking-tight text-stone-900">Usage</h3>
      <p className="mt-1 text-xs leading-5 text-stone-500">
        Free allowances for this account — extraction photos and assistant messages reset each UTC
        month.
      </p>

      <h4 className="mt-4 text-xs font-semibold tracking-wide text-stone-700 uppercase">
        AI extraction this month
      </h4>
      <p className="mt-1 text-sm text-stone-600">
        {used} of {usage.cap} free extractions used · {usage.remaining} left
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100">
        <div className="h-full rounded-full bg-stone-500" style={{ width: `${percent}%` }} />
      </div>

      {nudge ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          {nudge.body}{" "}
          <Link
            href={nudge.href}
            className="font-semibold underline underline-offset-2 hover:text-amber-950"
          >
            {nudge.label}
          </Link>
        </p>
      ) : (
        <p className="mt-3 text-xs leading-5 text-stone-500">
          Extraction cap reached for this month — it resets{" "}
          {new Date(usage.periodEnd).toLocaleDateString()}, and the order board keeps working.
        </p>
      )}

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

      {state.status.assistant.messages > 0 ? (
        <div className="mt-4 border-t border-stone-100 pt-3">
          <h4 className="text-xs font-semibold tracking-wide text-stone-700 uppercase">
            Assistant this month
          </h4>
          <p className="mt-1 text-xs text-stone-600">
            {state.status.assistant.messages} of {state.status.assistant.cap} messages used
            {state.status.assistant.neurons !== null
              ? ` · ${Math.round(state.status.assistant.neurons).toLocaleString()} neurons`
              : " · neuron use not reported"}
            {state.status.assistant.costMicros !== null
              ? ` · ${formatMicroUsd(state.status.assistant.costMicros)}`
              : " · cost unknown"}
          </p>
          <p className="mt-1 text-xs text-stone-400">
            Assistant calls come from the same free Workers AI allocation as extraction; the message
            cap resets each UTC month.
          </p>
        </div>
      ) : null}
    </section>
  );
}
