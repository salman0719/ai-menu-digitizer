"use client";

import { useRef, useState } from "react";

import { SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/image-constraints";

interface DropzoneProps {
  onSelect: (file: File) => void;
  disabled?: boolean;
}

export function Dropzone({ onSelect, disabled = false }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function takeFile(file: File | undefined | null) {
    if (file) onSelect(file);
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="Upload a menu image"
      onClick={() => {
        if (!disabled) inputRef.current?.click();
      }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !disabled) {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) takeFile(event.dataTransfer.files[0]);
      }}
      className={[
        "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700",
        dragging
          ? "border-amber-700 bg-amber-50"
          : "border-stone-300 bg-white hover:border-amber-600 hover:bg-amber-50/50",
        disabled ? "cursor-not-allowed opacity-60" : "",
      ].join(" ")}
    >
      <svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
        className="text-amber-800"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
        />
      </svg>
      <div>
        <p className="text-base font-semibold text-stone-900">
          Drag &amp; drop your menu image here
        </p>
        <p className="mt-1 text-sm text-stone-600">
          or <span className="font-medium text-amber-800 underline">browse files</span> — JPEG, PNG,
          or WebP, up to 4&nbsp;MB
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_IMAGE_MIME_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          takeFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
