import { beforeAll, describe, expect, it } from "vitest";

import { describeAuditEvent } from "@/features/tenancy/audit-format";
import { listAuditEventsForUser } from "@/features/tenancy/audit";
import {
  acceptInvitation,
  createInvitationForOwner,
  listPendingInvitationsForOwner,
  resendInvitationForOwner,
  revokeInvitationForOwner,
} from "@/features/tenancy/invitations";
import {
  addMemberForOwner,
  createRestaurant,
  removeMemberForOwner,
  updateMemberRoleForOwner,
} from "@/features/tenancy/repo";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * The team audit trail: every membership and invitation change leaves a row
 * with snapshotted actor/target names, readable by any member of that
 * restaurant and invisible to everyone else.
 */
describe("team audit trail", () => {
  let db: TestDb;
  let owner: string;
  let staff: string;
  let outsider: string;

  beforeAll(async () => {
    ({ db } = await createTestDb());
    owner = await seedUser(db, "owner@audit.test", "Owner");
    staff = await seedUser(db, "staff@audit.test", "Staff");
    outsider = await seedUser(db, "outsider@audit.test", "Outsider");
  }, 30_000);

  it("records invitations, resends, revocations and acceptance", async () => {
    const place = await createRestaurant(db, owner, "Audit Cafe");
    await createInvitationForOwner(db, owner, place.id, "invitee@audit.test", "staff");
    const [pending] = await listPendingInvitationsForOwner(db, owner, place.id);
    await resendInvitationForOwner(db, owner, place.id, pending!.id);
    const [reissued] = await listPendingInvitationsForOwner(db, owner, place.id);
    await revokeInvitationForOwner(db, owner, place.id, reissued!.id);

    const invitee = await seedUser(db, "invitee@audit.test", "Invitee");
    const second = await createInvitationForOwner(db, owner, place.id, "invitee@audit.test", "owner");
    await acceptInvitation(db, {
      token: second.token,
      userId: invitee,
      email: "invitee@audit.test",
    });

    const events = await listAuditEventsForUser(db, owner, place.id);
    expect(events).not.toBeNull();
    expect(events!.map((event) => event.action)).toEqual([
      "invitation_accepted",
      "invitation_sent",
      "invitation_revoked",
      "invitation_resent",
      "invitation_sent",
    ]);

    expect(events![0]).toMatchObject({
      actorName: "Invitee",
      targetEmail: "invitee@audit.test",
      detail: "owner",
    });
    expect(events![1]).toMatchObject({
      actorName: "Owner",
      targetEmail: "invitee@audit.test",
      detail: "owner",
    });
    expect(events![3]).toMatchObject({ action: "invitation_resent", detail: "staff" });
    expect(events![4]?.createdAt).toBeInstanceOf(Date);
  });

  it("records member adds, role changes and removals", async () => {
    const place = await createRestaurant(db, owner, "Members Cafe");
    await addMemberForOwner(db, owner, place.id, "staff@audit.test", "staff");
    await updateMemberRoleForOwner(db, owner, place.id, staff, "owner");
    await updateMemberRoleForOwner(db, owner, place.id, staff, "staff");
    await removeMemberForOwner(db, owner, place.id, staff);

    const events = await listAuditEventsForUser(db, owner, place.id);
    expect(events!.map((event) => event.action)).toEqual([
      "member_removed",
      "member_role_changed",
      "member_role_changed",
      "member_added",
    ]);

    // Newest first, and each line keeps the target's name after removal.
    expect(events![0]).toMatchObject({
      actorName: "Owner",
      targetEmail: "staff@audit.test",
      targetName: "Staff",
    });
    expect(events![1]).toMatchObject({ detail: "owner → staff" });
    expect(events![2]).toMatchObject({ detail: "staff → owner" });
    expect(events![3]).toMatchObject({ action: "member_added", detail: "staff" });

    const again = await addMemberForOwner(db, owner, place.id, "staff@audit.test", "staff");
    expect(again.role).toBe("staff");
  });

  it("identifies an actor with no display name by their address", async () => {
    const place = await createRestaurant(db, owner, "Nameless Cafe");
    await createInvitationForOwner(db, owner, place.id, "nameless@audit.test", "staff");
    const [pending] = await listPendingInvitationsForOwner(db, owner, place.id);
    const created = await resendInvitationForOwner(db, owner, place.id, pending!.id);
    const nameless = await seedUser(db, "nameless@audit.test", "");
    await acceptInvitation(db, {
      token: created.token,
      userId: nameless,
      email: "nameless@audit.test",
    });

    const [accepted] = (await listAuditEventsForUser(db, owner, place.id))!;
    expect(accepted).toMatchObject({
      action: "invitation_accepted",
      actorName: "nameless@audit.test",
      targetEmail: "nameless@audit.test",
    });
  });

  it("shows events to any member of that restaurant only", async () => {
    const place = await createRestaurant(db, owner, "Scoped Cafe");
    const other = await createRestaurant(db, owner, "Other Cafe");
    await addMemberForOwner(db, owner, place.id, "staff@audit.test", "staff");
    await createInvitationForOwner(db, owner, other.id, "elsewhere@audit.test", "staff");

    const memberView = await listAuditEventsForUser(db, staff, place.id);
    expect(memberView!.map((event) => event.action)).toEqual(["member_added"]);

    // Staff of one restaurant cannot read another tenant's trail.
    expect(await listAuditEventsForUser(db, staff, other.id)).toBeNull();
    expect(await listAuditEventsForUser(db, outsider, place.id)).toBeNull();

    // Lists are capped (newest first) for a long-lived restaurant.
    for (let index = 0; index < 3; index += 1) {
      await createInvitationForOwner(db, owner, place.id, `bulk${index}@audit.test`, "staff");
    }
    const capped = await listAuditEventsForUser(db, owner, place.id, 2);
    expect(capped!.map((event) => event.action)).toEqual(["invitation_sent", "invitation_sent"]);
    expect(capped![0]?.targetEmail).toBe("bulk2@audit.test");
  });
});

