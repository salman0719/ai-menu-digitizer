/**
 * Retention rules (Step 11). Orders are the only table that grows without a
 * natural end, so there is a purge with a configurable window (90 days by
 * default).
 *
 * PARKED: automatic scheduling is off (Vercel cron needs a paid plan), so
 * this window applies whenever the maintenance purge is run — by hand, or by
 * whatever scheduler we add later. Nothing deletes orders on its own today.
 */

export const DEFAULT_ORDER_RETENTION_DAYS = 90;
/** Guards against a typo turning "90 days" into ten years or ten minutes. */
export const MAX_ORDER_RETENTION_DAYS = 3650;

export const ORDER_RETENTION_DAYS_ENV = "ORDER_RETENTION_DAYS";

export function orderRetentionDays(
  env: Record<string, string | undefined> = process.env
): number {
  const parsed = Number(env[ORDER_RETENTION_DAYS_ENV]);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_ORDER_RETENTION_DAYS;
  return Math.min(Math.trunc(parsed), MAX_ORDER_RETENTION_DAYS);
}

/** Anything strictly older than this is purged. */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
