import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Canonical server DB schema (Drizzle, Postgres/Neon).
 *
 * Two groups of tables:
 * 1. Better Auth core tables (`user`, `session`, `account`, `verification`).
 *    Table/field names follow Better Auth's contract exactly so the Drizzle
 *    adapter (see `src/lib/auth/index.ts`) finds them without remapping.
 * 2. Tenancy tables for this product (`restaurant`, `restaurant_membership`).
 *    One owner/staff membership per (restaurant, user); diners never get
 *    accounts (PHASE-2.md §3.1, §3.6).
 *
 * The local-first prototype (IndexedDB) does not use any of this — the
 * server is an opt-in upgrade path, never a required one.
 */

const createdAt = () => timestamp("created_at").notNull().defaultNow();
const updatedAt = () => timestamp("updated_at").notNull().defaultNow();

/** Better Auth `user` model. Magic link is the only human sign-in. */
export const user = pgTable("user", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Better Auth `session` model — cookie sessions for signed-in owners/staff. */
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    tokenUnique: uniqueIndex("session_token_unique").on(t.token),
  })
);

/** Better Auth `account` model (provider accounts; magic link writes here too). */
export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    providerAccountUnique: uniqueIndex("account_provider_account_unique").on(
      t.providerId,
      t.accountId
    ),
  })
);

/** Better Auth `verification` model (magic-link tokens live here). */
export const verification = pgTable("verification", {
  id: text("id").primaryKey().notNull(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * A restaurant (café) tenant. `slug` is reserved for the public `/m/<slug>`
 * menu page in Step 9 — nullable until publishing exists.
 */
export const restaurant = pgTable(
  "restaurant",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    slug: text("slug"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt().$onUpdateFn(() => new Date()),
  },
  (t) => ({
    slugUnique: uniqueIndex("restaurant_slug_unique").on(t.slug),
  })
);

/** Roles within a restaurant. Diners/customers never hold a membership. */
export type RestaurantRole = "owner" | "staff";

/** Owner/staff membership linking a Better Auth user to a restaurant. */
export const restaurantMembership = pgTable(
  "restaurant_membership",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurant.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "staff"] })
      .notNull()
      .$defaultFn(() => "owner" as RestaurantRole),
    createdAt: createdAt(),
  },
  (t) => ({
    membershipUnique: uniqueIndex("restaurant_membership_unique").on(t.restaurantId, t.userId),
  })
);

/**
 * A menu document owned by a restaurant (Step 8 — server-backed menus).
 * `doc` is the full canonical `MenuDocument` as jsonb, re-validated with
 * the same Zod schema on every read and write so a malformed row fails
 * loudly instead of rendering garbage (AGENTS.md, one canonical schema).
 * `title`/`currency` are denormalized for cheap library listings, and
 * `updated_at` mirrors `doc.updatedAt`: it is the single column the
 * "changed elsewhere" conflict check compares against, and it is stamped
 * from the server clock on every write — the server owns the timeline.
 */
export const menu = pgTable(
  "menu",
  {
    /** Client-generated (app) id — preserved by "Move my menus to my account". */
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurant.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    currency: text("currency"),
    doc: jsonb("doc").$type<unknown>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    // Library listings are scoped to one restaurant.
    restaurantIdx: index("menu_restaurant_idx").on(t.restaurantId),
  })
);

/**
 * An immutable published snapshot of a menu (Step 9). Publishing copies the
 * canonical document here, so a later edit never silently changes what the
 * public page shows — "publish changes" creates the next revision and moves
 * the live pointer. `sourceUpdatedAt` records the `menu.updated_at` the
 * snapshot was taken from: when the live revision's value no longer matches
 * the menu row, the owner has draft changes that are not published.
 *
 * `doc` is re-validated with the canonical Zod schema on read, exactly like
 * `menu.doc`; history rows are never rewritten.
 */
export const menuRevision = pgTable(
  "menu_revision",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    menuId: text("menu_id")
      .notNull()
      .references(() => menu.id, { onDelete: "cascade" }),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurant.id, { onDelete: "cascade" }),
    doc: jsonb("doc").$type<unknown>().notNull(),
    theme: text("theme").notNull(),
    layout: text("layout").notNull(),
    /** The menu revision this snapshot was published from (conflict-free compare). */
    sourceUpdatedAt: timestamp("source_updated_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    menuIdx: index("menu_revision_menu_idx").on(t.menuId, t.createdAt),
  })
);

/**
 * The public pointer for a menu (Step 9): its `/m/<slug>` address, the live
 * revision, and a cookie-free view count.
 *
 * Unpublishing keeps this row and its slug (`publishedAt` and
 * `liveRevisionId` become null), so the address stays reserved for the same
 * café instead of being recycled by whoever grabs it next. Publishing again
 * reuses it. 
 */