describe("describeAuditEvent", () => {
  const base = { actorName: "Ada", targetEmail: "bo@cafe.test", targetName: null, detail: null };

  it("reads as a sentence for every action", () => {
    expect(describeAuditEvent({ ...base, action: "invitation_sent", detail: "staff" })).toBe(
      "Ada invited bo@cafe.test as staff."
    );
    expect(describeAuditEvent({ ...base, action: "invitation_resent" })).toBe(
      "Ada sent bo@cafe.test a new invitation link."
    );
    expect(describeAuditEvent({ ...base, action: "invitation_revoked" })).toBe(
      "Ada revoked the invitation for bo@cafe.test."
    );
    expect(
      describeAuditEvent({ ...base, action: "invitation_accepted", targetName: "Bo", detail: "owner" })
    ).toBe("Bo accepted the invitation and joined as an owner.");
    expect(describeAuditEvent({ ...base, action: "member_added", detail: "owner" })).toBe(
      "Ada added bo@cafe.test as an owner."
    );
    expect(
      describeAuditEvent({
        ...base,
        action: "member_role_changed",
        targetName: "Bo",
        detail: "staff → owner",
      })
    ).toBe("Ada changed Bo's role from staff to an owner.");
    expect(describeAuditEvent({ ...base, action: "member_removed" })).toBe(
      "Ada removed bo@cafe.test."
    );
  });

  it("tolerates missing names without printing blanks", () => {
    expect(
      describeAuditEvent({
        action: "member_removed",
        actorName: "  ",
        targetEmail: null,
        targetName: "  ",
        detail: null,
      })
    ).toBe("Someone removed a teammate.");
    expect(
      describeAuditEvent({ ...base, action: "member_role_changed", detail: null })
    ).toBe("Ada changed bo@cafe.test's role from one role to another.");
  });
});
