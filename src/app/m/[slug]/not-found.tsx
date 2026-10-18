import Link from "next/link";

/**
 * Shown for unknown slugs and for links the café has unpublished. It says
 * plainly that the address is not serving — it never hints at whether the
 * slug exists somewhere else, and it carries no stale menu content.
 */
export default function MenuNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-3 px-4 py-16 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-stone-900">This menu isn’t live</h1>
      <p className="text-sm leading-6 text-stone-600">
        The link may be mistyped, or the café hasn’t published this menu yet. Ask them for the
        current link — a printed table card or QR code has it.
      </p>
      <p className="mt-2 text-sm text-stone-500">
        <Link
          href="/"
          className="font-medium text-amber-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          Tablepass
        </Link>{" "}
        turns menu photos into editable, shareable menus.
      </p>
    </main>
  );
}
