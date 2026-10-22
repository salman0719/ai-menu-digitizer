import { notFound } from "next/navigation";

/**
 * The old global `/m/<slug>/order` address, kept as a fallback only.
 *
 * As with `/m/<slug>`, the proxy redirects live menus to their canonical
 * `/r/<restaurant>/m/<menu>/order` page (query string intact), so only dead
 * links land here — and the segment's not-found page says so plainly.
 */
export default function LegacyMenuOrderPage() {
  notFound();
}
