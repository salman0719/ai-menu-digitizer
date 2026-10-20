import type { AuditAction } from "@/lib/db/schema";

/**
 * Human sentences for audit rows (client-safe: no Drizzle, no DB access).
 * The server snapshots names at write time, so these read well even after a
 * teammate's account or membership is gone.
 */

export interface AuditEventView {
  action: AuditAction;
  actorName: string;
  targetEmail: string | null;
  targetName: string | null;
  detail: string | null;
}

const ROLE_LABELS: Record<string, string> = { owner: "an owner", staff: "staff" };

/** "an owner" / "staff" for a role snapshot; the raw value if unexpected. */
function roleLabel(role: string | null): string {
  if (!role) return "a teammate";
  return ROLE_LABELS[role] ?? role;
}

/** The teammate an event is about: their name when known, else their email. */
function targetLabel(event: AuditEventView): string {
  return event.targetName?.trim() || event.targetEmail?.trim() || "a teammate";
}

/** One readable line per audit event. */
export function describeAuditEvent(event: AuditEventView): string {
  const actor = event.actorName.trim() || "Someone";
  const target = targetLabel(event);
  switch (event.action) {
    case "invitation_sent":
      return `${actor} invited ${target} as ${roleLabel(event.detail)}.`;
    case "invitation_resent":
      return `${actor} sent ${target} a new invitation link.`;
    case "invitation_revoked":
      return `${actor} revoked the invitation for ${target}.`;
    case "invitation_accepted":
      return `${target} accepted the invitation and joined as ${roleLabel(event.detail)}.`;
    case "member_added":
      return `${actor} added ${target} as ${roleLabel(event.detail)}.`;
    case "member_role_changed":
      return `${actor} changed ${target}'s role from ${formatRoleChange(event.detail)}.`;
    case "member_removed":
      return `${actor} removed ${target}.`;
    default:
      return `${actor} changed the team.`;
  }
}

/** "staff → owner" becomes "staff to an owner"; tolerates a bare role. */
function formatRoleChange(detail: string | null): string {
  if (!detail) return "one role to another";
  const [from, to] = detail.split("→").map((part) => part.trim());
  if (!from || !to) return "one role to another";
  return `${roleLabel(from)} to ${roleLabel(to)}`;
}
