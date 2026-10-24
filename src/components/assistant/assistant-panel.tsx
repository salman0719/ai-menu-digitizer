"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  AssistantError,
  fetchAssistantUsage,
  sendAssistantMessage,
} from "@/features/assistant/client";
import {
  ASSISTANT_MAX_MESSAGE_CHARS,
  type AssistantHistoryMessage,
  type AssistantUsageSummary,
} from "@/features/assistant/schema";

/**
 * Assistant tab (A1) — help only.
 *
 * The panel is deliberately a small chat, not an editor: the route cannot
 * write, so the UI must not imply it can. History lives in component state
 * (bounded, never persisted); reloading clears the conversation.
 */

interface AssistantPanelProps {
  signedIn: boolean;
  /** Session still resolving: show a loading shape, never the sign-in card. */
  sessionPending?: boolean;
}

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const QUICK_PROMPTS = [
  "How do I publish my menu?",
  "Where do I set opening hours?",
  "How do table QR codes work?",
] as const;

let turnCounter = 0;
function nextTurnId(): string {
  turnCounter += 1;
  return `turn-${turnCounter}`;
}

function formatReset(iso: string | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AssistantPanel({ signedIn, sessionPending = false }: AssistantPanelProps) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<AssistantUsageSummary | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const summary = await fetchAssistantUsage();
        if (!cancelled) setUsage(summary);
      } catch (loadError) {
        if (!cancelled) {
          setUsageError(
            loadError instanceof AssistantError
              ? loadError.message
              : "Could not load the assistant allowance."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }, [turns, sending]);

  const exhausted = usage !== null && usage.remaining <= 0;
  const disabled = !signedIn || sending || exhausted;

  const ask = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || sending || !signedIn) return;
      if (usage !== null && usage.remaining <= 0) return;

      const history: AssistantHistoryMessage[] = turns.slice(-6).map((turn) => ({
        role: turn.role,
        content: turn.content,
      }));

      setSending(true);
      setError(null);
      setDraft("");
      const userTurn: ChatTurn = { id: nextTurnId(), role: "user", content: message };
      setTurns((current) => [...current, userTurn]);

      try {
        const reply = await sendAssistantMessage({ message, history });
        setTurns((current) => [
          ...current,
          { id: nextTurnId(), role: "assistant", content: reply.reply },
        ]);
        setUsage(reply.usage);
        setUsageError(null);
      } catch (sendError) {
        // The optimistic turn is removed so the conversation never shows a
        // question the server did not answer; the draft is restored for retry.
        setTurns((current) => current.filter((turn) => turn.id !== userTurn.id));
        setDraft(message);
        setError(
          sendError instanceof AssistantError
            ? sendError.message
            : "The assistant is unavailable right now. Try again in a moment."
        );
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [sending, signedIn, turns, usage]
  );

  if (sessionPending) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-6" role="status">
        <span className="sr-only">Loading the assistant…</span>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-4 h-24 w-full" />
        <Skeleton className="mt-3 h-10 w-32" />
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center">
        <p className="font-medium text-stone-900">Sign in to use the assistant</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">
          The assistant answers questions about Eateryo using your own restaurant and menu names. It
          needs an account so answers stay scoped to your data and the cost stays capped.
        </p>
        <a
          href="/sign-in"
          className="mt-4 inline-block rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          Sign in
        </a>
      </div>
    );
  }

  const resetLabel = formatReset(usage?.periodEnd);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="assistant-heading">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 id="assistant-heading" className="text-xl font-semibold text-stone-900">
            Assistant
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Answers come from Eateryo&rsquo;s own feature list. It cannot make changes yet.
          </p>
        </div>
        {usage && (
          <p className="text-xs text-stone-500">
            {usage.remaining} of {usage.cap} messages left
            {resetLabel ? ` · resets ${resetLabel}` : ""}
          </p>
        )}
      </div>

      {usageError && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {usageError}
        </p>
      )}

      {exhausted && (
        <p
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          This account has used all {usage?.cap} assistant messages for this month.
          {resetLabel ? ` The allowance resets on ${resetLabel}.` : ""}
        </p>
      )}

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Assistant conversation"
        className="flex max-h-[28rem] min-h-48 flex-col gap-3 overflow-y-auto rounded-2xl border border-stone-200 bg-white p-4"
      >
        {turns.length === 0 && !sending ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-stone-600">
              Ask how to do something in Eateryo — publishing, table QR codes, opening hours, team
              access.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void ask(prompt)}
                  className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn) => (
            <article
              key={turn.id}
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-6 ${
                turn.role === "user"
                  ? "self-end bg-stone-900 text-white"
                  : "self-start bg-stone-100 text-stone-800"
              }`}
            >
              <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide opacity-60">
                {turn.role === "user" ? "You" : "Assistant"}
              </p>
              <p className="whitespace-pre-wrap">{turn.content}</p>
            </article>
          ))
        )}
        {sending && (
          <p
            role="status"
            className="self-start rounded-2xl bg-stone-100 px-4 py-2.5 text-sm text-stone-600"
          >
            Thinking…
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft);
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor="assistant-message" className="sr-only">
          Ask the assistant
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="assistant-message"
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, ASSISTANT_MAX_MESSAGE_CHARS))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(draft);
              }
            }}
            rows={2}
            maxLength={ASSISTANT_MAX_MESSAGE_CHARS}
            disabled={disabled}
            placeholder={exhausted ? "Monthly allowance reached" : "Ask a question…"}
            className="min-h-14 flex-1 resize-y rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:bg-stone-100"
          />
          <button
            type="submit"
            disabled={disabled || draft.trim().length === 0}
            className="rounded-full bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
        <p className="text-xs text-stone-500">
          Enter sends · Shift + Enter adds a line · {draft.length}/{ASSISTANT_MAX_MESSAGE_CHARS}
        </p>
      </form>
    </section>
  );
}
