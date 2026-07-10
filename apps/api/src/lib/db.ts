import type { Pool } from "pg";
import type { Database } from "./adapter-types";

/**
 * Wraps a pg.Pool to implement the Database interface used by route handlers.
 */
export function createDatabase(pool: Pool): Database {
  return {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },
    async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
      const result = await pool.query(sql, params);
      return (result.rows[0] as T) ?? null;
    },
  };
}
