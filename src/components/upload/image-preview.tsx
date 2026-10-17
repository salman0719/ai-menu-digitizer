"use client";

import { formatFileSize, MAX_MENU_PAGES, mimeTypeFromFileName } from "@/lib/image-constraints";

/** One selected page: the file plus its live preview URL (owned by the page). */
export interface PageImage {
  file: File;
  previewUrl: string;
}

interface ImagePreviewProps {
  pages: PageImage[];
  /** Open the file picker to append another page. */
  onAdd: () => void;
  /** Replace the page at `index` with a newly picked file. */
  onReplace: (index: number) => void;
  /** Remove the page at `index` (removing the last one returns to the dropzone). */
  onRemove: (index: number) => void;
}

export function ImagePreview({ pages, onAdd, onReplace, onRemove }: ImagePreviewProps) {
  const atPageLimit = pages.length >= MAX_MENU_PAGES;

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-900">
            {pages.length === 1 ? "Menu image" : `${pages.length} page images`}
          </p>
          <p className="text-xs text-stone-500">
            {pages.length === 1
              ? "Add more pages if the menu spans several images — they merge into one menu."
              : "Pages are sent together and merged into one menu."}
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={atPageLimit}
          title={atPageLimit ? `A menu can have up to ${MAX_MENU_PAGES} pages.` : undefined}
          className="shrink-0 rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          + Add page
        </button>
      </div>

      <ul className="grid gap-3 p-4 sm:grid-cols-2">
        {pages.map((page, index) => (
          <li
            key={`${page.file.name}-${index}`}
            className="overflow-hidden rounded-xl border border-stone-200"
          >
            <div className="flex items-center justify-center bg-stone-100 p-3">
              {/* Plain img keeps EXIF orientation handling simple for the prototype. */}
              <img
                src={page.previewUrl}
                alt={`Page ${index + 1} preview of ${page.file.name}`}
                className="max-h-44 w-auto max-w-full object-contain shadow-sm"
              />
            </div>
            <div className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded-full bg-stone-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                  Page {index + 1}
                </span>
                <p className="min-w-0 flex-1 truncate text-xs font-medium text-stone-900">
                  {page.file.name}
                </p>
              </div>
              <p className="mt-1 text-[11px] text-stone-500">
                {formatFileSize(page.file.size)} ·{" "}
                {(mimeTypeFromFileName(page.file.name) ?? page.file.type)
                  .replace("image/", "")
                  .toUpperCase()}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => onReplace(index)}
                  className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 transition-colors hover:border-red-700 hover:text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
