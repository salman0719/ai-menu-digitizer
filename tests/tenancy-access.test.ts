import { describe, expect, it } from "vitest";

import { staffMenuIds } from "@/features/tenancy/access";

describe("staffMenuIds", () => {
  it("returns the menus the caller can only view as staff", () => {
    const ids = staffMenuIds(
      [
        { id: "m1", restaurantId: "r-staff" },
        { id: "m2", restaurantId: "r-owner" },
      ],
      [
        { id: "r-staff", role: "staff" },
        { id: "r-owner", role: "owner" },
      ]
    );
    expect([...ids]).toEqual(["m1"]);
  });

  it("excludes menus whose restaurant role is unknown", () => {
    const ids = staffMenuIds(
      [
        { id: "m1", restaurantId: "r-missing" },
        { id: "m2", restaurantId: "r-owner" },
      ],
      [{ id: "r-owner", role: "owner" }]
    );
    expect(ids.size).toBe(0);
  });

  it("returns an empty set for empty inputs", () => {
    expect(staffMenuIds([], []).size).toBe(0);
    expect(staffMenuIds([{ id: "m1", restaurantId: "r1" }], []).size).toBe(0);
  });
});
