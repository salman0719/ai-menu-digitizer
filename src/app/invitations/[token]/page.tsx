import { Suspense } from "react";

import { InvitationClient } from "./invitation-client";

export const metadata = {
  title: "Team invitation — Eateryo",
};

/**
 * Invitation accept page. Next 16 treats a dynamic segment as runtime data:
 * awaiting `params` outside a Suspense boundary would block prerendering
 * (see "blocking-prerender-runtime"), so the token-reading part streams
 * behind a placeholder and hands the client component what it needs.
 */
async function InvitationContent({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InvitationClient token={token} />;
}

export default function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">Team invitation</h1>
          <p role="status" className="text-sm text-stone-500">
            Loading the invitation…
          </p>
        </main>
      }
    >
      <InvitationContent params={params} />
    </Suspense>
  );
}
