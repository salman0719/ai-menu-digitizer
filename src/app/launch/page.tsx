import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { LaunchChecklist } from "@/components/launch/launch-checklist";

export const metadata: Metadata = {
  title: "Free while it lasts — Eateryo",
  description:
    "Turn a menu photo into a public menu link with QR table ordering. Free during the Eateryo launch promotion — no card, no checkout.",
};

const WHAT_YOU_GET = [
  {
    title: "A menu photo, turned into a menu",
    body: "Upload up to four pages at once. Every name, section, and price is read into a draft you can edit — and anything the AI was unsure about is flagged instead of invented.",
  },
  {
    title: "Your own public link",
    body: "Publish to a link like /r/your-cafe/m/lunch. It opens on any phone with no login, shows your menu with your chosen theme, and only changes when you press Publish.",
  },
  {
    title: "QR codes for every table",
    body: "Print one card per table from the editor. Scanning it opens your menu and the order screen for that table — no app to install.",
  },
  {
    title: "Orders that reach the counter",
    body: "A diner sends items and quantities; the server prices them from the published menu, so a tampered page cannot invent a cheaper total. New orders show up on your board within seconds.",
  },
  {
    title: "A board for the whole team",
    body: "Sign in on the till and on a second phone: both see the same orders, and a status change on one appears on the other without refreshing.",
  },
  {
    title: "Nothing to install",
    body: "It runs in the browser. You can try the editor before signing in — the draft stays in that browser until you do.",
  },
];

export default function LaunchPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <p className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
          Free while it lasts — no payment step
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
          One photo to a live menu with table ordering
        </h1>
        <p className="mt-3 max-w-2xl text-base text-stone-600">
          During the launch promotion, everything here is free: your public menu page, the QR table
          cards, and the live order board. There is no checkout, no card, and no plan to cancel.
        </p>
        <p className="mt-2 max-w-2xl text-sm text-stone-500">
          We will tell cafés already using it before anything about that ever changes.
        </p>

        <div className="mt-6">
          <LaunchChecklist />
        </div>

        <section className="mt-10">
          <h2 className="text-xl font-bold tracking-tight text-stone-900">What you get</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {WHAT_YOU_GET.map((item) => (
              <li key={item.title} className="rounded-2xl border border-stone-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-stone-900">{item.title}</h3>
                <p className="mt-1 text-sm text-stone-600">{item.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10 rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-base font-semibold text-stone-900">What it is not</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-stone-600">
            <li>
              <strong className="font-medium text-stone-800">Not a payment system.</strong> Diners
              order; money still changes hands at the counter, exactly as it does today.
            </li>
            <li>
              <strong className="font-medium text-stone-800">No diner accounts.</strong> A guest
              types nothing but their table number. We never ask for a name, phone, or email.
            </li>
            <li>
              <strong className="font-medium text-stone-800">No stored menu photos.</strong> Images
              are read in memory to extract the menu and are not kept on the server.
            </li>
          </ul>
        </section>

        <section className="mt-6 rounded-2xl border border-stone-200 bg-stone-50 p-5">
          <h2 className="text-base font-semibold text-stone-900">Taking it step by step</h2>
          <p className="mt-1 text-sm text-stone-600">
            The checklist above is the whole process, in order. If a step does not apply to you
            yet, it stays open — nothing is marked done that we did not actually see. Printing is
            the one exception, which is why you tick it yourself.
          </p>
          <Link
            href="/"
            className="mt-3 inline-flex text-sm font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
          >
            Open the editor
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
