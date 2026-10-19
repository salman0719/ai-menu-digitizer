import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  acceptInvitation,
  createInvitationForOwner,
  getInvitationByToken,
  listPendingInvitationsForOwner,
  resendInvitationForOwner,
  revokeInvitationForOwner,
} from "@/features/tenancy/invitations";
import { addMemberForOwner, createRestaurant } from "@/features/tenancy/repo";
import { restaurantInvitation } from "@/lib/db/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * Email invitations for teammates without accounts. The token is the only
 * thing in the email; acceptance additionally requires a signed-in account
 * whose email matches, so a leaked link cannot join as someone else.
 */
describe("restaurant invitations", () => {
  let db: TestDb;
  let owner: string;
  let staff: string;
  let outsider: string;

  beforeAll(async () => {
    ({ db } = await createTestDb());
    owner = await seedUser(db, "owner@cafe.test", "Owner");
    staff = await seedUser(db, "staff@cafe.test", "Staff");
    outsider = await seedUser(db, "outsider@cafe.test", "Outsider");
  }, 30_000);

  async function freshRestaurant(name: string) {
    return createRestaurant(db, owner, name);
  }

  it("stores only a hash, normalizes the email and resolves the token", async () => {
    const place = await freshRestaurant("Invite Place");
    const created = await createInvitationForOwner(
      db,
      owner,
      place.id,
      "  New.Person@Cafe.Test ",
      "staff"
    );

    expect(created.token.length).toBeGreaterThan(30);
    expect(created.invitation).toMatchObject({ email: "new.person@cafe.test", role: "staff" });
    expect(created.restaurantName).toBe("Invite Place");
    expect(created.inviterName).toBe("Owner");

    const rows = await db
      .select({ tokenHash: restaurantInvitation.tokenHash })
      .from(restaurantInvitation)
      .where(eq(restaurantInvitation.restaurantId, place.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toHaveLength(64);
    expect(rows[0]?.tokenHash).not.toContain(created.token);

    const details = await getInvitationByToken(db, created.token);
    expect(details).toMatchObject({
      restaurantId: place.id,
      restaurantName: "Invite Place",
      email: "new.person@cafe.test",
      role: "staff",
      status: "pending",
    });
    expect(await getInvitationByToken(db, "not-a-token")).toBeNull();
  });

  it("lets only owners invite, refuses members, and invalidates older links", async () => {
    const place = await freshRestaurant("Owner Only Place");
    await addMemberForOwner(db, owner, place.id, "staff@cafe.test", "staff");

    await expect(
      createInvitationForOwner(db, staff, place.id, "friend@cafe.test", "staff")
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      createInvitationForOwner(db, outsider, place.id, "friend@cafe.test", "staff")
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      createInvitationForOwner(db, owner, place.id, "staff@cafe.test", "staff")
    ).rejects.toMatchObject({ code: "already_member" });

    const first = await createInvitationForOwner(db, owner, place.id, "friend@cafe.test", "staff");
    const second = await createInvitationForOwner(db, owner, place.id, "friend@cafe.test", "owner");
    expect(await getInvitationByToken(db, first.token)).toBeNull();
    expect(await getInvitationByToken(db, second.token)).toMatchObject({
      role: "owner",
      status: "pending",
    });
  });

  it("accepts only for the matching signed-in email, once", async () => {
    const place = await freshRestaurant("Accept Place");
    const created = await createInvitationForOwner(
      db,
      owner,
      place.id,
      "invitee@cafe.test",
      "staff"
    );
    const invitee = await seedUser(db, "invitee@cafe.test", "Invitee");

    await expect(
      acceptInvitation(db, { token: created.token, userId: outsider, email: "outsider@cafe.test" })
    ).rejects.toMatchObject({ code: "wrong_account" });

    const accepted = await acceptInvitation(db, {
      token: created.token,
      userId: invitee,
      email: "INVITEE@cafe.test",
    });
    expect(accepted).toMatchObject({ restaurantId: place.id, role: "staff" });

    expect(await getInvitationByToken(db, created.token)).toMatchObject({ status: "accepted" });
    await expect(
      acceptInvitation(db, { token: created.token, userId: invitee, email: "invitee@cafe.test" })
    ).rejects.toMatchObject({ code: "used" });
  });

  it("refuses expired invitations", async () => {
    const place = await freshRestaurant("Expiry Place");
    const created = await createInvitationForOwner(
      db,
      owner,
      place.id,
      "late@cafe.test",
      "staff"
    );
    const late = await seedUser(db, "late@cafe.test", "Late");

    await db
      .update(restaurantInvitation)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(restaurantInvitation.restaurantId, place.id));

    expect(await getInvitationByToken(db, created.token)).toMatchObject({ status: "expired" });
    await expect(
      acceptInvitation(db, { token: created.token, userId: late, email: "late@cafe.test" })
    ).rejects.toMatchObject({ code: "expired" });
  });

  it("keeps the existing role when the invitee already joined", async () => {
    const place = await freshRestaurant("Double Place");
    const created = await createInvitationForOwner(
      db,
      owner,
      place.id,
      "early@cafe.test",
      "staff"
    );
    const early = await seedUser(db, "early@cafe.test", "Early");
    await addMemberForOwner(db, owner, place.id, "early@cafe.test", "owner");

    const accepted = await acceptInvitation(db, {
      token: created.token,
      userId: early,
      email: "early@cafe.test",
    });
    expect(accepted.role).toBe("owner");
  });

  it("lists only still-open invitations, for owners", async () => {
    const place = await freshRestaurant("Pending Place");
    await addMemberForOwner(db, owner, place.id, "staff@cafe.test", "staff");
    const open = await createInvitationForOwner(db, owner, place.id, "open@cafe.test", "staff");
    const expired = await createInvitationForOwner(
      db,
      owner,
      place.id,
      "expired-invite@cafe.test",
      "staff"
    );
    await db
      .update(restaurantInvitation)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(restaurantInvitation.email, "expired-invite@cafe.test"));
    expect(expired.token).toBeTruthy();

    const list = await listPendingInvitationsForOwner(db, owner, place.id);
    expect(list.map((row) => row.email)).toEqual(["open@cafe.test"]);
    expect(list[0]).toMatchObject({ role: "staff", invitedByName: "Owner" });
    expect(await getInvitationByToken(db, open.token)).toMatchObject({ status: "pending" });

    await expect(listPendingInvitationsForOwner(db, staff, place.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      listPendingInvitationsForOwner(db, outsider, place.id)
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("resends by rotating the link and keeping email and role", async () => {
    const place = await freshRestaurant("Resend Place");
    await addMemberForOwner(db, owner, place.id, "staff@cafe.test", "staff");
    const first = await createInvitationForOwner(db, owner, place.id, "again@cafe.test", "owner");
    const pending = await listPendingInvitationsForOwner(db, owner, place.id);
    expect(pending).toHaveLength(1);

    const resent = await resendInvitationForOwner(db, owner, place.id, pending[0]!.id);
    expect(resent.token).not.toBe(first.token);
    expect(resent.invitation).toMatchObject({ email: "again@cafe.test", role: "owner" });
    expect(await getInvitationByToken(db, first.token)).toBeNull();
    expect(await getInvitationByToken(db, resent.token)).toMatchObject({ status: "pending" });

    await expect(
      resendInvitationForOwner(db, staff, place.id, pending[0]!.id)
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      resendInvitationForOwner(db, owner, place.id, "no-such-id")
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("revokes a pending invitation so its link stops working", async () => {
    const place = await freshRestaurant("Revoke Place");
    await addMemberForOwner(db, owner, place.id, "staff@cafe.test", "staff");
    const created = await createInvitationForOwner(db, owner, place.id, "revoked@cafe.test", "staff");
    const [pending] = await listPendingInvitationsForOwner(db, owner, place.id);

    await revokeInvitationForOwner(db, owner, place.id, pending!.id);
    expect(await getInvitationByToken(db, created.token)).toBeNull();
    expect(await listPendingInvitationsForOwner(db, owner, place.id)).toHaveLength(0);

    await expect(
      revokeInvitationForOwner(db, owner, place.id, pending!.id)
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      revokeInvitationForOwner(db, staff, place.id, "anything")
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
