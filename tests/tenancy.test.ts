import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  addMemberForOwner,
  createRestaurant,
  deleteRestaurantForOwner,
  getRestaurantForUser,
  listMembersForUser,
  listRestaurantsForUser,
  removeMemberForOwner,
  renameRestaurantForOwner,
  updateMemberRoleForOwner,
} from "@/features/tenancy/repo";
import { restaurantMembership } from "@/lib/db/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * First tenancy isolation tests (Step 7): two signed-in owners must never
 * see each other's restaurants, and only owners may mutate. Scope rules:
 * PHASE-2.md §3.1 — ids always come from the verified session, never from
 * the client.
 */
describe("tenancy isolation", () => {
  let db: TestDb;
  let ownerA: string;
  let ownerB: string;

  beforeAll(async () => {
    ({ db } = await createTestDb());
    ownerA = await seedUser(db, "owner-a@cafe.test", "Owner A");
    ownerB = await seedUser(db, "owner-b@cafe.test", "Owner B");
  }, 30_000);

  it("creates a restaurant with the caller as owner member", async () => {
    const created = await createRestaurant(db, ownerA, "Café A");
    expect(created.role).toBe("owner");
    expect(created.name).toBe("Café A");

    const fetched = await getRestaurantForUser(db, ownerA, created.id);
    expect(fetched).toMatchObject({ id: created.id, name: "Café A", role: "owner" });
  });

  it("lists only restaurants the user belongs to", async () => {
    await createRestaurant(db, ownerB, "Café B");

    const listA = await listRestaurantsForUser(db, ownerA);
    const listB = await listRestaurantsForUser(db, ownerB);

    expect(listA.map((r) => r.name)).toEqual(["Café A"]);
    expect(listB.map((r) => r.name)).toEqual(["Café B"]);
    // No overlap: B's names never appear in A's session scope.
    const idsB = new Set(listB.map((r) => r.id));
    expect(listA.some((r) => idsB.has(r.id))).toBe(false);
  });

  it("does not hand one tenant's restaurant to another (get + mutate)", async () => {
    const [restaurantB] = await listRestaurantsForUser(db, ownerB);
    expect(restaurantB).toBeDefined();

    // Ownership check by id alone must fail across tenants.
    expect(await getRestaurantForUser(db, ownerA, restaurantB.id)).toBeNull();
    expect(await renameRestaurantForOwner(db, ownerA, restaurantB.id, "Hijacked")).toBeNull();
    expect(await deleteRestaurantForOwner(db, ownerA, restaurantB.id)).toBe(false);

    // And B's data is untouched.
    const stillB = await getRestaurantForUser(db, ownerB, restaurantB.id);
    expect(stillB).toMatchObject({ id: restaurantB.id, name: "Café B", role: "owner" });
  });

  it("lets staff read but never write; owners can rename and delete", async () => {
    const staff = await seedUser(db, "staff@cafe.test", "Staff");
    const [restaurantA] = await listRestaurantsForUser(db, ownerA);
    await db.insert(restaurantMembership).values({
      restaurantId: restaurantA.id,
      userId: staff,
      role: "staff",
    });

    // Staff scope: sees A's restaurant with staff role, nothing else.
    const staffList = await listRestaurantsForUser(db, staff);
    expect(staffList).toHaveLength(1);
    expect(staffList[0]).toMatchObject({ id: restaurantA.id, role: "staff" });

    // Staff writes are denied, owner writes succeed.
    expect(
      await renameRestaurantForOwner(db, staff, restaurantA.id, "Renamed by staff")
    ).toBeNull();
    expect(await deleteRestaurantForOwner(db, staff, restaurantA.id)).toBe(false);
    const renamed = await renameRestaurantForOwner(db, ownerA, restaurantA.id, "Café A2");
    expect(renamed).toMatchObject({ name: "Café A2", role: "owner" });

    // Owner delete cascades memberships (no orphaned grants).
    expect(await deleteRestaurantForOwner(db, ownerA, restaurantA.id)).toBe(true);
    expect(await getRestaurantForUser(db, ownerA, restaurantA.id)).toBeNull();
    const orphanMemberships = await db
      .select()
      .from(restaurantMembership)
      .where(eq(restaurantMembership.restaurantId, restaurantA.id));
    expect(orphanMemberships).toHaveLength(0);
  });
});

/**
 * Member management (owner-only writes, PHASE-2.md §3.1): adding existing
 * accounts by email, changing roles, removing members — and the invariant
 * that a restaurant never loses its last owner.
 */
