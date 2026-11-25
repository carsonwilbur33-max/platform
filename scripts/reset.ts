import "./env";
import fs from "node:fs";
import { assertLocalDbFree, LocalDbError, PGLITE_DIR, PGLITE_LOCK, usingPglite } from "../src/db";

if (usingPglite()) {
  try {
    assertLocalDbFree();
  } catch (e) {
    if (e instanceof LocalDbError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  fs.rmSync(PGLITE_DIR, { recursive: true, force: true });
  fs.rmSync(PGLITE_LOCK, { force: true });
  console.log("Deleted local database (.data/pglite).");
} else if (process.env.ALLOW_RESET === "1") {
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL!);
  await sql.unsafe("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
  await sql.end();
  console.log("Dropped and recreated the public schema on DATABASE_URL.");
} else {
  console.error("Refusing to reset a hosted database. Set ALLOW_RESET=1 if you really mean it.");
  process.exit(1);
}
process.exit(0);
