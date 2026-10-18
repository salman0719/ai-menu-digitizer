import Link from "next/link";

/** Footer for the marketing/legal pages. Plain links, no client JS. */
export function SiteFooter() {
  return (
    <footer data-print-hide className="mt-12 border-t border-stone-200 bg-white/60">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-stone-500">
        <p>Tablepass — free while it lasts. No payment step anywhere.</p>
        <nav aria-label="Legal" className="flex items-center gap-4">
          <Link href="/launch" className="hover:text-stone-800">
            Get started
          </Link>
          <Link href="/privacy" className="hover:text-stone-800">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-stone-800">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
