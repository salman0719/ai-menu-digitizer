import { notFound } from "next/navigation";

/**
 * The old global `/m/<slug>` address, kept as a fallback only.
 *
 * A live menu at this address is redirected to its canonical
 * `/r/<restaurant>/m/<menu>` page by the proxy (`src/proxy.ts`) before this
 * route is ever rendered, so what reaches this page is always an unknown,
 * unpublished, or renamed-away slug. Rendering the segment's not-found copy
 * is the honest answer: the address is not serving, and it never hints at
 * whether the menu exists under a different café or address.
 */
export default function LegacyMenuPage() {
  notFound();
}
