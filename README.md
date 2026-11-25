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

### Updating

After `git pull`, install any new packages and apply database changes (your data is kept):

```bash
npm install
npm run db:migrate
```

Or start over with fresh demo data: `npm run db:reset`.

## Programming editor

Open an athlete → a block. The grid shows each training day as its own section with weeks side by side.

| Keys | Action |
|------|--------|
| Arrows · Tab · Shift+Tab | Move between cells |
| Type anything | Start writing in the cell |
| Enter · F2 | Edit cell / pick the row's exercise |
| Enter / Tab while editing | Save and move down / right (Shift+Enter = new set group) |
| Shift+Arrows · Shift+click · drag | Select a range |
| Delete | Clear cells (on the exercise column: delete the row) |
| Ctrl/⌘ + C · X · V | Copy · cut · paste (works across blocks and with Google Sheets) |
| Ctrl/⌘ + R | Fill right (copy the previous week across the selection) |
| Ctrl/⌘ + B | Bulk edit (e.g. +2.5% per week, +5 kg, RPE +0.5, ±sets/reps) |
| Ctrl/⌘ + Enter | Insert a row below |
| Alt + ↑ / ↓ | Move a row |
| Ctrl/⌘ + I | Side panel: swap this week's exercise, modifiers, rest, notes, unit |
| Ctrl/⌘ + Z · Ctrl/⌘ + Shift + Z | Undo · redo |
| ? | All shortcuts and the prescription shorthand |

Edits save automatically. Editing a block in progress keeps the athlete's logged sets attached; days and weeks with logged sessions can't be deleted.

**Templates** (top nav): save any block as a template, create one from scratch, and assign it to an athlete. Each assignment is an independent copy.
**Exercises** (top nav): add custom exercises and variations, set a variation's TM ratio to its parent lift, archive ones you don't use.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server |
| `npm test` | Unit tests (calculations, shorthand, bulk edits, editor operations and undo) and database integration tests |
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
src/lib/editor/      editor operations, reducer with undo inverses, grid commands (paste, fill, bulk edit…)
src/components/editor/  the programming grid UI
src/db/              Drizzle schema + client (PGlite or Postgres)
src/server/          server-only data access: auth, applying editor ops to the DB, block copy, loaders
src/app/             Next.js routes: /login, /invite/[token], /coach/…, /athlete
scripts/             migrate, seed, reset, create-coach
drizzle/             SQL migrations
```
