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

## Environment variables

None are required to run locally. To override anything, copy `.env.example` to `.env` (or `.env.local`); both the app and the database scripts read it. Env files other than `.env.example` are git-ignored.

| Variable | Needed? | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | Production only | Hosted Postgres (Neon/Supabase). Unset = embedded local database in `.data/`. |
| `SEED_COACH_EMAIL` | Optional | Demo coach login created by `npm run setup` (default `coach@example.com`). |
| `SEED_COACH_PASSWORD` | Optional | Its password (default `changeme123`). |
| `ALLOW_RESET` | Never in a file | Set to `1` on the command line to let `db:reset` wipe a hosted database. |

## Troubleshooting

**"The local database is already open in another process"**: another copy of the app (or a script) is using `.data/pglite`. Only one can at a time. Close other terminals running `npm run dev`, or end leftover "Node.js JavaScript Runtime" processes in Task Manager. On Windows PowerShell, this stops every Node process:

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process
```

**"The local database in .data/pglite could not start"**: the local database was damaged, usually by a crash or by two copies running at once. Stop all copies (as above), then rebuild it with the demo data:

```bash
npm run db:reset
npm run dev
```

**Windows: "running scripts is disabled on this system"**: run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` once, or type `npm.cmd` instead of `npm`.

Stop the dev server with **Ctrl+C**. It closes the database cleanly. Avoid closing the terminal window while the server is running.

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
