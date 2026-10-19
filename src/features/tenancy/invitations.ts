import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import { restaurant, restaurantInvitation, restaurantMembership, user } from "@/lib/db/schema";
import type { RestaurantRole } from "@/lib/db/schema";
import type { TenancyDb } from "./repo";

/**
 * Email invitations for teammates who have never signed in (server-only).
 *
 * The invitation is a one-time token: only its SHA-256 hash is stored, the
 * raw token travels once in the email link, and accepting it requires a
 * signed-in account whose email matches the invite — owning the link is not
 * enough to join as someone else. Magic-link sign-in creates the account on
 * first use, then the accept call turns the invitation into a membership.
 *
 * Re-inviting the same address replaces the previous pending invitation, so
 * an old link stops working. Invitations expire after seven days.
 */

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitationStatus = "pending" | "expired" | "accepted";

export type InvitationErrorCode =
  | "not_found"
  | "forbidden"
  | "already_member"
  | "expired"
  | "used"
  | "wrong_account";

export class InvitationError extends Error {
  readonly code: InvitationErrorCode;

  constructor(code: InvitationErrorCode, message: string) {
    super(message);
    this.name = "InvitationError";
    this.code = code;
  }
}

/** An invitation as the invitee's page shows it (no token material). */
export interface InvitationDetails {
  restaurantId: string;
  restaurantName: string;
  email: string;
  role: RestaurantRole;
  expiresAt: Date;
  status: InvitationStatus;
}

/** What the owner's UI shows after an invite is sent. */
export interface InvitationSummary {
  email: string;
  role: RestaurantRole;
  expiresAt: Date;
}

export interface CreatedInvitation {
  invitation: InvitationSummary;
  /** Raw token — handed to the email sender and never stored. */
  token: string;
  restaurantName: string;
  inviterName: string;
}

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

function statusOf(row: { acceptedAt: Date | null; expiresAt: Date }): InvitationStatus {
  if (row.acceptedAt) return "accepted";
  return row.expiresAt.getTime() <= Date.now() ? "expired" : "pending";
}

const invitationColumns = {
  id: restaurantInvitation.id,
  restaurantId: restaurantInvitation.restaurantId,
  email: restaurantInvitation.email,
  role: restaurantInvitation.role,
  expiresAt: restaurantInvitation.expiresAt,
  acceptedAt: restaurantInvitation.acceptedAt,
  restaurantName: restaurant.name,
} as const;

function invitationQuery(db: TenancyDb) {
  return db
    .select(invitationColumns)
    .from(restaurantInvitation)
    .innerJoin(restaurant, eq(restaurant.id, restaurantInvitation.restaurantId));
}

/**
 * Owner-only: create (or replace) a pending invitation and return the raw
 * token so the caller can email it. Refuses when the address already has an
 * account in this restaurant — that is a membership, not an invitation.
 */
export async function createInvitationForOwner(
  db: TenancyDb,
  inviterUserId: string,
  restaurantId: string,
  email: string,
  role: RestaurantRole
): Promise<CreatedInvitation> {
  const membership = await db
    .select({ role: restaurantMembership.role })
    .from(restaurantMembership)
    .where(
      and(
        eq(restaurantMembership.restaurantId, restaurantId),
        eq(restaurantMembership.userId, inviterUserId)
      )
    );
  const callerRole = membership[0]?.role;
  if (!callerRole) {
    throw new InvitationError("not_found", "That restaurant does not exist.");
  }
  if (callerRole !== "owner") {
    throw new InvitationError("forbidden", "Only the restaurant owner can invite teammates.");
  }

  const restaurants = await db
    .select({ name: restaurant.name })
    .from(restaurant)
    .where(eq(restaurant.id, restaurantId))
    .limit(1);
  const restaurantRow = restaurants[0];
  if (!restaurantRow) {
    throw new InvitationError("not_found", "That restaurant does not exist.");
  }
  const inviters = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, inviterUserId))
    .limit(1);

  const normalized = normalizeInvitationEmail(email);
  const existingAccounts = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${normalized}`)
    .limit(1);
  const existing = existingAccounts[0];
  if (existing) {
    const existingMembership = await db
      .select({ id: restaurantMembership.id })
      .from(restaurantMembership)
      .where(
        and(
          eq(restaurantMembership.restaurantId, restaurantId),
          eq(restaurantMembership.userId, existing.id)
        )
      )
      .limit(1);
    if (existingMembership.length > 0) {
      throw new InvitationError(
        "already_member",
        "That account already belongs to this restaurant."
      );
    }
  }

  // One pending invitation per address: re-inviting invalidates older links.
  await db
    .delete(restaurantInvitation)
    .where(
      and(
        eq(restaurantInvitation.restaurantId, restaurantId),
        eq(restaurantInvitation.email, normalized),
        isNull(restaurantInvitation.acceptedAt)
      )
    );

  const token = newInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  await db.insert(restaurantInvitation).values({
    restaurantId,
    email: normalized,
    role,
    tokenHash: hashToken(token),
    invitedBy: inviterUserId,
    expiresAt,
  });

  return {
    invitation: { email: normalized, role, expiresAt },
    token,
    restaurantName: restaurantRow.name,
    inviterName: inviters[0]?.name ?? "A teammate",
  };
}

/** Look an invitation up by its raw token (null for unknown tokens). */
export async function getInvitationByToken(
  db: TenancyDb,
  token: string
): Promise<InvitationDetails | null> {
  if (!token) return null;
  const rows = await invitationQuery(db).where(eq(restaurantInvitation.tokenHash, hashToken(token)));
  const row = rows[0];
  if (!row) return null;
  return {
    restaurantId: row.restaurantId,
    restaurantName: row.restaurantName,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt,
    status: statusOf(row),
  };
}

/**
 * Accept an invitation for the signed-in account. The email must match the
 * invite (case-insensitive); the token alone grants nothing. Already being
 * a member is a success — the existing role is kept.
 */
export async function acceptInvitation(
  db: TenancyDb,
  input: { token: string; userId: string; email: string }
): Promise<{ restaurantId: string; restaurantName: string; role: RestaurantRole }> {
  const rows = await invitationQuery(db).where(
    eq(restaurantInvitation.tokenHash, hashToken(input.token))
  );
  const row = rows[0];
  if (!row) throw new InvitationError("not_found", "That invitation does not exist.");
  if (row.acceptedAt) {
    throw new InvitationError("used", "This invitation has already been accepted.");
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new InvitationError("expired", "This invitation has expired — ask for a new one.");
  }
  if (normalizeInvitationEmail(input.email) !== row.email) {
    throw new InvitationError(
      "wrong_account",
      "This invitation is for a different email address. Sign in with that address to accept."
    );
  }

  const existing = await db
    .select({ role: restaurantMembership.role })
    .from(restaurantMembership)
    .where(
      and(
        eq(restaurantMembership.restaurantId, row.restaurantId),
        eq(restaurantMembership.userId, input.userId)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    await db
      .insert(restaurantMembership)
      .values({ restaurantId: row.restaurantId, userId: input.userId, role: row.role })
      .onConflictDoNothing();
  }

  await db
    .update(restaurantInvitation)
    .set({ acceptedAt: new Date() })
    .where(and(eq(restaurantInvitation.id, row.id), isNull(restaurantInvitation.acceptedAt)));

  return {
    restaurantId: row.restaurantId,
    restaurantName: row.restaurantName,
    role: existing[0]?.role ?? row.role,
  };
}
