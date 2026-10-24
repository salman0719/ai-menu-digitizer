/**
 * Proposal schemas for assisted menu edits (A2).
 *
 * The model never writes anything. It returns one of four outcomes and, at
 * most, a small list of allowlisted operations. This module defines what the
 * server will accept from it and what the browser may send back for approval;
 * `apply.ts` is the only code that turns operations into a document.
 *
 * Everything here is strict on purpose:
 * - unknown operation keys are rejected, so a prompt-injected payload cannot
 *   smuggle `id`, `sortOrder` or `currency` into an edit,
 * - only the six operations in `ASSISTANT_OPERATION_NAMES` exist — no deletes,
 *   no publish/unpublish, no team or account changes,
 * - prices are always numbers the owner stated. A missing price is a
 *   clarifying question, never `null` written to the menu.
 */

import { z } from "zod";

/** The operation cap from the scope doc: a proposal, not a bulk import. */
export const ASSISTANT_MAX_OPERATIONS = 12;

export const ASSISTANT_MAX_ITEM_NAME = 120;
export const ASSISTANT_MAX_DESCRIPTION = 2_000;
export const ASSISTANT_MAX_CATEGORY_NAME = 120;
export const ASSISTANT_MAX_PRICE = 1_000_000;
export const ASSISTANT_MAX_DIETARY_LABELS = 12;
export const ASSISTANT_MAX_PROPOSAL_MESSAGE = 2_000;
export const ASSISTANT_MAX_QUESTION = 500;
export const ASSISTANT_MAX_PREVIEW_CHANGES = 8;

/** Outcomes the model may return. Anything else is a parse failure. */
export const assistantOutcomeSchema = z.enum(["answer", "propose", "clarify", "refuse"]);
export type AssistantOutcome = z.infer<typeof assistantOutcomeSchema>;

const dietaryLabelsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(ASSISTANT_MAX_DIETARY_LABELS);

const priceSchema = z.number().finite().nonnegative().max(ASSISTANT_MAX_PRICE);

/**
 * Add one item to an existing category. `categoryId` is required: the A0
 * spike found the model omits an optional category every time. A value that
 * names a category added earlier in the same proposal is resolved during
 * apply, because the app generates that id.
 */
export const addItemOperationSchema = z
  .object({
    op: z.literal("add_item"),
    categoryId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(ASSISTANT_MAX_ITEM_NAME),
    /**
     * Nullable in the wire schema so a model that ignores the rule produces a
     * clarifying question instead of a schema repair loop. Apply refuses it.
     */
    price: priceSchema.nullable(),
    description: z.string().trim().max(ASSISTANT_MAX_DESCRIPTION).nullable().optional(),
    available: z.boolean().optional(),
    dietaryLabels: dietaryLabelsSchema.optional(),
  })
  .strict();

export const updateItemOperationSchema = z
  .object({
    op: z.literal("update_item"),
    itemId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(ASSISTANT_MAX_ITEM_NAME).optional(),
    description: z.string().trim().max(ASSISTANT_MAX_DESCRIPTION).nullable().optional(),
    /** Omitted = leave the price alone; null is not a way to erase a price. */
    price: priceSchema.optional(),
    available: z.boolean().optional(),
    dietaryLabels: dietaryLabelsSchema.optional(),
  })
  .strict();

export const setItemAvailabilityOperationSchema = z
  .object({
    op: z.literal("set_item_availability"),
    itemId: z.string().trim().min(1).max(200),
    available: z.boolean(),
  })
  .strict();

export const addCategoryOperationSchema = z
  .object({
    op: z.literal("add_category"),
    name: z.string().trim().min(1).max(ASSISTANT_MAX_CATEGORY_NAME),
  })
  .strict();

export const renameCategoryOperationSchema = z
  .object({
    op: z.literal("rename_category"),
    categoryId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(ASSISTANT_MAX_CATEGORY_NAME),
  })
  .strict();

export const moveItemOperationSchema = z
  .object({
    op: z.literal("move_item"),
    itemId: z.string().trim().min(1).max(200),
    toCategoryId: z.string().trim().min(1).max(200),
  })
  .strict();

