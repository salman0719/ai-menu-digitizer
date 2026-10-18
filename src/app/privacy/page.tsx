import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { contactEmail, LEGAL_UPDATED, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Privacy — ${SITE_NAME}`,
  description:
    "What Tablepass stores, what it never stores, how long orders are kept, and how to export or delete your data.",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-7">
      <h2 className="text-base font-semibold text-stone-900">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-stone-600">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  const email = contactEmail();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">Privacy</h1>
        <p className="mt-2 text-sm text-stone-500">Last updated {LEGAL_UPDATED}.</p>
        <p className="mt-4 text-sm leading-relaxed text-stone-600">
          This page describes exactly what {SITE_NAME} does with data, in the same words the code
          uses. If something here does not match what you experience, that is a bug — tell us.
        </p>

        <Section title="Who this is for">
          <p>
            {SITE_NAME} is used by café and restaurant owners and their staff. Diners ordering at a
            table never create an account and are never asked for a name, email, or phone number.
          </p>
        </Section>

        <Section title="What we store">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="font-medium text-stone-800">Your account:</strong> the email
              address you sign in with, sent once as a one-time sign-in link. There is no password.
            </li>
            <li>
              <strong className="font-medium text-stone-800">Your menu:</strong> the restaurant
              name, menu text, prices, and the themes you publish.
            </li>
            <li>
              <strong className="font-medium text-stone-800">Table orders:</strong> the table label,
              the items and prices at the time of ordering, an optional free-text note from the
              diner, the status, and timestamps.
            </li>
            <li>
              <strong className="font-medium text-stone-800">Extraction usage:</strong> how many
              pages and tokens each AI extraction used, so we can see the cost and apply the free
              allowance. This row records no image and no menu content.
            </li>
            <li>
              <strong className="font-medium text-stone-800">Abuse protection:</strong> a truncated
              one-way hash of the caller&apos;s address for rate limiting. The address itself is
              never stored, and the hash cannot be reversed into an address.
            </li>
            <li>
              <strong className="font-medium text-stone-800">Page views:</strong> a plain counter
              per published menu. No cookie, no fingerprint, no per-visitor record.
            </li>
          </ul>
        </Section>

        <Section title="What we never store">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="font-medium text-stone-800">Menu photos.</strong> Images are read in
              memory to extract the menu and are discarded; they are not written to disk or to
              object storage.
            </li>
            <li>
              <strong className="font-medium text-stone-800">Diner identities.</strong> No name, no
              email, no phone, no account, no device identifier.
            </li>
            <li>
              <strong className="font-medium text-stone-800">Payment data.</strong> Nothing is
              charged during the launch promotion, so we never see a card number.
            </li>
            <li>
              <strong className="font-medium text-stone-800">Advertising profiles.</strong> There
              are no ad networks, no tracking pixels, and no analytics cookies.
            </li>
          </ul>
        </Section>

        <Section title="Cookies and on-device storage">
          <p>
            The only cookie is a session cookie, set when you sign in so the app knows which account
            you are. Signing out clears it. If you use the app without signing in, menus stay in
            your browser&apos;s IndexedDB and never reach us, and a few small preferences (theme,
            checklist tick) stay in your browser&apos;s local storage.
          </p>
        </Section>

        <Section title="Who processes data for us">
          <p>
            Hosting and request logs: Vercel. Database: Neon. Sign-in email delivery: Resend. Menu
            extraction: Google&apos;s Gemini API, which receives the menu image and prompt for that
            request. We do not sell data or share it for advertising.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            Table orders are deleted automatically after 90 days. Menu content and your account stay
            until you delete them — you can export everything as JSON first. Extraction usage rows
            contain no diner data and are kept longer so cost accounting stays correct. Server
            request logs are kept by the hosting provider under its retention window and contain no
            request bodies.
          </p>
        </Section>

        <Section title="Your choices">
          <p>
            You can export your menus, published pages, and orders as JSON, and delete your account
            and its data, from the launch page. Deleting the account also deletes its menus,
            published revisions, and orders. If you need help with either, contact us.
          </p>
        </Section>

        <Section title="Contact">
          {email ? (
            <p>
              Questions about this policy or your data:{" "}
              <a className="font-medium text-amber-800 underline underline-offset-2" href={`mailto:${email}`}>
                {email}
              </a>
              .
            </p>
          ) : (
            <p>
              A support address has not been configured on this deployment yet. It will be published
              here before the promotion is advertised more widely.
            </p>
          )}
        </Section>

        <p className="mt-8 text-sm text-stone-500">
          See also the{" "}
          <Link href="/terms" className="font-medium text-amber-800 underline underline-offset-2">
            terms of use
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
