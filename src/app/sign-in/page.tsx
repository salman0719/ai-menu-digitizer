"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

/**
 * Magic-link sign-in (the only human sign-in — PHASE-2.md §3.6): one field,
 * one one-time link. Sign-up happens implicitly when a new email first uses
 * a link. Diners never see this page — ordering at a table stays anonymous.
 */
export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "sending" });
    const { error } = await authClient.signIn.magicLink({ email, callbackURL: "/" });
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
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Sign in</h1>
        <p className="mt-2 text-sm text-stone-600">
          Enter your email and we&apos;ll send a one-time sign-in link — no passwords to remember.
          The link expires in 5 minutes.
        </p>
      </div>

      {status.kind === "sent" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">Check your email</p>
          <p className="mt-1">
            We sent a one-time sign-in link to <span className="font-medium">{status.email}</span>.
            It expires in 5 minutes — if it doesn&apos;t arrive, check your spam folder.
          </p>
          <button
            type="button"
            className="mt-3 text-emerald-800 underline underline-offset-2 hover:text-emerald-950"
            onClick={() => setStatus({ kind: "idle" })}
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label htmlFor="email" className="text-sm font-medium text-stone-700">
            Email address
          </label>
          <input
            id="email"
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
            className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status.kind === "sending" ? "Sending…" : "Send sign-in link"}
          </button>
        </form>
      )}

      <p className="text-sm text-stone-500">
        <Link href="/" className="underline underline-offset-2 hover:text-stone-800">
          Back to the editor
        </Link>{" "}
        — working signed out keeps everything local, as before.
      </p>
    </main>
  );
}