/** The complete v1 allowlist. Destructive and visibility-changing ops are absent. */
export const assistantOperationSchema = z.discriminatedUnion("op", [
  addItemOperationSchema,
  updateItemOperationSchema,
  setItemAvailabilityOperationSchema,
  addCategoryOperationSchema,
  renameCategoryOperationSchema,
  moveItemOperationSchema,
]);

export type AssistantOperation = z.infer<typeof assistantOperationSchema>;
export type AddItemOperation = z.infer<typeof addItemOperationSchema>;
export type UpdateItemOperation = z.infer<typeof updateItemOperationSchema>;
export type SetItemAvailabilityOperation = z.infer<typeof setItemAvailabilityOperationSchema>;
export type AddCategoryOperation = z.infer<typeof addCategoryOperationSchema>;
export type RenameCategoryOperation = z.infer<typeof renameCategoryOperationSchema>;
export type MoveItemOperation = z.infer<typeof moveItemOperationSchema>;

export const ASSISTANT_OPERATION_NAMES = [
  "add_item",
  "update_item",
  "set_item_availability",
  "add_category",
  "rename_category",
  "move_item",
] as const;

/** One field the approval screen will show as `before → after`. */
export const proposalChangeSchema = z.object({
  label: z.string().min(1),
  before: z.string().nullable(),
  after: z.string().nullable(),
});

export type ProposalChange = z.infer<typeof proposalChangeSchema>;

/** One operation as the approval screen describes it. */
export const proposalOperationPreviewSchema = z.object({
  op: z.enum(ASSISTANT_OPERATION_NAMES),
  summary: z.string().min(1),
  changes: z.array(proposalChangeSchema).max(ASSISTANT_MAX_PREVIEW_CHANGES),
});

export type ProposalOperationPreview = z.infer<typeof proposalOperationPreviewSchema>;

const proposalCountsSchema = z.object({
  title: z.string(),
  categories: z.number().int().nonnegative(),
  items: z.number().int().nonnegative(),
});

/** The server-computed diff. Owners approve this, never the model's prose. */
export const proposalPreviewSchema = z.object({
  before: proposalCountsSchema,
  after: proposalCountsSchema,
  operations: z.array(proposalOperationPreviewSchema).max(ASSISTANT_MAX_OPERATIONS),
  warnings: z.array(z.string().min(1)).max(6),
});

export type ProposalPreview = z.infer<typeof proposalPreviewSchema>;

/** What the chat route returns when it has a reviewable proposal. */
export const assistantProposalSchema = z.object({
  menuId: z.string().min(1),
  outcome: z.literal("propose"),
  operations: z.array(assistantOperationSchema).min(1).max(ASSISTANT_MAX_OPERATIONS),
  preview: proposalPreviewSchema,
  /** The menu revision the proposal was computed from (staleness guard). */
  basedOnUpdatedAt: z.string().min(1),
});

export type AssistantProposal = z.infer<typeof assistantProposalSchema>;

/** The model's structured answer, as validated before it can become a preview. */
export const assistantProposalArgumentsSchema = z
  .object({
    outcome: assistantOutcomeSchema,
    message: z.string().trim().min(1).max(ASSISTANT_MAX_PROPOSAL_MESSAGE),
    question: z.string().trim().max(ASSISTANT_MAX_QUESTION).nullable().optional(),
    operations: z.array(assistantOperationSchema).max(ASSISTANT_MAX_OPERATIONS),
  })
  .strict();

export type AssistantProposalArguments = z.infer<typeof assistantProposalArgumentsSchema>;

/**
 * Approval body: the operations that were previewed, for the exact revision
 * they were previewed against. Extra keys are rejected so a client cannot
 * slip a document or owner id into the request.
 */
export const applyProposalRequestSchema = z
  .object({
    menuId: z.string().trim().min(1).max(200),
    expectedUpdatedAt: z.string().trim().min(1).max(100),
    operations: z.array(assistantOperationSchema).min(1).max(ASSISTANT_MAX_OPERATIONS),
  })
  .strict();

export type ApplyProposalRequest = z.infer<typeof applyProposalRequestSchema>;
