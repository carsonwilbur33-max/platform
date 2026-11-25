/**
 * Seeds a fresh database with:
 *  - the default RPE chart and an exercise library (main lifts, variations, accessories)
 *  - a coach login, a demo athlete with a login, and a second athlete (lb, not yet invited)
 *  - TMs, unit overrides, past maxes, a meet
 *  - a 4-week strength block using every prescription type, positioned so that
 *    today falls in week 2, with week 1 + earlier week-2 sessions logged
 */
import { count, eq } from "drizzle-orm";
import { db } from "../src/db";
import * as s from "../src/db/schema";
import type { TopSetRef } from "../src/lib/calc/load";
import { isBackoff, type ExerciseModifiers, type SetGroup } from "../src/lib/calc/prescription";
import { buildDefaultRpeChart } from "../src/lib/calc/rpe-chart";
import { rx } from "../src/lib/calc/shorthand";
import { roundLoad, toKg, type Unit } from "../src/lib/calc/units";
import { hashPassword } from "../src/lib/crypto";
import { addDays, mondayOf, plannedDate, todayISO } from "../src/lib/dates";
import { evaluateLoggedSet } from "../src/lib/program/evaluate-set";
import { loadAthleteContext } from "../src/server/athlete-context";

// Deterministic randomness so the demo looks the same every time.
let seed = 42;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

// ---------------------------------------------------------------------------
// Exercise library
// ---------------------------------------------------------------------------

type Cat = (typeof s.exerciseCategoryEnum.enumValues)[number];
const LIBRARY: { name: string; category: Cat; parent?: string; ratio?: number }[] = [
  { name: "Squat", category: "squat" },
  { name: "SSB Squat", category: "squat", parent: "Squat", ratio: 0.85 },
  { name: "Front Squat", category: "squat", parent: "Squat", ratio: 0.8 },
  { name: "High-Bar Squat", category: "squat", parent: "Squat", ratio: 0.9 },
  { name: "Box Squat", category: "squat", parent: "Squat", ratio: 0.85 },
  { name: "Belt Squat", category: "lower" },
  { name: "Bench Press", category: "bench" },
  { name: "Close-Grip Bench Press", category: "bench", parent: "Bench Press", ratio: 0.95 },
  { name: "Larsen Press", category: "bench", parent: "Bench Press", ratio: 0.9 },
  { name: "Spoto Press", category: "bench", parent: "Bench Press", ratio: 0.92 },
  { name: "Feet-Up Bench Press", category: "bench", parent: "Bench Press", ratio: 0.92 },
  { name: "Board Press", category: "bench", parent: "Bench Press", ratio: 1.05 },
  { name: "Incline Bench Press", category: "bench", parent: "Bench Press", ratio: 0.8 },
  { name: "Deadlift", category: "deadlift" },
  { name: "Deficit Deadlift", category: "deadlift", parent: "Deadlift", ratio: 0.9 },
  { name: "Block Pull", category: "deadlift", parent: "Deadlift", ratio: 1.05 },
  { name: "Off-Stance Deadlift", category: "deadlift", parent: "Deadlift", ratio: 0.9 },
  { name: "Romanian Deadlift", category: "deadlift", parent: "Deadlift", ratio: 0.7 },
  { name: "Stiff-Leg Deadlift", category: "deadlift", parent: "Deadlift", ratio: 0.75 },
  { name: "Overhead Press", category: "upper" },
  { name: "DB Bench Press", category: "upper" },
  { name: "DB Row", category: "upper" },
  { name: "Barbell Row", category: "upper" },
  { name: "Chest-Supported Row", category: "upper" },
  { name: "Lat Pulldown", category: "upper" },
  { name: "Pull-Up", category: "upper" },
  { name: "Chin-Up", category: "upper" },
  { name: "Dip", category: "upper" },
  { name: "JM Press", category: "upper" },
  { name: "Triceps Pushdown", category: "upper" },
  { name: "Skull Crusher", category: "upper" },
  { name: "DB Curl", category: "upper" },
  { name: "Face Pull", category: "upper" },
  { name: "Lateral Raise", category: "upper" },
  { name: "Leg Press", category: "lower" },
  { name: "Bulgarian Split Squat", category: "lower" },
  { name: "Walking Lunge", category: "lower" },
  { name: "Leg Extension", category: "lower" },
  { name: "Leg Curl", category: "lower" },
  { name: "Hip Thrust", category: "lower" },
  { name: "Back Extension", category: "lower" },
  { name: "Glute-Ham Raise", category: "lower" },
  { name: "Reverse Hyper", category: "lower" },
  { name: "Calf Raise", category: "lower" },
  { name: "Ab Wheel", category: "core" },
  { name: "Hanging Leg Raise", category: "core" },
  { name: "Cable Crunch", category: "core" },
  { name: "Pallof Press", category: "core" },
];

