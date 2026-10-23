import { Suspense } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { HomeScreen } from "@/components/home-screen";
import { Skeleton } from "@/components/ui/skeleton";
import { parseAppRoute } from "@/features/navigation/routes";

/**
 * Deep links into an open menu: `/menus/<id>` and its mode or item
 * segments. Next 16 treats a dynamic segment as runtime data (see the
 * invitations page): `await params` must happen behind a Suspense boundary,
 * so the shell streams a placeholder first and the editor route arrives
 * with the path. Unknown shapes fall back to the library via
 * `parseAppRoute`, same as client-side navigation.
 */
export default function MenuPathPage({ params }: { params: Promise<{ path: string[] }> }) {
  return (
    <Suspense fallback={<MenuPathLoading />}>
      <MenuPathContent params={params} />
    </Suspense>
  );
}

async function MenuPathContent({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return <HomeScreen initialRoute={parseAppRoute(`/menus/${path.join("/")}`)} />;
}

function MenuPathLoading() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        <div role="status" aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">Opening menu…</span>
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-28 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-stone-200 bg-white p-5">
              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </div>
              <Skeleton className="mt-3 h-28" />
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-3 w-3/5" />
              <Skeleton className="mt-4 h-9" />
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
