import { PGlite } from "@electric-sql/pglite";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import path from "node:path";
import postgres from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
export type DB = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** A db handle or an open transaction. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

export const PGLITE_DIR = path.join(process.cwd(), ".data", "pglite");

export function usingPglite(): boolean {
  return !process.env.DATABASE_URL;
}

function create(): DB {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url, { max: process.env.NODE_ENV === "production" ? 5 : 3, prepare: false });
    return drizzlePostgres(client, { schema }) as unknown as DB;
  }
  return drizzlePglite(new PGlite(PGLITE_DIR), { schema }) as unknown as DB;
}

// Reuse one connection across Next.js hot reloads (PGlite allows one open handle per directory).
const g = globalThis as unknown as { __db?: DB };
export const db: DB = g.__db ?? (g.__db = create());

export { schema };
