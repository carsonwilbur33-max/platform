import "./env";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import fs from "node:fs";
import { db, PGLITE_DIR, usingPglite } from "../src/db";

async function main() {
  const migrationsFolder = "./drizzle";
  if (usingPglite()) {
    fs.mkdirSync(PGLITE_DIR, { recursive: true });
    await migratePglite(db as never, { migrationsFolder });
  } else {
    await migratePostgres(db as never, { migrationsFolder });
  }
  console.log(`Migrations applied (${usingPglite() ? "local PGlite at .data/pglite" : "DATABASE_URL"}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
