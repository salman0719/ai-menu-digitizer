/**
 * Small local primitive (AGENTS.md: Tailwind + small local primitives): a
 * pulsing placeholder block for loading states. Purely decorative — the
 * loading region around it carries `role="status"` and announces the wait,
 * so this stays `aria-hidden`.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-stone-200 ${className}`} />;
}