// ---------------------------------------------------------------------------
// The demo block. Each row lists one cell per week; a cell is a prescription
// string, null (empty that week), or { ex, rx } to swap the exercise that week.
// ---------------------------------------------------------------------------

type Cell = string | null | { ex: string; rx: string };
interface Row {
  ex: string;
  mods?: ExerciseModifiers;
  rest?: number;
  notes?: string;
  weeks: [Cell, Cell, Cell, Cell];
}
interface Day {
  name: string;
  weekday: number;
  rows: Row[];
}

const BLOCK: Day[] = [
  {
    name: "Heavy squat · paused bench",
    weekday: 0,
    rows: [
      {
        ex: "Squat",
        rest: 240,
        notes: "Top single then backoffs. Same bar path on every rep.",
        // work-up top single @RPE + % drop backoffs
        weeks: ["top 1 @8; 4x4 -10%", "top 1 @8.5; 4x4 -10%", "top 1 @9; 3x3 -8%", "top 1 @7; 2x3 -15%"],
      },
      {
        ex: "Bench Press",
        mods: { pause: "1s" },
        rest: 180,
        // %1RM ranges
        weeks: ["4x6 72-77%", "4x5 75-80%", "4x4 78-82%", "3x5 70%"],
      },
      {
        ex: "Barbell Row",
        rest: 120,
        // RIR single + range, with a week-4 exercise swap
        weeks: ["3x8-10 rir2", "3x8-10 rir1-2", "3x8 rir1", { ex: "Chest-Supported Row", rx: "2x10 rir3" }],
      },
      { ex: "Leg Curl", rest: 90, weeks: ["3x10-12 @8", "3x10-12 @8-9", "3x10-12 @9", null] },
    ],
  },
  {
    name: "Deadlift · close-grip bench",
    weekday: 2,
    rows: [
      {
        ex: "Deadlift",
        rest: 300,
        // work up to a triple/double/single, repeat-until-RPE backoffs, % of top-set e1RM
        weeks: ["top 3 @8; 4 -8% until @9 max5", "top 2 @8.5; 4 -8% until @9 max5", "top 1 @9; 3x3 80%e1rm", "3x3 70%"],
      },
      {
        ex: "Close-Grip Bench Press",
        rest: 180,
        notes: "RPE is the target; the kg range is a hard limit. Stay inside it even if RPE runs off.",
        // RPE target + fixed-load hard bound
        weeks: ["3x6 @7-7.5 [100-105kg]", "3x5 @7.5-8 [105-110kg]", "3x4 @8 [107.5-112.5kg]", "2x5 @6-7 [95-100kg]"],
      },
      {
        ex: "DB Row",
        rest: 90,
        notes: "Per-hand weight. Gym dumbbells are in lb.",
        // fixed load range in lb (athlete is kg, this exercise overridden to lb)
        weeks: ["3x10 70-80lb", "3x10 75-85lb", "3x8 85lb", "2x10 65lb"],
      },
      // sets range + plain AMRAP
      { ex: "Hanging Leg Raise", rest: 60, weeks: ["2-3xAMRAP", "2-3xAMRAP", "3xAMRAP", "2xAMRAP"] },
    ],
  },
  {
    name: "SSB squat · heavy bench",
    weekday: 4,
    rows: [
      {
        ex: "SSB Squat",
        rest: 180,
        mods: { tempo: "3-1-0" },
        // % of a derived TM (squat TM × 0.85)
        weeks: ["3x6 70%", "3x6 72.5%", "3x5 75%", "2x5 65%"],
      },
      {
        ex: "Bench Press",
        rest: 240,
        // % target with an RPE hard bound
        weeks: ["5x3 80% [@6-8.5]", "5x3 82.5% [@6-8.5]", "4x3 85% [@7-9]", "3x3 75% [@5-7]"],
      },
      { ex: "Pull-Up", rest: 120, weeks: ["4x6-8 rir2", "4x6-8 rir2", "4x5-7 rir1", "3x6 rir3"] },
      { ex: "DB Bench Press", rest: 90, weeks: ["3x10-12 50-60lb", "3x10-12 55-65lb", "3x8-10 60-70lb", "2x12 50lb"] },
    ],
  },
  {
    name: "Deficit pulls · pin squat · press",
    weekday: 5,
    rows: [
      {
        ex: "Deficit Deadlift",
        rest: 180,
        mods: { belt: false, other: "2 in deficit" },
        // fixed kg range and single
        weeks: ["3x5 140-150kg", "3x5 150-160kg", "3x4 160kg", "2x4 140kg"],
      },
      {
        ex: "Squat",
        mods: { pins: "just below parallel", pause: "on pins" },
        rest: 180,
        // RPE ranges
        weeks: ["3x4 @6-7", "3x4 @6.5-7.5", "3x3 @7-8", "2x3 @6"],
      },
      {
        ex: "Overhead Press",
        rest: 150,
        // % then AMRAP with an RPE cap
        weeks: ["3x8 70%; 1xAMRAP 70% @9", "3x7 72.5%; 1xAMRAP 72.5% @9", "3x6 75%; 1xAMRAP 75% @9", "2x8 65%"],
      },
      { ex: "Leg Press", rest: 120, weeks: ["3x12 rir2-3", "3x12 rir2", "3x10 rir1-2", "2x12 rir3"] },
      { ex: "Triceps Pushdown", rest: 60, weeks: ["3-4x12-15", "3-4x12-15", "4x12-15", "2x15"] },
    ],
  },
];

