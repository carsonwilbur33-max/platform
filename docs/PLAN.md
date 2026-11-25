# Platform — coach programming app: plan

Working name "Platform". Single coach, 3–8 athletes (room to grow). Built for one coach's workflow, not a generic SaaS.

## Decisions taken from the clarifying round (all defaults accepted)

| # | Topic | Decision |
|---|-------|----------|
| 1 | TM for variations | Per athlete per exercise: either its own TM, or parent lift's TM × ratio (e.g. pause squat = 0.90 × squat). Own TM wins if set. |
| 2 | TM changes mid-block | TMs are dated. Unlogged sets resolve against the TM effective on their planned date; logged sets keep a snapshot of the load shown at log time. |
| 3 | Backoff reference | Uses the athlete's *actual* logged top set. Both `-8%` (of top-set load) and `80% e1RM` (of top-set e1RM) supported. |
| 4 | Repeat until RPE X | Open-ended set count at the backoff load, optional max-sets cap. |
| 5 | Grid | Rows = exercise slots within a day; columns = weeks. Each cell may override the exercise; rows can be empty in some weeks. |
| 6 | Entry | Typed shorthand parsed live (see below), with a structured editor fallback. |
| 7 | Scheduling | Each day has a planned date. "Today" = next unlogged day. Missed = planned date passed with no log. |
| 8 | Off-script | Athletes can add unprescribed sets/exercises and substitute exercises; shown as such to the coach. |
| 9 | Lookahead | Athletes see the whole block, read-only. |
| 10 | Edits after logging | A logged set stores a snapshot of its prescription; comparisons use the snapshot and show an "edited after logging" marker. |
| 11 | Units | Canonical storage is kg. Each athlete has a display unit and rounding increment; per-exercise unit/rounding overrides (e.g. lb dumbbells). |
| 12 | Auth | Email + password, set via an invite link the coach sends. No public sign-up. |
| 13 | Coach as athlete | Not in v1 UI, but the model allows it (an athlete row can be linked to the coach's user). |

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | **Next.js 15 (App Router) + React 19 + TypeScript** | One codebase for coach UI, athlete mobile web, and server code. React has the best ecosystem for a keyboard-driven spreadsheet grid. TypeScript keeps the prescription model honest. |
| Database | **PostgreSQL** via **Drizzle ORM** | Relational data (athlete → program → block → week → day → …) with real foreign keys; Drizzle is typed, thin, SQL-like, and migrations are plain SQL files. |
| Local DB | **PGlite** (Postgres compiled to WASM, stored in `.data/`) | `npm install && npm run setup && npm run dev` — no Docker or Postgres install needed. Same SQL as production. |
| Hosted DB | **Neon** free tier (or Supabase as plain Postgres) | Free, generous for this size. Set `DATABASE_URL` and the app switches drivers automatically. |
| Auth | Small in-house session auth (scrypt password hashes, hashed session tokens in httpOnly cookies, invite tokens) | ~200 lines, no third-party auth service, no email provider needed (you send the invite link yourself). |
| Styling | **Tailwind CSS 4** | Fast to build dense, custom UI; easy dark mode. |
| Grid | **Custom React grid** (no library) | Our grid is hierarchical (days → slots × weeks) with parsed multi-set cells; generic grid libraries fight that. A few hundred cells don't need virtualization. |
| Charts | Recharts (Phase 4) | Simple, React-native. |
| Tests | **Vitest** | Fast unit tests for the pure calculation library. |
| Hosting | See note | |

**Hosting note:** Vercel's free *Hobby* plan is for non-commercial use. If you charge athletes, the honest options are: (a) Netlify or Cloudflare (free tiers allow commercial use; Next.js runs via their adapters), or (b) Vercel Pro ($20/mo). The app stays on the standard Node runtime so any of these work. Decided at deploy time (Phase 6).

## Prescription model

A **set group** is one line of a prescription, e.g. `3x5 @7-7.5 [175-180kg]`.

```
SetGroup {
  mode:   'straight' | 'workUp' | 'repeatUntil'
  sets:   {min,max} | null                 // null for repeatUntil
  reps:   {min,max} | 'amrap'
  target: Intensity | null                 // what the athlete aims for
  bounds: Intensity[]                      // hard limits
  amrapRpeCap?, repeatUntilRpe?, maxSets?
}
Intensity =
  | rpe {min,max}        | rir {min,max}
  | pct1rm {min,max}     // % of training max
  | load {minKg,maxKg,unit}
  | drop {min,max}       // % drop from today's top set
  | pctE1rm {min,max}    // % of today's top-set e1RM
```

### Shorthand (cell entry)

Set groups are separated by `;` or new lines.

| Typed | Meaning |
|-------|---------|
| `3x5 @8` | 3 sets of 5 at RPE 8 |
| `3-4x6-8 @7-8` | 3–4 sets of 6–8 at RPE 7–8 |
| `3x5 rir2` / `3x5 rir1-2` | RIR target |
| `5x5 75%` / `4x6 72-77%` | % of training max |
| `3x5 180kg` / `3x8 135-145lb` | Fixed load |
| `3x5 @7-7.5 [175-180kg]` | RPE target, load hard bound |
| `3x3 80% [@6-8.5]` | % target, RPE hard bound |
| `top 1 @8` | Work up to a top single @8 |
| `4x4 -8%` | Backoff: 8% below today's top set |
| `3x3 80%e1rm` | Backoff: 80% of today's top-set e1RM |
| `4 -8% until @9 max6` | Repeat sets of 4 at −8% until RPE 9, cap 6 sets |
| `1xAMRAP 80% @9` | AMRAP at 80%, stop at RPE 9 |
| `top 1 @8; 4x4 -8%` | Two set groups in one cell |

Exercise-level fields (not part of the shorthand): variation modifiers (pause, tempo, pins, belt), rest, notes, unit override.

### Suggested loads
- `pct1rm` → TM × %.  `load` → as written.  `drop`/`pctE1rm` → from the athlete's logged top set (coach view estimates from the top set's suggested load).
- `rpe`/`rir` → TM × RPE-chart % for the rep count, shown as an estimate (≈).
- When a target and a load-type bound are combined, the suggestion is the target range clamped to the bound.
- Rounded to the athlete's increment (default 2.5 kg / 5 lb), in the athlete's unit or the exercise's override unit.

