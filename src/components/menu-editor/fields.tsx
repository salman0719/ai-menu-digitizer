"use client";

import { useState } from "react";
import { flushSync } from "react-dom";

/**
 * Inputs that commit on blur/Enter and revert on invalid values, so the
 * document only ever holds valid data (helpers throw on empty names, and
 * saves validate with Zod). Parents can assume committed values are valid.
 */

interface CommitInputProps {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  validate?: (value: string) => string | null;
  placeholder?: string;
  multiline?: boolean;
  inputClassName?: string;
}

const baseInput =
  "w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 " +
  // Textareas get no resize handle on touch (undraggable); desktop keeps vertical resize.
  "resize-none focus:border-amber-700 focus:outline-none sm:resize-y";

export function CommitInput({
  label,
  value,
  onCommit,
  validate,
  placeholder,
  multiline,
  inputClassName,
}: CommitInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function commit(next: string) {
    const problem = validate ? validate(next) : next.trim() ? null : "Must not be empty.";
    // Flush synchronously: a blur is almost always followed by a button click
    // (same tick, batched by React). Without this, the click handler would
    // close over pre-commit state and silently discard this edit.
    flushSync(() => {
      if (problem) {
        setError(problem);
        setDraft(null);
        return;
      }
      setError(null);
      setDraft(null);
      if (next !== value) {
        try {
          onCommit(next);
        } catch {
          setError("That value was rejected.");
        }
      }
    });
  }

  const shared = {
    "aria-label": label,
    placeholder,
    value: draft ?? value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(event.target.value);
      if (error) setError(null);
    },
    onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      commit(event.target.value),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" && !multiline) {
        (event.target as HTMLElement).blur();
      }
      if (event.key === "Escape") {
        setDraft(null);
        setError(null);
        (event.target as HTMLElement).blur();
      }
    },
    className: [baseInput, error ? "border-red-500" : "", inputClassName ?? ""].join(" "),
  };

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-500">{label}</span>
      {multiline ? <textarea rows={2} {...shared} /> : <input type="text" {...shared} />}
      {error && <span className="mt-0.5 block text-xs text-red-700">{error}</span>}
    </label>
  );
}

interface CommitNumberProps {
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  placeholder?: string;
  inputClassName?: string;
}

export function CommitNumber({
  label,
  value,
  onCommit,
  placeholder,
  inputClassName,
}: CommitNumberProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function commit(raw: string) {
    // See CommitInput: flush synchronously so a following click in the same
    // tick observes the committed value instead of stale state.
    flushSync(() => {
      const trimmed = raw.trim();
      if (trimmed === "") {
        setError(null);
        setDraft(null);
        if (value !== null) onCommit(null);
        return;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError("Enter a price of 0 or more, or leave blank.");
        setDraft(null);
        return;
      }
      setError(null);
      setDraft(null);
      const rounded = Math.round(parsed * 100) / 100;
      if (rounded !== value) onCommit(rounded);
    });
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-500">{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        aria-label={label}
        placeholder={placeholder}
        value={draft ?? (value === null ? "" : String(value))}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError(null);
        }}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLElement).blur();
          if (event.key === "Escape") {
            setDraft(null);
            setError(null);
            (event.target as HTMLElement).blur();
          }
        }}
        className={[baseInput, error ? "border-red-500" : "", inputClassName ?? ""].join(" ")}
      />
      {error && <span className="mt-0.5 block text-xs text-red-700">{error}</span>}
    </label>
  );
}