export const publishedMenu = pgTable(
  "published_menu",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    menuId: text("menu_id")
      .notNull()
      .references(() => menu.id, { onDelete: "cascade" }),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurant.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    liveRevisionId: text("live_revision_id").references(() => menuRevision.id, {
      onDelete: "set null",
    }),
    /** Null = reserved but not serving (the page 404s). */
    publishedAt: timestamp("published_at"),
    viewCount: integer("view_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt().$onUpdateFn(() => new Date()),
  },
  (t) => ({
    menuUnique: uniqueIndex("published_menu_menu_unique").on(t.menuId),
    slugUnique: uniqueIndex("published_menu_slug_unique").on(t.slug),
  })
);

/**
 * A table order (Step 10 — ordering across devices).
 *
 * `restaurant_id` scopes the order to a tenant; `menu_id` is nullable and
 * clears if the menu is deleted, while `menu_title`/`currency` and every line
 * keep a snapshot so order history survives menu edits and deletions. The
 * total is computed on the server only and stored in integer cents; it is
 * null as soon as any line has no price (Phase 1 honesty: never a partial
 * sum). Status is one of the Phase 1 set and only ever moves forward.
 */
export const order = pgTable(
  "order",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurant.id, { onDelete: "cascade" }),
    menuId: text("menu_id").references(() => menu.id, { onDelete: "set null" }),
    menuTitle: text("menu_title").notNull(),
    /** Free-form table label copied from the link: "3", "Patio 2", "Bar". */
    tableLabel: text("table_label").notNull(),
    currency: text("currency"),
    note: text("note"),
    status: text("status", { enum: ["new", "preparing", "served", "cancelled"] })
      .notNull()
      .$defaultFn(() => "new" as const),
    /** Server-computed cents; null when any line is unpriced. */
    totalCents: integer("total_cents"),
    createdAt: createdAt(),
    updatedAt: updatedAt().$onUpdateFn(() => new Date()),
  },
  (t) => ({
    restaurantCreatedIdx: index("order_restaurant_created_idx").on(t.restaurantId, t.createdAt),
    restaurantStatusIdx: index("order_restaurant_status_idx").on(t.restaurantId, t.status),
  })
);

/** One line of an order: a snapshot of the menu item at ordering time. */
export const orderLine = pgTable(
  "order_line",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orderId: text("order_id")
      .notNull()
      .references(() => order.id, { onDelete: "cascade" }),
    menuItemId: text("menu_item_id").notNull(),
    name: text("name").notNull(),
    variantName: text("variant_name"),
    /** Integer cents, or null when the menu showed no price. */
    unitPriceCents: integer("unit_price_cents"),
    quantity: integer("quantity").notNull(),
  },
  (t) => ({
    orderIdx: index("order_line_order_idx").on(t.orderId),
  })
);

/**
 * Fixed-window counters for the anonymous order endpoint (Step 10).
 * `key` is a one-way hash of the caller's address plus the window minute, so
 * no raw IP is stored; rows are tiny and can be swept by age in Step 11.
 */
export const orderRateLimit = pgTable("order_rate_limit", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start").notNull(),
  count: integer("count").notNull().default(0),
});

/**
 * One Gemini extraction, recorded for the free-launch cost brake (Step 11).
 *
 * `user_id` is null for the anonymous local-first flow, which is instead
 * identified by `caller_hash` — a one-way hash of the caller's address, never
 * the address itself. `input_tokens`/`output_tokens` are what the provider
 * reported (null when it reported nothing), and `cost_micros` is null unless
 * both token counts and per-token rates are configured: no invented prices.
 *
 * Rows are the source of truth for the monthly per-account cap and for the
 * spend panel; they are kept as an audit trail even after the cap changes.
 */
export const extractionUsage = pgTable(
  "extraction_usage",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    /** Hashed caller address for anonymous extraction; null when signed in. */
    callerHash: text("caller_hash"),
    requestId: text("request_id").notNull(),
    model: text("model").notNull(),
    pages: integer("pages").notNull(),
    imageBytes: integer("image_bytes").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /** Micro-USD (1e-6 dollars); null when rates or token counts are unknown. */
    costMicros: bigint("cost_micros", { mode: "number" }),
    status: text("status", { enum: ["succeeded", "failed"] }).notNull(),
    errorCode: text("error_code"),
    createdAt: createdAt(),
  },
  (t) => ({
    userCreatedIdx: index("extraction_usage_user_created_idx").on(t.userId, t.createdAt),
    callerCreatedIdx: index("extraction_usage_caller_created_idx").on(t.callerHash, t.createdAt),
  })
);

/** Everything the Drizzle adapter and app code share. */
export const schema = {
  user,
  session,
  account,
  verification,
  restaurant,
  restaurantMembership,
  menu,
  menuRevision,
  publishedMenu,
  order,
  orderLine,
  orderRateLimit,
  extractionUsage,
};

/** A restaurant as seen by a member: restaurant fields + that member's role. */
export type RestaurantWithRole = {
  id: string;
  name: string;
  slug: string | null;
  createdAt: Date;
  updatedAt: Date;
  role: RestaurantRole;
};
