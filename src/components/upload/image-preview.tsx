"use client";

import { formatFileSize } from "@/lib/image-constraints";

interface ImagePreviewProps {
  file: File;
  previewUrl: string;
  onReplace: () => void;
  onRemove: () => void;
}

export function ImagePreview({ file, previewUrl, onReplace, onRemove }: ImagePreviewProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
      <div className="flex items-center justify-center bg-stone-100 p-4">
        {/* Plain img keeps EXIF orientation handling simple for the prototype. */}
        <img
          src={previewUrl}
          alt={`Preview of ${file.name}`}
          className="max-h-72 w-auto rounded-lg object-contain shadow-sm"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-stone-900">{file.name}</p>
          <p className="text-xs text-stone-500">
            {formatFileSize(file.size)} · {file.type.replace("image/", "").toUpperCase()}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReplace}
            className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-red-700 hover:text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
