import type { ReactNode } from "react";

/**
 * A phone bezel around a live component (the menu preview, not a screenshot).
 * Used by the publish success screen so the owner sees the page the way a
 * guest will, without leaving the app.
 */
export function PhoneFrame({
  children,
  label,
}: {
  children: ReactNode;
  /** Accessible description of what the framed view shows. */
  label: string;
}) {
  return (
    <figure aria-label={label} className="mx-auto w-full max-w-[340px]">
      <div className="rounded-[2.4rem] border-[10px] border-stone-900 bg-stone-900 shadow-xl">
        <div className="relative max-h-[580px] overflow-y-auto rounded-[1.7rem] bg-white">
          <div
            aria-hidden="true"
            className="sticky top-0 z-10 mx-auto h-5 w-24 rounded-b-2xl bg-stone-900"
          />
          <div className="p-2">{children}</div>
        </div>
      </div>
      <figcaption className="mt-2 text-center text-[11px] text-stone-500">{label}</figcaption>
    </figure>
  );
}