/** Working weights for accessories that have no TM (bodyweight movements stay at 0). */
const ACCESSORY_KG: Record<string, number> = {
  "Barbell Row": 90,
  "Chest-Supported Row": 30,
  "Leg Curl": 45,
  "Leg Press": 220,
  "Triceps Pushdown": 32.5,
  "Hanging Leg Raise": 0,
  "Pull-Up": 0,
};

// ---------------------------------------------------------------------------

async function main() {
  const [{ n }] = await db.select({ n: count() }).from(s.users);
  if (n > 0) {
    console.log("Database already has users — skipping seed. Run `npm run db:reset` to start over.");
    process.exit(0);
  }

  const today = todayISO();
  const blockStart = addDays(mondayOf(today), -7); // today is in week 2
  console.log(`Seeding. Today ${today}; demo block starts ${blockStart}.`);

  await db.insert(s.rpeCharts).values({ name: "Tuchscherer (RTS)", data: buildDefaultRpeChart(), isDefault: true });

  // Library: parents first.
  const exId = new Map<string, string>();
  for (const e of LIBRARY.filter((x) => !x.parent)) {
    const [row] = await db.insert(s.exercises).values({ name: e.name, category: e.category }).returning({ id: s.exercises.id });
    exId.set(e.name, row.id);
  }
  for (const e of LIBRARY.filter((x) => x.parent)) {
    const [row] = await db
      .insert(s.exercises)
      .values({ name: e.name, category: e.category, parentId: exId.get(e.parent!)!, defaultTmRatio: e.ratio ?? null })
      .returning({ id: s.exercises.id });
    exId.set(e.name, row.id);
  }
  const ex = (name: string) => {
    const id = exId.get(name);
    if (!id) throw new Error(`Unknown exercise ${name}`);
    return id;
  };

  // Users and athletes.
  const coachEmail = process.env.SEED_COACH_EMAIL ?? "coach@example.com";
  const coachPassword = process.env.SEED_COACH_PASSWORD ?? "changeme123";
  await db.insert(s.users).values({ email: coachEmail, passwordHash: await hashPassword(coachPassword), role: "coach", name: "Coach" });

  const [alexUser] = await db
    .insert(s.users)
    .values({ email: "athlete@example.com", passwordHash: await hashPassword("changeme123"), role: "athlete", name: "Alex Demo" })
    .returning();
  const [alex] = await db
    .insert(s.athletes)
    .values({
      userId: alexUser.id,
      name: "Alex Demo",
      email: "athlete@example.com",
      unit: "kg",
      bodyweightKg: 82.4,
      notes: "Competes 83 kg, IPF. Squat low-bar, conventional pull. Left hip gets cranky with high squat volume.",
    })
    .returning();
  await db.insert(s.athletes).values({ name: "Sam Example", email: null, unit: "lb", roundingLb: 5, bodyweightKg: toKg(181, "lb"), notes: "New athlete, lb gym." });

  // Training maxes: an older set, and the current set effective a week before the block.
  const tmOld = addDays(blockStart, -70);
  const tmNow = addDays(blockStart, -7);
  const TMS: [string, number, number][] = [
    ["Squat", 190, 200],
    ["Bench Press", 125, 130],
    ["Deadlift", 220, 230],
    ["Overhead Press", 65, 70],
  ];
  for (const [name, old, now] of TMS) {
    await db.insert(s.trainingMaxes).values([
      { athleteId: alex.id, exerciseId: ex(name), weightKg: old, effectiveDate: tmOld, note: "Start of hypertrophy block" },
      { athleteId: alex.id, exerciseId: ex(name), weightKg: now, effectiveDate: tmNow, note: "Start of strength block" },
    ]);
  }

  // Per-exercise overrides: lb dumbbells; a custom ratio for Alex's SSB squat.
  await db.insert(s.athleteExerciseSettings).values([
    { athleteId: alex.id, exerciseId: ex("DB Row"), unit: "lb", rounding: 5 },
    { athleteId: alex.id, exerciseId: ex("DB Bench Press"), unit: "lb", rounding: 5 },
    { athleteId: alex.id, exerciseId: ex("SSB Squat"), tmRatio: 0.87 },
  ]);

  // Past maxes.
  await db.insert(s.manualRecords).values([
    { athleteId: alex.id, exerciseId: ex("Squat"), weightKg: 210, reps: 1, date: "2026-06-14", context: "meet", note: "Summer Open, 3rd attempt" },
    { athleteId: alex.id, exerciseId: ex("Bench Press"), weightKg: 137.5, reps: 1, date: "2026-06-14", context: "meet", note: "Summer Open, 2nd attempt" },
    { athleteId: alex.id, exerciseId: ex("Deadlift"), weightKg: 242.5, reps: 1, date: "2026-06-14", context: "meet", note: "Summer Open, 3rd attempt" },
    { athleteId: alex.id, exerciseId: ex("Squat"), weightKg: 180, reps: 5, rpe: 9, date: "2026-04-02", context: "gym", note: "" },
    { athleteId: alex.id, exerciseId: ex("Bench Press"), weightKg: 120, reps: 5, date: "2026-03-20", context: "gym", note: "" },
  ]);

  // Upcoming meet.
  const [meet] = await db
    .insert(s.meets)
    .values({ name: "Spring Classic", date: addDays(blockStart, 7 * 16 + 5), federation: "IPF", location: "" })
    .returning();
  await db.insert(s.meetEntries).values({ meetId: meet.id, athleteId: alex.id, weightClass: "83 kg", division: "Open" });

  // Program → block → weeks/days/slots/workouts/cells.
  const [program] = await db.insert(s.programs).values({ athleteId: alex.id, name: "Spring Classic prep" }).returning();
  const [block] = await db
    .insert(s.blocks)
    .values({ programId: program.id, position: 0, name: "Strength 1", kind: "strength", startDate: blockStart, notes: "Week 4 is a pivot/deload." })
    .returning();
  const weekRows = await db
    .insert(s.weeks)
    .values([0, 1, 2, 3].map((position) => ({ blockId: block.id, position })))
    .returning();

  interface PlannedCell {
    workoutId: string;
    date: string;
    plannedExerciseId: string;
    exerciseId: string;
    groups: { id: string; sg: SetGroup }[];
  }
  const byWorkout = new Map<string, PlannedCell[]>();
  const workoutDates: { id: string; date: string; week: number; day: number }[] = [];

  for (const [di, day] of BLOCK.entries()) {
    const [bd] = await db.insert(s.blockDays).values({ blockId: block.id, position: di, name: day.name, weekday: day.weekday }).returning();
    const slotRows = await db
      .insert(s.slots)
      .values(day.rows.map((_, position) => ({ blockDayId: bd.id, position })))
      .returning();
    for (const [wi, week] of weekRows.entries()) {
      const date = plannedDate(blockStart, wi, day.weekday);
      const [w] = await db.insert(s.workouts).values({ weekId: week.id, blockDayId: bd.id, plannedDate: date }).returning();
      workoutDates.push({ id: w.id, date, week: wi, day: di });
      const cells: PlannedCell[] = [];
      for (const [ri, row] of day.rows.entries()) {
        const cell = row.weeks[wi];
        if (cell === null) continue;
        const exName = typeof cell === "string" ? row.ex : cell.ex;
        const text = typeof cell === "string" ? cell : cell.rx;
        const [pe] = await db
          .insert(s.plannedExercises)
          .values({
            workoutId: w.id,
            slotId: slotRows[ri].id,
            exerciseId: ex(exName),
            position: ri,
            modifiers: row.mods ?? {},
            restSeconds: row.rest ?? null,
            notes: row.notes ?? "",
          })
          .returning();
        const groups = rx(text);
        const sgRows = await db
          .insert(s.setGroups)
          .values(groups.map((prescription, position) => ({ plannedExerciseId: pe.id, position, prescription })))
          .returning();
        cells.push({ workoutId: w.id, date, plannedExerciseId: pe.id, exerciseId: ex(exName), groups: sgRows.map((r) => ({ id: r.id, sg: r.prescription })) });
      }
      byWorkout.set(w.id, cells);
    }
  }

  // ---- Simulated logs for sessions before today ----
  const ctx = await loadAthleteContext(alex.id);
  const done = workoutDates.filter((w) => w.date < today);

  for (const w of done) {
    const cells = byWorkout.get(w.id)!;
    for (const cell of cells) {
      const name = [...exId.entries()].find(([, id]) => id === cell.exerciseId)![0];
      let performedExerciseId = cell.exerciseId;
      // A substitution: no leg press machine free in week 1.
      if (name === "Leg Press" && w.week === 0) performedExerciseId = ex("Belt Squat");

      const unit: Unit = ctx.unitFor(cell.exerciseId);
      const inc = ctx.incrementFor(cell.exerciseId, unit);
      const allGroups = cell.groups.map((g) => g.sg);
      let topSet: TopSetRef | null = null;
      let setIndex = 0;

      for (const [gi, g] of cell.groups.entries()) {
        const sg = g.sg;
        const sug = ctx.suggestGroups(cell.exerciseId, w.date, allGroups, { actualTopSet: topSet })[gi];
        const setCount = sg.mode === "repeatUntil" ? (sg.maxSets ?? 6) : sg.sets ? (rand() < 0.5 ? sg.sets.max : sg.sets.min) : 1;
        const targetRpe =
          sg.target?.kind === "rpe" ? pick([sg.target.min, sg.target.max]) : sg.target?.kind === "rir" ? 10 - pick([sg.target.min, sg.target.max]) : pick([7, 7.5, 8]);

        for (let k = 0; k < setCount; k++) {
          let weightKg = 0;
          if (sug) weightKg = roundLoad(sug.rounded.minKg + (sug.rounded.maxKg - sug.rounded.minKg) * pick([0, 0.5, 1]), unit, inc).kg;
          let reps = sg.reps === "amrap" ? 6 + Math.floor(rand() * 6) : pick([sg.reps.min, sg.reps.max]);
          let rpe: number | null = Math.min(10, targetRpe + (sg.mode === "repeatUntil" ? k * 0.5 : k === setCount - 1 ? pick([0, 0.5]) : 0));
          if (sg.reps === "amrap" && sg.amrapRpeCap) rpe = sg.amrapRpeCap;
          if (!sug && ACCESSORY_KG[name] !== undefined) weightKg = ACCESSORY_KG[name] + (k > 0 && rand() < 0.3 ? 2.5 : 0);
          if (performedExerciseId !== cell.exerciseId) weightKg = 100; // belt squat substitute
          if (["Triceps Pushdown", "Leg Curl"].includes(name)) rpe = null;

          // Deliberate deviations for the demo:
          if (name === "Close-Grip Bench Press" && w.week === 0 && k === 2) rpe = 8.5; // RPE above target
          if (name === "Squat" && w.week === 1 && w.day === 0 && sg.mode === "workUp") rpe = 9; // heavy top single
          if (name === "Squat" && w.week === 1 && w.day === 0 && isBackoff(sg) && k === 3) reps = 3; // missed rep
          if (name === "Deficit Deadlift" && w.week === 0 && k === 0) weightKg = 155; // over the bound

          const displayValue = roundLoad(weightKg, unit, unit === "lb" ? 0.1 : 0.01).value;
          const { snapshot, deviations } = evaluateLoggedSet({
            ctx,
            exerciseId: cell.exerciseId,
            date: w.date,
            setGroup: sg,
            groups: allGroups,
            groupIndex: gi,
            actualTopSet: topSet,
            set: { weightKg, reps, rpe },
          });
          await db.insert(s.loggedSets).values({
            workoutId: w.id,
            plannedExerciseId: cell.plannedExerciseId,
            setGroupId: g.id,
            exerciseId: performedExerciseId,
            setIndex: setIndex++,
            weightKg,
            weightEntered: displayValue,
            unitEntered: unit,
            reps,
            rpe,
            videoUrl: sg.mode === "workUp" && w.week === 1 ? "https://youtu.be/dQw4w9WgXcQ" : null,
            prescriptionSnapshot: snapshot,
            deviations,
            performedAt: new Date(`${w.date}T18:${String(10 + setIndex).padStart(2, "0")}:00Z`),
          });
          if (!isBackoff(sg)) topSet = { weightKg, reps, rpe };
          if (sg.mode === "repeatUntil" && rpe !== null && sg.repeatUntilRpe !== undefined && rpe >= sg.repeatUntilRpe) break;
        }
      }
    }

    // An unprescribed accessory the athlete added.
    if (w.week === 0 && w.day === 2) {
      for (let k = 0; k < 3; k++) {
        await db.insert(s.loggedSets).values({
          workoutId: w.id,
          exerciseId: ex("Face Pull"),
          setIndex: 100 + k,
          weightKg: 20,
          weightEntered: 20,
          unitEntered: "kg",
          reps: 15,
          isUnprescribed: true,
          performedAt: new Date(`${w.date}T19:00:00Z`),
        });
      }
    }

    await db
      .update(s.workouts)
      .set({ startedAt: new Date(`${w.date}T18:00:00Z`), completedAt: new Date(`${w.date}T19:30:00Z`) })
      .where(eq(s.workouts.id, w.id));
  }

  // Athlete notes / flags.
  const w2d1 = workoutDates.find((w) => w.week === 1 && w.day === 0);
  const w1d4 = workoutDates.find((w) => w.week === 0 && w.day === 3);
  const w1d2 = workoutDates.find((w) => w.week === 0 && w.day === 1);
  if (w2d1 && w2d1.date < today) {
    await db.insert(s.athleteNotes).values([
      { athleteId: alex.id, workoutId: w2d1.id, kind: "pain", body: "Left hip pinchy in the hole on the backoffs, ~3/10. Fine walking around after." },
      { athleteId: alex.id, workoutId: w2d1.id, kind: "missed_reps", body: "Lost the last rep on the 4th backoff set." },
    ]);
    await db.update(s.workouts).set({ athleteNotes: "Single moved fast but felt heavy. Slept 5h." }).where(eq(s.workouts.id, w2d1.id));
  }
  if (w1d4) await db.insert(s.athleteNotes).values({ athleteId: alex.id, workoutId: w1d4.id, kind: "note", body: "Leg press was taken, did belt squat instead.", readByCoachAt: new Date() });
  if (w1d2) await db.update(s.workouts).set({ athleteNotes: "Close grip got grindy on the last set." }).where(eq(s.workouts.id, w1d2.id));

  const [{ logged }] = await db.select({ logged: count() }).from(s.loggedSets);
  console.log(`Seeded ${LIBRARY.length} exercises, 2 athletes, 1 block (${workoutDates.length} sessions, ${done.length} logged, ${logged} sets).`);
  console.log(`Coach login:   ${coachEmail} / ${coachPassword}`);
  console.log(`Athlete login: athlete@example.com / changeme123`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
