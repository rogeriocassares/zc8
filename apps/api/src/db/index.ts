/**
 * Drizzle ORM Database Connection
 *
 * Creates a type-safe Drizzle instance connected to PostgreSQL via `pg`.
 * Re-exports everything callers need so they never touch `pg` directly.
 */

import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DrizzleDB = NodePgDatabase<typeof schema>;

/**
 * Initialise Drizzle ORM with a node-postgres pool.
 *
 * @example
 * ```ts
 * const { db, pool } = createDrizzleDB({
 *   user: "zc8", password: "zc8", host: "localhost", port: 5432, database: "zc8"
 * });
 * ```
 */
export function createDrizzleDB(pgConfig: {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
}) {
  const pool = new Pool(pgConfig);
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export { schema };

/**
 * Execute a callback within a PostgreSQL transaction that sets RLS session
 * variables (`app.org_id` and `app.is_super_admin`) so that row-level
 * security policies can filter rows by tenant.
 *
 * @example
 * ```ts
 * const rows = await withTenantScope(db, orgId, isSuperAdmin, async (tx) => {
 *   return tx.select().from(schema.devices);
 * });
 * ```
 */
export async function withTenantScope<T>(
  db: DrizzleDB,
  orgId: number | null,
  isSuperAdmin: boolean,
  fn: (tx: DrizzleDB) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    if (orgId !== null) {
      await tx.execute(
        sql`SELECT set_config('app.org_id', ${String(orgId)}, true)`,
      );
    }
    await tx.execute(
      sql`SELECT set_config('app.is_super_admin', ${isSuperAdmin ? "true" : "false"}, true)`,
    );
    return fn(tx as unknown as DrizzleDB);
  });
}
