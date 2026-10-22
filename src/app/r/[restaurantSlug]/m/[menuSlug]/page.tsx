import { Suspense, cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MenuPreview } from "@/components/menu-editor/menu-preview";
import { ViewCounter } from "@/components/menu-editor/view-counter";
import { getPublishedMenuByPath } from "@/features/publishing/repo";
import { isSlug } from "@/features/publishing/slug";
import { getDb } from "@/lib/db";

/**
 * Public menu page (Step 9, `/r/<restaurant>/m/<menu>`).
 *
 * The address is scoped to the café that publishes it: menu slugs are only
 * unique inside one restaurant, so two cafés can both publish `lunch`
 * under their own `/r/` address.
 *
 * Renders the stored revision snapshot — never the live menu document — so an
 * owner's later edits cannot change what a diner sees until "Publish changes"
 * is pressed. Only live publications exist here: unpublished or unknown
 * addresses get a 404, and the café's slug stays reserved either way.
 *
 * No account, no cookie, and no client data is required: a stranger's phone
 * sees exactly the themed menu. Review notes and AI review badges never
 * render (MenuPreview is the diner surface), and missing prices stay honest.
 */

/** De-duplicates the slug lookup between metadata and the page render. */
const loadPublishedMenu = cache(
  async (restaurantSlug: string, slug: string) => {
    if (!isSlug(restaurantSlug) || !isSlug(slug)) return null;
    return getPublishedMenuByPath(getDb(), restaurantSlug, slug);
  }
);

function itemCount(doc: { categories: { items: unknown[] }[] }): number {
  return doc.categories.reduce((sum, category) => sum + category.items.length, 0);
}

function describe(doc: { categories: { items: unknown[] }[] }, restaurant: string): string {
  const items = itemCount(doc);
  if (items === 0) return `The menu for ${restaurant}.`;
  return `${items} ${items === 1 ? "item" : "items"} across ${doc.categories.length} ${
    doc.categories.length === 1 ? "category" : "categories"
  } — ${restaurant}.`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ restaurantSlug: string; menuSlug: string }>;
}): Promise<Metadata> {
  const { restaurantSlug, menuSlug } = await params;
  const page = await loadPublishedMenu(restaurantSlug, menuSlug);
  if (!page) {
    return {
      title: "Menu not published · Tablepass",
      robots: { index: false, follow: false },
    };
  }
  const title = page.doc.title.trim() || "Menu";
  const description = describe(page.doc, page.restaurantName);
  return {
    title: `${title} · Tablepass`,
    description,
    // Noindex by default: a café opts into being found later, not by
    // publishing a link for its own tables.
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "website", siteName: "Tablepass" },
    twitter: { card: "summary", title, description },
  };
}

/**
 * Under Cache Components the address and the database read are request-time
 * data, so the page is a static shell plus a streamed menu: the visitor sees
 * the page frame immediately and the menu fills in as soon as the query
 * returns. Reading the DB at the top level of the page would block the whole
 * response, which the build rejects.
 */
export default function PublishedMenuPage({
  params,
}: {
  params: Promise<{ restaurantSlug: string; menuSlug: string }>;
}) {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <PublishedMenu params={params} />
    </Suspense>
  );
}

function MenuSkeleton() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-12">
      <span className="sr-only">Loading the menu…</span>
      <div className="animate-pulse rounded-2xl bg-stone-100 px-6 py-16" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="h-40 animate-pulse rounded-2xl bg-stone-100" />
        <div className="h-40 animate-pulse rounded-2xl bg-stone-100" />
      </div>
    </main>
  );
}

async function PublishedMenu({
  params,
}: {
  params: Promise<{ restaurantSlug: string; menuSlug: string }>;
}) {
  const { restaurantSlug, menuSlug } = await params;
  const page = await loadPublishedMenu(restaurantSlug, menuSlug);
  if (!page) notFound();

  const title = page.doc.title.trim() || "Untitled menu";

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-12">
        <p className="mb-3 text-center text-[11px] font-semibold tracking-[0.25em] text-stone-400 uppercase">
          {page.restaurantName}
        </p>
        <MenuPreview doc={page.doc} themeId={page.theme} layout={page.layout} eyebrow="Menu" />
        <ViewCounter restaurantSlug={page.restaurantSlug} slug={page.slug} />
        <footer className="mt-8 border-t border-stone-200 pt-4 text-center text-xs text-stone-500">
          <p>
            {title} · menu updated{" "}
            <time dateTime={page.publishedAt}>
              {new Date(page.publishedAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
          </p>
          <p className="mt-1">Published with Tablepass</p>
        </footer>
      </main>
    </div>
  );
}
