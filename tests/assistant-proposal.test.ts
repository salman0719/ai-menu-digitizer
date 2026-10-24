import { describe, expect, it } from "vitest";

import {
  ProposalApplyError,
  applyProposalOperations,
  collapseOperations,
} from "@/features/assistant/apply";
import {
  ASSISTANT_MAX_OPERATIONS,
  addItemOperationSchema,
  applyProposalRequestSchema,
  assistantOperationSchema,
  assistantProposalArgumentsSchema,
  setProposalOperationPrice,
  type AssistantProposal,
} from "@/features/assistant/proposal";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import type { MenuDocument, MenuItem } from "@/features/menu/schema";

function menu(): MenuDocument {
  return createSampleMenuDocument();
}

function itemByName(doc: MenuDocument, name: string): { categoryId: string; item: MenuItem } {
  for (const category of doc.categories) {
    const item = category.items.find((candidate) => candidate.name === name);
    if (item) return { categoryId: category.id, item };
  }
  throw new Error(`fixture item not found: ${name}`);
}

function categoryIdByName(doc: MenuDocument, name: string): string {
  const category = doc.categories.find((candidate) => candidate.name === name);
  if (!category) throw new Error(`fixture category not found: ${name}`);
  return category.id;
}

describe("operation schemas", () => {
  it("requires a category on add_item and rejects unknown keys", () => {
    const base = { op: "add_item", name: "Lemonade", price: 3.5 };
    expect(addItemOperationSchema.safeParse(base).success).toBe(false);
    expect(addItemOperationSchema.safeParse({ ...base, categoryId: "cat_drinks" }).success).toBe(
      true
    );
    expect(
      addItemOperationSchema.safeParse({
        ...base,
        categoryId: "cat_drinks",
        id: "client-supplied-id",
      }).success
    ).toBe(false);
    expect(assistantOperationSchema.safeParse({ op: "delete_item", itemId: "x" }).success).toBe(
      false
    );
  });

  it("allows a null price on the wire (so it can become a question, not a write)", () => {
    expect(
      addItemOperationSchema.safeParse({
        op: "add_item",
        categoryId: "cat_mains",
        name: "Mystery dish",
        price: null,
      }).success
    ).toBe(true);
  });

  it("caps a proposal at twelve operations", () => {
    const operations = Array.from({ length: ASSISTANT_MAX_OPERATIONS }, (_, index) => ({
      op: "add_category" as const,
      name: `Category ${index}`,
    }));
    expect(
      assistantProposalArgumentsSchema.safeParse({
        outcome: "propose",
        message: "Add them.",
        operations,
      }).success
    ).toBe(true);
    expect(
      assistantProposalArgumentsSchema.safeParse({
        outcome: "propose",
        message: "Too many.",
        operations: [...operations, { op: "add_category", name: "One more" }],
      }).success
    ).toBe(false);
  });

  it("rejects an approval body that carries anything but the previewed operations", () => {
    const request = {
      menuId: "menu-1",
      expectedUpdatedAt: "2026-10-24T10:00:00.000Z",
      operations: [{ op: "add_category", name: "Desserts" }],
    };
    expect(applyProposalRequestSchema.safeParse(request).success).toBe(true);
    expect(
      applyProposalRequestSchema.safeParse({ ...request, doc: { title: "Hijacked" } }).success
    ).toBe(false);
    expect(applyProposalRequestSchema.safeParse({ ...request, operations: [] }).success).toBe(
      false
    );
  });
});

