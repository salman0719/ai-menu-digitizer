import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { contactEmail, LEGAL_UPDATED, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Terms — ${SITE_NAME}`,
  description:
    "The plain terms for using Eateryo during the free launch: what the service does, what it does not do, and what we each owe each other.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-base font-semibold text-stone-900">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-stone-600">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  const email = contactEmail();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
          Terms of use
        </h1>
        <p className="mt-2 text-sm text-stone-500">Last updated {LEGAL_UPDATED}.</p>

        <Section title="The service">
          <p>
            {SITE_NAME} turns photos of a menu into an editable menu, publishes it at a public
            address, and lets diners at a table send orders to your staff board. During the launch
            promotion it is free to use.
          </p>
        </Section>

        <Section title="Free, and no payment step">
          <p>
            Nothing in the product charges you: there is no checkout, no card entry, no plan, and
            nothing to cancel. We will tell existing users before the free period ends and before
            any paid option is introduced. The free period has a usage allowance for AI extractions
            so that the service stays available to everyone; the app shows your allowance and the
            exact message you will see when it is used up.
          </p>
        </Section>

        <Section title="AI output is a draft, not a source of truth">
          <p>
            Extraction is done by an AI model. It is good at reading menus and it can still be
            wrong. Anything uncertain is flagged for review instead of guessed, and missing prices
            are left empty. You are responsible for checking names, prices, allergens, and
            availability before you publish. Do not rely on the app for allergy or dietary safety
            decisions.
          </p>
        </Section>

        <Section title="Orders are requests, not sales">
          <p>
            A table order is a request your staff can accept, serve, or cancel. {SITE_NAME} does not
            process payments, does not take a commission, and is not part of the contract between
            you and your guest. Money changes hands exactly as it did before.
          </p>
        </Section>

        <Section title="Your content">
          <p>
            Your menu, prices, and restaurant details remain yours. You give us permission to store
            them and to display the version you publish at your public address, and to send menu
            images to the AI provider for extraction. We do not use your menu content for
            advertising or sell it.
          </p>
        </Section>

        <Section title="Acceptable use">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Do not publish illegal, harmful, or deceptive content.</li>
            <li>
              Do not attempt to break the service, probe other accounts, or automate the public
              order endpoint.
            </li>
            <li>Only upload menus you have the right to use.</li>
            <li>
              Staff accounts are for people who work at the restaurant; do not share one sign-in
              across unrelated businesses.
            </li>
          </ul>
        </Section>

        <Section title="Availability">
          <p>
            This is an early service offered without an uptime guarantee. We work to keep it
            running and to tell you when something is wrong, but we may need to take it offline for
            maintenance. Keep a copy of your menu data — JSON export is always available.
          </p>
        </Section>

        <Section title="Ending use">
          <p>
            You can stop using the service at any time and delete your account and its data from
            the launch page. We may suspend an account that abuses the service or breaks these
            terms, and will say why unless doing so would expose someone else&apos;s data.
          </p>
        </Section>

        <Section title="Limits of liability">
          <p>
            To the extent the law allows, we are not liable for indirect losses, lost profit, or
            lost data arising from use of the service, and our total liability is limited to the
            amount you paid us — which, during the launch promotion, is nothing. Nothing here
            excludes liability that cannot lawfully be excluded.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            If these terms change in a way that matters, the new version is published here with a
            new date. Continuing to use the service after that means you accept it; if you do not,
            you can export your data and delete your account.
          </p>
        </Section>

        <Section title="Contact">
          {email ? (
            <p>
              Questions about these terms:{" "}
              <a
                className="font-medium text-amber-800 underline underline-offset-2"
                href={`mailto:${email}`}
              >
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
          <Link href="/privacy" className="font-medium text-amber-800 underline underline-offset-2">
            privacy policy
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