### Flags on logged sets
RPE outside target/bound range; load outside bound (or outside a load/% target); reps below range. Computed when the set is logged against the stored snapshot.

### e1RM
RPE chart (Tuchscherer-style, reps 1–12 × RPE 6–10, editable) when RPE is logged; Epley (default) or Brzycki otherwise. Coach-only, never overwrites TMs.

## Data model

```
users            id, email, password_hash, role(coach|athlete), name
auth_sessions    id(token hash), user_id, expires_at
invites          id, token_hash, athlete_id, expires_at, used_at

athletes         id, user_id?, name, email?, unit(kg|lb), rounding_kg, rounding_lb,
                 bodyweight_kg?, rpe_chart_id?, e1rm_formula, notes, archived_at
exercises        id, name, category(squat|bench|deadlift|upper|lower|core|other),
                 parent_id? (variation of), default_tm_ratio?, is_custom, archived_at
athlete_exercise_settings
                 athlete_id, exercise_id, unit?, rounding?, tm_ratio?  (PK both)
training_maxes   id, athlete_id, exercise_id, weight_kg, effective_date, note
manual_records   id, athlete_id, exercise_id, weight_kg, reps, date, context(gym|meet), note
rpe_charts       id, name, data(jsonb: reps×rpe → %), is_default

programs         id, athlete_id? (null = template), name, is_template,
                 source_template_id?, notes
blocks           id, program_id, position, name, kind(hypertrophy|strength|peak|pivot|other),
                 start_date, notes
weeks            id, block_id, position, notes
block_days       id, block_id, position, name, weekday?      ← "Day 1" row group
slots            id, block_day_id, position                  ← grid row
workouts         id, week_id, block_day_id, planned_date, completed_at, athlete_notes
planned_exercises
                 id, workout_id, slot_id?, exercise_id, position, modifiers(jsonb),
                 rest_seconds?, notes, unit_override?         ← grid cell
set_groups       id, planned_exercise_id, position, prescription(jsonb, SetGroup)

logged_sets      id, workout_id, planned_exercise_id?, set_group_id?, exercise_id,
                 set_index, weight_kg, weight_entered, unit_entered, reps, rpe?,
                 video_url?, notes, prescription_snapshot(jsonb), suggested_kg?,
                 deviation_flags(jsonb), is_unprescribed, performed_at
athlete_notes    id, athlete_id, workout_id?, logged_set_id?, kind(note|pain|missed_reps|other),
                 body, read_by_coach_at

meets            id, name, date, federation, location
meet_entries     id, meet_id, athlete_id, weight_class, division, notes
meet_attempts    id, entry_id, lift(squat|bench|deadlift), attempt(1-3), planned_kg, actual_kg?, result?
```

Integrity rules that protect logged data while editing an in-progress block:
- Deleting a set group / planned exercise sets `logged_sets` links to NULL; the snapshot keeps the comparison intact.
- A workout (week × day) with logged sets cannot be deleted; the grid warns and offers to clear only the prescription.
- Templates are programs with `is_template = true` and no athlete. Assigning one deep-copies it, so editing the athlete's copy never touches the template.

## Phases

| Phase | Contents | Done when |
|-------|----------|-----------|
| **1. Foundation** | Scaffold, schema + migrations, auth (login, roles, invite links), calculation library (units, rounding, RPE chart, e1RM, load suggestion, deviation flags, shorthand parser/formatter) with unit tests, seed (coach, demo athlete, exercise library, TMs, 4-week block using every prescription type), coach athlete list/settings/TMs, read-only block view with suggested loads. | `npm test` passes; seeded block renders with correct loads; invite flow works. |
| **2. Programming grid** | Weeks-side-by-side grid, keyboard nav + inline shorthand editing with live parse errors and load previews, exercise picker/library (custom + variations), modifiers/rest/notes, copy/paste/duplicate days/weeks/blocks, bulk edit (e.g. +2.5%/week), undo/redo, templates (save/assign), safe editing of in-progress blocks, meet countdown in the header. | You can write a full block from the keyboard. |
| **3. Athlete logging** | Mobile-first Today view, prescription + suggested loads, log weight/reps/RPE/notes/video link per set, live backoff loads from the actual top set, repeat-until flow, unprescribed sets + substitutions, flags (pain, missed reps), deviation flags, whole-block read-only view. | An athlete can run a session on a phone. |
| **4. Dashboard & analytics** | Roster (trained / missed / unread notes / PRs), per-athlete e1RM trends, weekly volume (sets, reps, tonnage), average intensity, compliance, training history, manual past maxes, RPE chart editor, CSV export. | You can review all athletes in a couple of minutes. |
| **5. Meets** | Meets + entries, countdown everywhere relevant, attempt planner suggesting openers/seconds/thirds from recent e1RM and top sets, editable. | Attempts planned from data. |
| **6. Deploy** | Neon database, hosting choice, production coach account, backup/export notes. | Live URL. |