describe("member management", () => {
  let db: TestDb;
  let owner: string;
  let staff: string;
  let outsider: string;

  beforeAll(async () => {
    ({ db } = await createTestDb());
    owner = await seedUser(db, "owner@cafe.test", "Owner");
    staff = await seedUser(db, "staff@cafe.test", "Staff Person");
    outsider = await seedUser(db, "outsider@cafe.test", "Outsider");
  }, 30_000);

  /** A fresh restaurant per test keeps the mutations independent. */
  async function freshRestaurant(name: string) {
    return createRestaurant(db, owner, name);
  }

  it("lists members with account info for any member, and not for outsiders", async () => {
    const place = await freshRestaurant("Team Place");
    await addMemberForOwner(db, owner, place.id, "staff@cafe.test", "staff");

    // Staff can see their team.
    const members = await listMembersForUser(db, staff, place.id);
    expect(members.map((m) => m.email).sort()).toEqual(["owner@cafe.test", "staff@cafe.test"]);
    expect(members.find((m) => m.userId === staff)).toMatchObject({
      name: "Staff Person",
      role: "staff",
    });

    // Outsiders see nothing — the id does not resolve for them.
    await expect(listMembersForUser(db, outsider, place.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("adds an existing account by email, refusing unknown emails and duplicates", async () => {
    const place = await freshRestaurant("Add Place");
    const added = await addMemberForOwner(db, owner, place.id, "  STAFF@CAFE.TEST ", "staff");
    expect(added).toMatchObject({ userId: staff, email: "staff@cafe.test", role: "staff" });

    await expect(
      addMemberForOwner(db, owner, place.id, "nobody@cafe.test", "staff")
    ).rejects.toMatchObject({ code: "user_not_found" });
    await expect(
      addMemberForOwner(db, owner, place.id, "staff@cafe.test", "owner")
    ).rejects.toMatchObject({ code: "already_member" });
  });

  it("lets only owners manage members (staff forbidden, outsiders unprobeable)", async () => {
    const place = await freshRestaurant("Guarded Place");
    await addMemberForOwner(db, owner, place.id, "staff@cafe.test", "staff");

    await expect(
      addMemberForOwner(db, staff, place.id, "outsider@cafe.test", "staff")
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      updateMemberRoleForOwner(db, staff, place.id, owner, "staff")
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(removeMemberForOwner(db, staff, place.id, owner)).rejects.toMatchObject({
      code: "forbidden",
    });

    await expect(
      updateMemberRoleForOwner(db, outsider, place.id, owner, "staff")
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("changes roles but never demotes the last owner", async () => {
    const place = await freshRestaurant("Roles Place");
    await addMemberForOwner(db, owner, place.id, "staff@cafe.test", "staff");

    // Promote, then demote while the other owner remains.
    expect(await updateMemberRoleForOwner(db, owner, place.id, staff, "owner")).toMatchObject({
      role: "owner",
    });
    expect(await updateMemberRoleForOwner(db, owner, place.id, staff, "staff")).toMatchObject({
      role: "staff",
    });

    // Sole owner cannot demote themselves.
    await expect(
      updateMemberRoleForOwner(db, owner, place.id, owner, "staff")
    ).rejects.toMatchObject({ code: "last_owner" });

    // With a second owner, the demotion goes through.
    await updateMemberRoleForOwner(db, owner, place.id, staff, "owner");
    expect(await updateMemberRoleForOwner(db, owner, place.id, owner, "staff")).toMatchObject({
      userId: owner,
      role: "staff",
    });
  });

  it("removes members but never the last owner", async () => {
    const place = await freshRestaurant("Remove Place");
    await addMemberForOwner(db, owner, place.id, "staff@cafe.test", "staff");

    await removeMemberForOwner(db, owner, place.id, staff);
    const remaining = await listMembersForUser(db, owner, place.id);
    expect(remaining.map((m) => m.userId)).toEqual([owner]);

    // The sole owner cannot remove themselves.
    await expect(removeMemberForOwner(db, owner, place.id, owner)).rejects.toMatchObject({
      code: "last_owner",
    });

    // With a second owner, either owner may leave.
    await addMemberForOwner(db, owner, place.id, "staff@cafe.test", "owner");
    await removeMemberForOwner(db, owner, place.id, owner);
    const afterLeave = await listMembersForUser(db, staff, place.id);
    expect(afterLeave.map((m) => m.userId)).toEqual([staff]);
  });
});
