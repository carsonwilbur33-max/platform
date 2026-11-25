import { PGlite } from "@electric-sql/pglite";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
export type DB = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** A db handle or an open transaction. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

export const PGLITE_DIR = path.join(process.cwd(), ".data", "pglite");
export const PGLITE_LOCK = path.join(process.cwd(), ".data", "pglite.lock");

export function usingPglite(): boolean {
  return !process.env.DATABASE_URL;
}

// ---------------------------------------------------------------------------
// Local embedded database (PGlite) safety
//
// PGlite is Postgres running inside this Node process. Only ONE process may
// have the data folder open at a time: a second dev server, or `npm run setup`
// while `npm run dev` is running, can corrupt it. A lock file holding the
// owner's PID turns that into a clear error instead.
// ---------------------------------------------------------------------------

export class LocalDbError extends Error {}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, owned by someone else
  }
}

/** Throws if another live process has the local database open. */
export function assertLocalDbFree(): void {
  try {
    const owner = Number(fs.readFileSync(PGLITE_LOCK, "utf8").trim());
    if (owner && owner !== process.pid && processAlive(owner)) {
      throw new LocalDbError(
        [
          `The local database is already open in another process (PID ${owner}).`,
          `Only one copy of the app can use it at a time. Stop the other one first:`,
          `  - close any other terminal running "npm run dev", or`,
          `  - stop that process in Task Manager (look for "Node.js JavaScript Runtime").`,
          `If you're sure nothing else is running, delete .data/pglite.lock and try again.`,
        ].join("\n"),
      );
    }
  } catch (e) {
    if (e instanceof LocalDbError) throw e;
    // No lock file (or unreadable): free.
  }
}

function acquireLock(): void {
  assertLocalDbFree();
  fs.mkdirSync(path.dirname(PGLITE_LOCK), { recursive: true });
  fs.writeFileSync(PGLITE_LOCK, String(process.pid));
}

function releaseLock(): void {
  try {
    if (Number(fs.readFileSync(PGLITE_LOCK, "utf8").trim()) === process.pid) fs.unlinkSync(PGLITE_LOCK);
  } catch {
    // already gone
  }
}

const RECOVERY_HINT = [
  "The local database in .data/pglite could not start. It was most likely left in a bad state",
  "by a crash or by two copies of the app running at once. To rebuild it with the demo data:",
  "  1. Stop every running copy of the app (close the terminals, or end Node.js in Task Manager).",
  "  2. Run:  npm run db:reset",
  "  3. Run:  npm run dev",
].join("\n");

function openPglite(): DB {
  acquireLock();
  const client = new PGlite(PGLITE_DIR);
  // If Postgres fails to start, explain how to recover instead of letting an
  // unhandled rejection crash the dev server. Queries then fail with the error.
  client.waitReady.catch((e: unknown) => {
    releaseLock();
    console.error(`\n[database] ${RECOVERY_HINT}\n\nUnderlying error: ${e instanceof Error ? e.message : String(e)}\n`);
  });

  let closing = false;
  const shutdown = (code: number) => {
    if (closing) return;
    closing = true;
    // Close cleanly so the data folder isn't left mid-write, then exit.
    client
      .close()
      .catch(() => {})
      .finally(() => {
        releaseLock();
        process.exit(code);
      });
  };
  process.once("SIGINT", () => shutdown(130));
  process.once("SIGTERM", () => shutdown(143));
  process.once("exit", releaseLock);

  return drizzlePglite(client, { schema }) as unknown as DB;
}

function create(): DB {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url, { max: process.env.NODE_ENV === "production" ? 5 : 3, prepare: false });
    return drizzlePostgres(client, { schema }) as unknown as DB;
  }
  return openPglite();
}

// One connection per process, created on first use (not at import time, so
// `next build` workers that merely import this module never open the database).
const g = globalThis as unknown as { __db?: DB };
function getDb(): DB {
  return g.__db ?? (g.__db = create());
}

export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

export { schema };
