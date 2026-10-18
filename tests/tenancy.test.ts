import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createRestaurant,
  deleteRestaurantForOwner,
  getRestaurantForUser,
  listRestaurantsForUser,
  renameRestaurantForOwner,
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