describe("collapseOperations", () => {
  it("merges repeated updates for one item, later fields winning", () => {
    const { item } = itemByName(menu(), "Oat Milk Latte");
    const collapsed = collapseOperations([
      { op: "update_item", itemId: item.id, price: 13 },
      { op: "update_item", itemId: item.id, description: "Now with pickles." },
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatchObject({
      op: "update_item",
      itemId: item.id,
      price: 13,
      description: "Now with pickles.",
    });
  });

  it("drops exact duplicates and repeated add_category names", () => {
    const collapsed = collapseOperations([
      { op: "add_category", name: "Specials" },
      { op: "add_category", name: "specials" },
      { op: "set_item_availability", itemId: "itm-1", available: false },
      { op: "set_item_availability", itemId: "itm-1", available: false },
    ]);
    expect(collapsed).toEqual([
      { op: "add_category", name: "Specials" },
      { op: "set_item_availability", itemId: "itm-1", available: false },
    ]);
  });
});

describe("applyProposalOperations", () => {
  it("adds a category and an item addressed by that new category's name", () => {
    const before = menu();
    const applied = applyProposalOperations(before, [
      { op: "add_category", name: "Desserts" },
      {
        op: "add_item",
        categoryId: "Desserts",
        name: "Tiramisu",
        price: 9.5,
        description: null,
        dietaryLabels: ["vegetarian"],
      },
    ]);

    const desserts = applied.doc.categories.find((category) => category.name === "Desserts");
    expect(desserts).toBeDefined();
    expect(desserts!.items).toHaveLength(1);
    expect(desserts!.items[0]).toMatchObject({
      name: "Tiramisu",
      price: 9.5,
      currency: "USD",
      description: null,
      dietaryLabels: ["vegetarian"],
    });
    // The app generates the id; the model never supplies one.
    expect(desserts!.items[0].id).not.toBe("Tiramisu");

    expect(applied.preview.before).toMatchObject({ categories: 2, items: 4 });
    expect(applied.preview.after).toMatchObject({ categories: 3, items: 5 });
    expect(applied.preview.operations.map((operation) => operation.op)).toEqual([
      "add_category",
      "add_item",
    ]);
    expect(applied.preview.operations[1].changes).toContainEqual({
      label: "Price",
      before: null,
      after: "9.5 USD",
    });
    // The input document is untouched.
    expect(before.categories).toHaveLength(2);
  });

  it("updates fields, availability, names and categories", () => {
    const before = menu();
    const latte = itemByName(before, "Oat Milk Latte").item;
    const coffee = categoryIdByName(before, "Espresso & Coffee");
    const breakfast = categoryIdByName(before, "Breakfast");
    const espresso = itemByName(before, "Espresso").item;

    const applied = applyProposalOperations(before, [
      {
        op: "update_item",
        itemId: latte.id,
        price: 5.5,
        description: "Espresso with steamed oat milk.",
        dietaryLabels: ["vegan", "dairy-free"],
      },
      { op: "set_item_availability", itemId: latte.id, available: false },
      { op: "rename_category", categoryId: coffee, name: "Coffee" },
      { op: "move_item", itemId: espresso.id, toCategoryId: breakfast },
    ]);

    const updatedLatte = itemByName(applied.doc, "Oat Milk Latte").item;
    expect(updatedLatte).toMatchObject({
      price: 5.5,
      description: "Espresso with steamed oat milk.",
      available: false,
      dietaryLabels: ["vegan", "dairy-free"],
    });
    expect(applied.doc.categories.map((category) => category.name)).toContain("Coffee");
    const coffeeCategory = applied.doc.categories.find((category) => category.id === coffee);
    expect(coffeeCategory?.items.some((item) => item.id === espresso.id)).toBe(false);
    expect(
      applied.doc.categories
        .find((category) => category.id === breakfast)
        ?.items.some((item) => item.id === espresso.id)
    ).toBe(true);

    const priceChange = applied.preview.operations[0].changes.find(
      (change) => change.label === "Price"
    );
    expect(priceChange).toEqual({ label: "Price", before: "4.5 USD", after: "5.5 USD" });
    expect(applied.preview.operations[2].summary).toContain("Coffee");
    expect(applied.preview.operations[3].summary).toContain("Breakfast");
  });

  it("counts merged updates once in the preview", () => {
    const before = menu();
    const latte = itemByName(before, "Oat Milk Latte").item;
    const applied = applyProposalOperations(before, [
      { op: "update_item", itemId: latte.id, price: 6 },
      { op: "update_item", itemId: latte.id, available: false },
    ]);
    expect(applied.operations).toHaveLength(1);
    expect(applied.preview.operations).toHaveLength(1);
    expect(applied.preview.operations[0].changes).toHaveLength(2);
  });

  it("refuses a missing price instead of writing null", () => {
    const before = menu();
    expect(() =>
      applyProposalOperations(before, [
        {
          op: "add_item",
          categoryId: categoryIdByName(before, "Breakfast"),
          name: "Mystery dish",
          price: null,
        },
      ])
    ).toThrow(ProposalApplyError);
    try {
      applyProposalOperations(before, [
        {
          op: "add_item",
          categoryId: categoryIdByName(before, "Breakfast"),
          name: "Mystery dish",
          price: null,
        },
      ]);
    } catch (error) {
      expect((error as ProposalApplyError).code).toBe("missing_price");
    }
  });

  it("rejects ids that are not on this menu", () => {
    const before = menu();
    const attempts = [
      { op: "update_item", itemId: "invented-item", price: 1 },
      { op: "move_item", itemId: "invented-item", toCategoryId: "invented-category" },
      {
        op: "add_item",
        categoryId: "invented-category",
        name: "Nope",
        price: 1,
      },
      { op: "rename_category", categoryId: "invented-category", name: "Nope" },
    ] as const;

    for (const operation of attempts) {
      expect(() => applyProposalOperations(before, [operation])).toThrow(ProposalApplyError);
    }
    try {
      applyProposalOperations(before, [attempts[0]]);
    } catch (error) {
      expect((error as ProposalApplyError).code).toBe("unknown_item");
    }
  });

  it("rejects duplicate categories, empty updates and meaningless moves", () => {
    const before = menu();
    const espresso = itemByName(before, "Espresso");
    const cases = [
      [{ op: "add_category", name: "Breakfast" }],
      [{ op: "update_item", itemId: espresso.item.id }],
      [
        {
          op: "move_item",
          itemId: espresso.item.id,
          toCategoryId: espresso.categoryId,
        },
      ],
    ] as const;

    const codes = cases.map((operations) => {
      try {
        applyProposalOperations(before, operations);
        return null;
      } catch (error) {
        return (error as ProposalApplyError).code;
      }
    });
    expect(codes).toEqual(["duplicate_category", "empty_update", "invalid_move"]);
  });

  it("refuses an empty list and more than twelve operations", () => {
    const before = menu();
    expect(() => applyProposalOperations(before, [])).toThrow(ProposalApplyError);
    const tooMany = Array.from({ length: ASSISTANT_MAX_OPERATIONS + 1 }, (_, index) => ({
      op: "add_category" as const,
      name: `Category ${index}`,
    }));
    expect(() => applyProposalOperations(before, tooMany)).toThrow(ProposalApplyError);
  });

  it("edits a proposed price and keeps the preview row in step", () => {
    const before = menu();
    const drinks = categoryIdByName(before, "Espresso & Coffee");
    const applied = applyProposalOperations(before, [
      { op: "add_item", categoryId: drinks, name: "Lemonade", price: 3.5 },
    ]);
    const proposal: AssistantProposal = {
      menuId: before.id,
      outcome: "propose",
      operations: applied.operations,
      preview: applied.preview,
      basedOnUpdatedAt: before.updatedAt,
      currency: before.currency,
    };

    const edited = setProposalOperationPrice(proposal, 0, 4.25);
    expect(edited.operations[0]).toMatchObject({ op: "add_item", price: 4.25 });
    expect(edited.preview.operations[0].changes).toContainEqual({
      label: "Price",
      before: null,
      after: "4.25 USD",
    });
    // A price edit never changes the operation list or the counts.
    expect(edited.preview.operations[0].summary).toBe(
      proposal.preview.operations[0].summary
    );
    expect(edited.preview.before).toEqual(proposal.preview.before);
    expect(edited.preview.after).toEqual(proposal.preview.after);
    expect(setProposalOperationPrice(proposal, 0, -1)).toBe(proposal);
  });

  it("keeps the menu title, currency and document valid", () => {
    const before = menu();
    const applied = applyProposalOperations(before, [{ op: "add_category", name: "Desserts" }]);
    expect(applied.doc.title).toBe(before.title);
    expect(applied.doc.currency).toBe(before.currency);
    expect(applied.doc.categories.every((category) => category.sortOrder >= 0)).toBe(true);
  });
});
