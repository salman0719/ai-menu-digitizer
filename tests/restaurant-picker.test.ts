import { describe, expect, it } from "vitest";

import { selectedRestaurant, showRestaurantPicker } from "../src/features/tenancy/picker";

const one = [{ id: "r1", name: "One" }];
const two = [
  { id: "r1", name: "One" },
  { id: "r2", name: "Two" },
];

describe("restaurant picker", () => {
  it("hides the control unless there is a real choice", () => {
    expect(showRestaurantPicker(null)).toBe(false);
    expect(showRestaurantPicker([])).toBe(false);
    expect(showRestaurantPicker(one)).toBe(false);
    expect(showRestaurantPicker(two)).toBe(true);
  });

  it("keeps an explicit choice", () => {
    expect(selectedRestaurant(two, "r2")).toEqual({ id: "r2", name: "Two" });
  });

  it("auto-selects the only restaurant, even before the id is recorded", () => {
    expect(selectedRestaurant(one, "")).toEqual({ id: "r1", name: "One" });
  });

  it("shows the remaining restaurant after deleting down to one", () => {
    expect(selectedRestaurant([{ id: "r2", name: "Two" }], "r1")).toEqual({
      id: "r2",
      name: "Two",
    });
  });

  it("leaves multiple restaurants unselected until one is picked", () => {
    expect(selectedRestaurant(two, "")).toBeNull();
    expect(selectedRestaurant(two, "gone")).toBeNull();
  });

  it("has nothing to select when the list is empty", () => {
    expect(selectedRestaurant([], "r1")).toBeNull();
    expect(selectedRestaurant(null, "r1")).toBeNull();
  });
});
