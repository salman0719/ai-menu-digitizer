"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  acceptInvitation,
  fetchInvitation,
  type InvitationDetails,
} from "@/features/tenancy/client";
import { authClient } from "@/lib/auth-client";

type SignInState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

/**
 * Team invitation page (the link in the invitation email).
 *
 * The token identifies the invitation; the signed-in account's email decides
 * whether it can be accepted. Signed out, we send a magic link to the invited
 * address (signing in there creates the account if needed) and come back to
 * this page. The server refuses acceptance from any other account, so this
 * page only explains what happened.
 *
 * The token arrives as a prop from the server page: reading route params in
 * a client component blocks prerendering (Next 16 flags useParams outside
 * Suspense), and the page has nothing to render until it has the token.
 */
export function InvitationClient({ token }: { token: string }) {
  const { data: session, isPending: sessionPending } = authClient.useSession();

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState<{ name: string; role: "owner" | "staff" } | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState<SignInState>({ kind: "idle" });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const details = await fetchInvitation(token);
        if (!cancelled) setInvitation(details);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not load this invitation. Check the link and try again."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const signedEmail = session?.user?.email ?? null;
  const emailMatches =
    invitation !== null &&
    signedEmail !== null &&
    signedEmail.trim().toLowerCase() === invitation.email;

  async function sendSignInLink(email: string) {
    setSignIn({ kind: "sending" });
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: `/invitations/${encodeURIComponent(token)}`,
    });
    if (error) {
      setSignIn({
        kind: "error",
        message:
          (typeof error.message === "string" && error.message) ||
          "Could not send the sign-in link. Please try again.",
      });
      return;
    }
    setSignIn({ kind: "sent" });
  }

  async function handleSwitchAccount(email: string) {
    setSignIn({ kind: "sending" });
    await authClient.signOut();
    await sendSignInLink(email);
  }

  async function handleAccept() {
    if (accepting) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      const restaurant = await acceptInvitation(token);
      setAccepted({ name: restaurant.name, role: restaurant.role });
    } catch (error) {
      setAcceptError(
        error instanceof Error ? error.message : "Could not accept the invitation. Try again."
      );
    } finally {
      setAccepting(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Team invitation</h1>
        {invitation && (
          <p className="mt-2 text-sm text-stone-600">
            You&apos;ve been invited to join{" "}
            <span className="font-medium text-stone-900">{invitation.restaurantName}</span> as{" "}
            {invitation.role === "owner" ? "an owner" : "staff"}.
          </p>
        )}
      </div>

      {loadError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {loadError}
        </p>
      )}

      {!invitation && !loadError && (
        <p role="status" className="text-sm text-stone-500">
          Loading the invitation…
        </p>
      )}

      {invitation && (
        <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-700">
          <p>
            Invited email: <span className="font-medium text-stone-900">{invitation.email}</span>
          </p>
          <p className="mt-1 text-xs text-stone-500">
            The link expires {new Date(invitation.expiresAt).toLocaleString()}.
          </p>
        </div>
      )}

      {invitation && invitation.status !== "pending" && !accepted && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {invitation.status === "expired"
            ? "This invitation has expired — ask the restaurant owner to send a new one."
            : "This invitation has already been accepted."}
        </p>
      )}

      {accepted && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">You&apos;re in</p>
          <p className="mt-1">
            You joined {accepted.name} as {accepted.role === "owner" ? "an owner" : "staff"}.
          </p>
          <Link
            href="/menus"
            className="mt-3 inline-block rounded-full bg-emerald-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-900"
          >
            Go to My menus
          </Link>
        </div>
      )}

      {acceptError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {acceptError}
        </p>
      )}

      {invitation && invitation.status === "pending" && !accepted && !sessionPending && (
        <>
          {!signedEmail && (
            <div className="flex flex-col gap-3">
              {signIn.kind === "sent" ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <p className="font-medium">Check your email</p>
                  <p className="mt-1">
                    We sent a one-time sign-in link to {invitation.email}. Open it on this device,
                    then accept the invitation.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-stone-600">
                    Sign in with <span className="font-medium">{invitation.email}</span> to accept.
                    We&apos;ll email a one-time link — no password.
                  </p>
                  <button
                    type="button"
                    disabled={signIn.kind === "sending"}
                    onClick={() => void sendSignInLink(invitation.email)}
                    className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {signIn.kind === "sending" ? "Sending…" : "Email me a sign-in link"}
                  </button>
                </>
              )}
              {signIn.kind === "error" && (
                <p role="alert" className="text-sm text-red-800">
                  {signIn.message}
                </p>
              )}
            </div>
          )}

          {signedEmail && emailMatches && (
            <button
              type="button"
              disabled={accepting}
              onClick={() => void handleAccept()}
              className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {accepting ? "Accepting…" : "Accept invitation"}
            </button>
          )}

          {signedEmail && !emailMatches && (
            <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p>
                You&apos;re signed in as <span className="font-medium">{signedEmail}</span>, but this
                invitation is for <span className="font-medium">{invitation.email}</span>.
              </p>
              <button
                type="button"
                disabled={signIn.kind === "sending"}
                onClick={() => void handleSwitchAccount(invitation.email)}
                className="self-start rounded-full border border-amber-700 px-4 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {signIn.kind === "sending"
                  ? "Sending…"
                  : `Sign in with ${invitation.email} instead`}
              </button>
              {signIn.kind === "sent" && (
                <p className="text-xs">
                  Check that inbox for the sign-in link, then accept the invitation.
                </p>
              )}
            </div>
          )}
        </>
      )}

      <p className="text-sm text-stone-500">
        <Link href="/" className="underline underline-offset-2 hover:text-stone-800">
          Back to the editor
        </Link>
      </p>
    </main>
  );
}
