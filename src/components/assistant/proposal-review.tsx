"use client";

import { useState } from "react";

import {
  ASSISTANT_MAX_PRICE,
  type AssistantProposal,
  type ProposalChange,
} from "@/features/assistant/proposal";

/**
 * Review card for an assistant proposal (A3).
 *
 * The diff comes from the server's dry run, never from the model's prose.
 * The one editable field is the price: it is the fact most often missing or
 * wrong in a spoken request ("add a burger for fourteen ninety"), and the
 * approval endpoint re-validates whatever is sent. Every other change uses
 * the "Edit in editor" escape hatch, which is a full page load so the editor
 * cannot show a stale revision.
 *
 * The conflict state is deliberately not the editor's ConflictBanner: there
 * is no second version to choose here. A stale proposal can only be
 * re-requested against the newer menu, never applied over it.
 */

interface ProposalReviewProps {
  proposal: AssistantProposal;
  menuTitle: string;
  editorHref: string;
  busy: boolean;
  stale: boolean;
  error: string | null;
  onPriceChange: (operationIndex: number, price: number) => void;
  onApprove: () => void;
  onDiscard: () => void;
  onReviewAgain: () => void;
}

function ChangeRow({ change }: { change: ProposalChange }) {
  return (
    <div className="grid gap-0.5 text-xs sm:grid-cols-[7.5rem_1fr]">
      <dt className="font-medium text-stone-600">{change.label}</dt>
      <dd className="text-stone-800">
        {change.before !== null && (
          <>
            <span className="text-stone-500 line-through">{change.before}</span>
            <span aria-hidden="true" className="px-1 text-stone-400">
              →
            </span>
          </>
        )}
        <span className="font-medium">{change.after ?? "—"}</span>
      </dd>
    </div>
  );
}

/** Price input local to one operation; commits every valid keystroke. */
function PriceField({
  price,
  currency,
  index,
  disabled,
  onCommit,
  onValidityChange,
}: {
  price: number;
  currency: string | null;
  index: number;
  disabled: boolean;
  onCommit: (index: number, price: number) => void;
  onValidityChange: (index: number, invalid: boolean) => void;
}) {
  const [draft, setDraft] = useState(String(price));
  const [error, setError] = useState<string | null>(null);

  function parse(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0 || value > ASSISTANT_MAX_PRICE) return null;
    return value;
  }

  function handleChange(raw: string) {
    setDraft(raw);
    const value = parse(raw);
    if (value === null) {
      setError("Enter a price of 0 or more.");
      onValidityChange(index, true);
      return;
    }
    setError(null);
    onValidityChange(index, false);
    if (value !== price) onCommit(index, value);
  }

  function handleBlur() {
    const value = parse(draft);
    if (value === null) {
      onValidityChange(index, true);
      return;
    }
    setDraft(String(value));
    setError(null);
    onValidityChange(index, false);
    if (value !== price) onCommit(index, value);
  }

  return (
    <label className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-stone-600">
      <span>Price</span>
      <span className="flex items-center gap-1.5">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={disabled}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={handleBlur}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              (event.target as HTMLInputElement).blur();
            }
          }}
          aria-label="Proposed price"
          aria-invalid={error !== null}
          className={`w-24 rounded-lg border px-2 py-1 text-sm font-normal text-stone-900 focus:border-amber-700 focus:outline-none disabled:bg-stone-100 ${
            error ? "border-red-500" : "border-stone-300"
          }`}
        />
        {currency && <span className="font-normal text-stone-500">{currency}</span>}
      </span>
      {error && (
        <span role="alert" className="font-normal text-red-700">
          {error}
        </span>
      )}
      <span className="font-normal text-stone-500">You can correct this before approving.</span>
    </label>
  );
}

export function ProposalReview({
  proposal,
  menuTitle,
  editorHref,
  busy,
  stale,
  error,
  onPriceChange,
  onApprove,
  onDiscard,
  onReviewAgain,
}: ProposalReviewProps) {
  const [invalidPrices, setInvalidPrices] = useState<ReadonlySet<number>>(new Set());

  function setPriceValidity(index: number, invalid: boolean) {
    setInvalidPrices((current) => {
      const next = new Set(current);
      if (invalid) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  const approveDisabled = busy || stale || invalidPrices.size > 0;

  return (
    <section
      aria-labelledby="proposal-heading"
      aria-busy={busy}
      className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="proposal-heading" className="text-sm font-semibold text-stone-900">
          Proposed change
        </h2>
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900">
          Not saved yet
        </span>
        <span className="flex-1" />
        <span className="text-xs text-stone-500">{menuTitle}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-stone-600">
        This diff is computed from your menu, not from the assistant&rsquo;s description. Nothing is
        written until you approve.
      </p>

      <p className="mt-2 text-xs text-stone-500">
        {proposal.preview.before.items} → {proposal.preview.after.items} items ·{" "}
        {proposal.preview.before.categories} → {proposal.preview.after.categories} categories
      </p>

      <ol className="mt-3 flex flex-col gap-2">
        {proposal.operations.map((operation, index) => {
          const preview = proposal.preview.operations[index];
          const hasPrice =
            (operation.op === "add_item" || operation.op === "update_item") &&
            typeof operation.price === "number";
          return (
            <li
              key={`${operation.op}-${index}`}
              className="rounded-xl border border-stone-200 bg-stone-50 p-3"
            >
              <p className="text-sm font-medium text-stone-900">
                {preview?.summary ?? operation.op.replaceAll("_", " ")}
              </p>
              {preview && preview.changes.length > 0 && (
                <dl className="mt-2 flex flex-col gap-1">
                  {preview.changes.map((change) => (
                    <ChangeRow
                      key={`${change.label}-${change.before}-${change.after}`}
                      change={change}
                    />
                  ))}
                </dl>
              )}
              {hasPrice && (
                <PriceField
                  price={operation.price as number}
                  currency={proposal.currency}
                  index={index}
                  disabled={busy}
                  onCommit={onPriceChange}
                  onValidityChange={setPriceValidity}
                />
              )}
            </li>
          );
        })}
      </ol>

      {stale && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900"
        >
          <p className="font-semibold">This menu changed after the preview</p>
          <p className="mt-0.5">
            Another tab or device saved a newer version, so this proposal cannot be applied safely.
            Review a fresh proposal, or open the editor.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onReviewAgain}
              className="rounded-full bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800"
            >
              Review again
            </button>
            <a
              href={editorHref}
              className="rounded-full border border-amber-700 px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              Open editor
            </a>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={approveDisabled}
          className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-stone-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          {busy ? "Saving…" : "Approve and save"}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy}
          className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-stone-400 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          Discard
        </button>
        <a
          href={editorHref}
          className="text-xs font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          Edit in editor
        </a>
      </div>

      <p className="mt-2 text-xs text-stone-500">
        This changes your draft only — diners keep seeing the published version until you publish
        changes.
      </p>
    </section>
  );
}
