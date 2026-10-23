import type { MouseEvent } from "react";

/**
 * The shared "nothing here yet" card behind the signed-in tabs (Tables,
 * Settings, Orders).
 *
 * An empty state that only *describes* where to go leaves the user hunting
 * for the tab it mentioned, so every card spells out the steps in order and
 * always carries a link to the place where the first step actually happens —
 * a guidance card with no button is a dead end.
 */
interface GuidanceCardProps {
  title: string;
  /** The steps to get unstuck, in the order the owner should take them. */
  steps: readonly string[];
  /** Where the first step happens. Always a link, never prose only. */
  action: { href: string; label: string };
}

/**
 * Navigate like the tab bar does: one history entry, no server request and
 * no page-component swap (a Next `<Link>` push can remount the app shell
 * and drop its state — or, when the target route is the page component
 * already mounted, leave the visible screen untouched while only the URL
 * changes). `HomeScreen` follows the new path via `usePathname`.
 */
function navigateInApp(event: MouseEvent<HTMLAnchorElement>, href: string) {
  // Modified clicks keep the browser's default (new tab, new window…).
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return;
  }
  event.preventDefault();
  window.history.pushState(null, "", href);
}

export function GuidanceCard({ title, steps, action }: GuidanceCardProps) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center">
      <p className="font-medium text-stone-900">{title}</p>
      <ol className="mx-auto mt-3 max-w-md space-y-2 text-left">
        {steps.map((step, index) => (
          <li key={step} className="flex items-start gap-2.5 text-sm leading-6 text-stone-600">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-white text-[11px] font-bold text-stone-400"
            >
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <a
        href={action.href}
        onClick={(event) => navigateInApp(event, action.href)}
        className="mt-4 inline-block rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
      >
        {action.label}
      </a>
    </div>
  );
}
