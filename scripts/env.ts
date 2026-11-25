/**
 * Load .env / .env.local exactly the way Next.js does, so database scripts
 * (migrate, seed, reset, create-coach) see the same DATABASE_URL as `npm run dev`.
 * Must be the first import in every script, before anything touches src/db.
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
