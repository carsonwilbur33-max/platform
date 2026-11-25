# Platform

Powerlifting programming and training log for one coach and their athletes.
See [`docs/PLAN.md`](docs/PLAN.md) for the stack, data model, prescription shorthand, and phase plan.

## Run it locally

Requires Node 20+ (22 recommended). No database install needed: locally it uses an embedded Postgres (PGlite) stored in `.data/`.

```bash
npm install
npm run setup      # create tables + seed demo data
npm run dev        # http://localhost:3000
```

Demo logins (from the seed):

| Role | Email | Password |
|------|-------|----------|
| Coach | coach@example.com | changeme123 |
| Athlete (Alex Demo) | athlete@example.com | changeme123 |

Stop `npm run dev` before running database scripts: the embedded database allows one process at a time.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server |
| `npm test` | Unit tests (load calc, rounding, units, e1RM, shorthand parser, flags, dates, auth hashing) |
| `npm run lint` | Type-check |
| `npm run db:reset` | Wipe the local database, re-migrate, re-seed (demo block is always positioned so today is in week 2) |
| `npm run db:generate` | Generate a SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run create-coach -- you@example.com "Your Name"` | Create/reset the coach login (prompts for password) |

## Hosted database

Set `DATABASE_URL` (Neon / Supabase connection string) in `.env` and the app switches from PGlite to Postgres automatically. `db:reset` refuses to touch a hosted database unless `ALLOW_RESET=1`.

## Layout

```
src/lib/calc/        pure calculation library (+ tests): units, rounding, RPE chart, e1RM,
                     prescription model, shorthand parser/formatter, load suggestion, flags
src/lib/program/     athlete context (TM resolution, unit/rounding overrides), set evaluation
src/db/              Drizzle schema + client (PGlite or Postgres)
src/server/          server-only data access: auth, block grid loader
src/app/             Next.js routes: /login, /invite/[token], /coach/…, /athlete
scripts/             migrate, seed, reset, create-coach
drizzle/             SQL migrations
```
