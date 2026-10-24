"use client";

import { useId, useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

/**
 * The one human sign-in form (magic link, PHASE-2.md §3.6), shared by the
 * standalone sign-in page and the publish wizard. The wizard passes its own
 * `callbackURL` so the emailed link returns to the draft instead of the home
 * screen — the draft itself is already safe in IndexedDB.
 */
export function MagicLinkForm({
  callbackURL,
  onSent,
}: {
  /** Same-origin path the emailed link returns to. */
  callbackURL: string;
  onSent?: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const inputId = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "sending" });
    const { error } = await authClient.signIn.magicLink({ email, callbackURL });
    if (error) {
      setStatus({
        kind: "error",
        message:
          (typeof error.message === "string" && error.message) ||
          "Could not send the sign-in link. Please try again.",
      });
      return;
    }
    setStatus({ kind: "sent", email });
    onSent?.(email);
  }

  if (status.kind === "sent") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-medium">Check your email</p>
        <p className="mt-1">
          We sent a one-time sign-in link to <span className="font-medium">{status.email}</span>. It
          expires in 5 minutes — if it doesn&apos;t arrive, check your spam folder.
        </p>
        <button
          type="button"
          className="mt-3 font-medium underline underline-offset-2 hover:text-emerald-950"
          onClick={() => setStatus({ kind: "idle" })}
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor={inputId} className="text-sm font-medium text-stone-700">
        Email address
      </label>
      <input
        id={inputId}
        type="email"
        required
        autoComplete="email"
        placeholder="you@cafe.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
      />
      {status.kind === "error" ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {status.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={status.kind === "sending"}
        className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
      >
        {status.kind === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
