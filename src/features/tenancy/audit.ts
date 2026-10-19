import { and, desc, eq } from "drizzle-orm";

import { restaurantAuditEvent, restaurantMembership, user } from "@/lib/db/schema";
import type { AuditAction } from "@/lib/db/schema";
import { logEvent } from "@/lib/observability/log";
import type { TenancyDb } from "./repo";

/**
 * Team audit trail (server-only). Every membership mutation and invitation
 * action records one row with snapshots of the actor and target, so the
 * settings screen can answer "who changed what, and when" even after an
 * account is deleted. Writes are best-effort: the mutation has already
 * succeeded, and a failed audit line must not turn it into an error the
 * caller would retry (which would duplicate the action).
 */

export const AUDIT_EVENT_LIMIT = 20;

export interface AuditEventInput {
  restaurantId: string;
  actorUserId: string;
  action: AuditAction;
  targetEmail?: string | null;
  targetName?: string | null;
  detail?: string | null;
}

export interface AuditEvent {
  id: string;
  action: AuditAction;
  actorName: string;
  targetEmail: string | null;
  targetName: string | null;
  detail: string | null;
  createdAt: Date;
}

/** Record one team action (never throws — failures are logged). */
export async function recordAuditEvent(db: TenancyDb, input: AuditEventInput): Promise<void> {
  try {
    const actors = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, input.actorUserId))
      .limit(1);
    const actorName = actors[0]?.name?.trim() || "Someone";
    await db.insert(restaurantAuditEvent).values({
      restaurantId: input.restaurantId,
      actorUserId: input.actorUserId,
      actorName,
      action: input.action,
      targetEmail: input.targetEmail ?? null,
      targetName: input.targetName ?? null,
      detail: input.detail ?? null,
    });
  } catch (error) {
    logEvent("error", "audit.write_failed", {
      action: input.action,
      restaurantId: input.restaurantId,
      ...(error instanceof Error ? { name: error.name, message: error.message } : {}),
    });
  }
}

/**
 * Recent events for any member of the restaurant (newest first), or null
 * when the caller is not a member — the route turns that into a 404 so
 * restaurant ids stay unprobeable across accounts.
 */
export async function listAuditEventsForUser(
  db: TenancyDb,
  userId: string,
  restaurantId: string,
  limit: number = AUDIT_EVENT_LIMIT
): Promise<AuditEvent[] | null> {
  const membership = await db
    .select({ id: restaurantMembership.id })
    .from(restaurantMembership)
    .where(
      and(
        eq(restaurantMembership.restaurantId, restaurantId),
        eq(restaurantMembership.userId, userId)
      )
    )
    .limit(1);
  if (!membership[0]) return null;

  return db
    .select({
      id: restaurantAuditEvent.id,
      action: restaurantAuditEvent.action,
      actorName: restaurantAuditEvent.actorName,
      targetEmail: restaurantAuditEvent.targetEmail,
      targetName: restaurantAuditEvent.targetName,
      detail: restaurantAuditEvent.detail,
      createdAt: restaurantAuditEvent.createdAt,
    })
    .from(restaurantAuditEvent)
    .where(eq(restaurantAuditEvent.restaurantId, restaurantId))
    .orderBy(desc(restaurantAuditEvent.createdAt))
    .limit(limit);
}
