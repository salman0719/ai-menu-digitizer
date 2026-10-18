import {
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
