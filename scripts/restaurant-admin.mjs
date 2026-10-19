#!/usr/bin/env node
/**
 * Inspect, rename, or remove a restaurant row in the dev database by id.
 *
 * A maintenance escape hatch for leftovers like a stray "My cafe": the app
 * UI now has rename/delete too, but this works even when the account is
 * unreachable. Talks to the same Neon database the app uses (DATABASE_URL),
 * with parameterised SQL only. Delete is refused without `--yes` and always
 * reports what cascades first — restaurant deletion removes its menus,
 * published pages and orders.
 *
 * Usage (DATABASE_URL is read from .env.local via the npm script):
 *   npm run admin:restaurant -- list
 *   npm run admin:restaurant -- rename <restaurantId> "<new name>"
 *   npm run admin:restaurant -- delete <restaurantId> --yes
 *
 * Exit codes: 0 success, 1 not found / refused, 2 usage or missing config.
 */

import { neon } from "@neondatabase/serverless";

const USAGE = `Usage:
  npm run admin:restaurant -- list
  npm run admin:restaurant -- rename <restaurantId> "<new name>"
  npm run admin:restaurant -- delete <restaurantId> --yes`;

function fail(message, exitCode) {
  console.error(message);
  process.exit(exitCode);
}

function needId(rest, command) {
  const id = rest[0];
  if (!id) fail(`Missing <restaurantId> for ${command}.\n\n${USAGE}`, 2);
  return id;
}

async function findRestaurant(sql, id) {
  const rows = await sql`select id, name from restaurant where id = ${id}`;
  return rows[0] ?? null;
}

async function listCommand(sql) {
  const rows = await sql`
    select r.id,
           r.name,
           (select count(*) from menu m where m.restaurant_id = r.id) as menu_count,
           (select count(*) from "order" o where o.restaurant_id = r.id) as order_count,
           r.created_at
    from restaurant r
    order by r.created_at
  `;
  if (rows.length === 0) {
    console.log("No restaurants in this database.");
    return;
  }
  for (const row of rows) {
    console.log(
      `${row.id}  ${row.name}  (menus: ${row.menu_count}, orders: ${row.order_count}, created ${row.created_at.toISOString()})`
    );
  }
}

async function renameCommand(sql, rest) {
  const id = needId(rest, "rename");
  const name = rest.slice(1).join(" ").trim();
  if (!name) fail(`Missing the new name.\n\n${USAGE}`, 2);

  const existing = await findRestaurant(sql, id);
  if (!existing) fail(`No restaurant with id ${id}.`, 1);

  const updated = await sql`
    update restaurant set name = ${name}, updated_at = now() where id = ${id}
    returning id, name
  `;
  console.log(`Renamed ${updated[0].id}: “${existing.name}” -> “${updated[0].name}”.`);
}

async function deleteCommand(sql, rest) {
  const id = needId(rest, "delete");
  if (!rest.includes("--yes")) {
    fail(
      `Refusing to delete ${id} without --yes. Deleting a restaurant also deletes ` +
        `its menus, published pages and orders.`,
      2
    );
  }

  const existing = await findRestaurant(sql, id);
  if (!existing) fail(`No restaurant with id ${id}.`, 1);

  const [impact] = await sql`
    select (select count(*) from menu where restaurant_id = ${id}) as menu_count,
           (select count(*) from published_menu where restaurant_id = ${id}) as published_count,
           (select count(*) from "order" where restaurant_id = ${id}) as order_count,
           (select count(*) from restaurant_membership where restaurant_id = ${id}) as member_count
  `;
  console.log(
    `Deleting “${existing.name}” (${id}) — cascading: ${impact.menu_count} menu(s), ` +
      `${impact.published_count} published page(s), ${impact.order_count} order(s), ` +
      `${impact.member_count} membership(s).`
  );

  const deleted = await sql`delete from restaurant where id = ${id} returning id`;
  if (deleted.length === 0) fail(`No restaurant with id ${id}.`, 1);
  console.log(`Deleted ${id}.`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    process.exit(command ? 0 : 2);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    fail(
      "DATABASE_URL is not set. Put it in .env.local (the npm script loads it) and retry.",
      2
    );
  }
  const sql = neon(url);

  if (command === "list") return listCommand(sql);
  if (command === "rename") return renameCommand(sql, rest);
  if (command === "delete") return deleteCommand(sql, rest);
  fail(`Unknown command “${command}”.\n\n${USAGE}`, 2);
}

try {
  await main();
} catch (error) {
  fail(`restaurant-admin failed: ${error instanceof Error ? error.message : String(error)}`, 1);
}
