import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Deviation } from "@/lib/calc/deviation";
import type { E1rmFormula } from "@/lib/calc/e1rm";
import type { ExerciseModifiers, SetGroup } from "@/lib/calc/prescription";
import type { RpeChart } from "@/lib/calc/rpe-chart";
import type { PrescriptionSnapshot } from "@/lib/program/evaluate-set";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const roleEnum = pgEnum("role", ["coach", "athlete"]);
export const unitEnum = pgEnum("unit", ["kg", "lb"]);
export const formulaEnum = pgEnum("e1rm_formula", ["epley", "brzycki"]);
export const exerciseCategoryEnum = pgEnum("exercise_category", ["squat", "bench", "deadlift", "upper", "lower", "core", "other"]);
export const blockKindEnum = pgEnum("block_kind", ["hypertrophy", "strength", "peak", "pivot", "taper", "other"]);
export const noteKindEnum = pgEnum("note_kind", ["note", "pain", "missed_reps", "other"]);
export const recordContextEnum = pgEnum("record_context", ["gym", "meet"]);
export const liftEnum = pgEnum("lift", ["squat", "bench", "deadlift"]);
export const attemptResultEnum = pgEnum("attempt_result", ["good", "no_lift"]);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    /** SHA-256 of the session token; the raw token only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export const invites = pgTable("invites", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  athleteId: uuid("athlete_id")
    .notNull()
    .references(() => athletes.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Athletes, exercises, maxes
// ---------------------------------------------------------------------------

export const rpeCharts = pgTable("rpe_charts", {
  id: id(),
  name: text("name").notNull(),
  data: jsonb("data").$type<RpeChart>().notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const athletes = pgTable("athletes", {
  id: id(),
  /** Null until the athlete accepts their invite. */
  userId: uuid("user_id")
    .unique()
    .references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email"),
  unit: unitEnum("unit").notNull().default("kg"),
  roundingKg: doublePrecision("rounding_kg").notNull().default(2.5),
  roundingLb: doublePrecision("rounding_lb").notNull().default(5),
  bodyweightKg: doublePrecision("bodyweight_kg"),
  rpeChartId: uuid("rpe_chart_id").references(() => rpeCharts.id, { onDelete: "set null" }),
  e1rmFormula: formulaEnum("e1rm_formula").$type<E1rmFormula>().notNull().default("epley"),
  notes: text("notes").notNull().default(""),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const exercises = pgTable(
  "exercises",
  {
    id: id(),
    name: text("name").notNull(),
    category: exerciseCategoryEnum("category").notNull(),
    /** Variation of (e.g. Pause Squat → Squat). */
    parentId: uuid("parent_id").references((): AnyPgColumn => exercises.id, { onDelete: "set null" }),
    /** Default TM ratio to the parent lift (e.g. 0.9). Overridable per athlete. */
    defaultTmRatio: doublePrecision("default_tm_ratio"),
    isCustom: boolean("is_custom").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("exercises_name_uq").on(sql`lower(${t.name})`), index("exercises_parent_idx").on(t.parentId)],
);

export const athleteExerciseSettings = pgTable(
  "athlete_exercise_settings",
  {
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    /** Unit override, e.g. lb dumbbells for a kg athlete. */
    unit: unitEnum("unit"),
    /** Rounding increment override, in the effective unit. */
    rounding: doublePrecision("rounding"),
    /** TM ratio to the parent lift, overriding the exercise default. */
    tmRatio: doublePrecision("tm_ratio"),
  },
  (t) => [primaryKey({ columns: [t.athleteId, t.exerciseId] })],
);

export const trainingMaxes = pgTable(
  "training_maxes",
  {
    id: id(),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    weightKg: doublePrecision("weight_kg").notNull(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("training_maxes_lookup_idx").on(t.athleteId, t.exerciseId, t.effectiveDate)],
);

/** Past maxes / PRs entered by hand (pre-app history, meet results). */
export const manualRecords = pgTable(
  "manual_records",
  {
    id: id(),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    weightKg: doublePrecision("weight_kg").notNull(),
    reps: integer("reps").notNull().default(1),
    rpe: doublePrecision("rpe"),
    date: date("date", { mode: "string" }).notNull(),
    context: recordContextEnum("context").notNull().default("gym"),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("manual_records_athlete_idx").on(t.athleteId, t.date)],
);

// ---------------------------------------------------------------------------
// Programming (prescription)
// ---------------------------------------------------------------------------

export const programs = pgTable(
  "programs",
  {
    id: id(),
    /** Null for templates. */
    athleteId: uuid("athlete_id").references(() => athletes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isTemplate: boolean("is_template").notNull().default(false),
    sourceTemplateId: uuid("source_template_id"),
    notes: text("notes").notNull().default(""),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("programs_athlete_idx").on(t.athleteId)],
);

export const blocks = pgTable(
  "blocks",
  {
    id: id(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    kind: blockKindEnum("kind").notNull().default("other"),
    /** Monday (or whatever day) week 1 starts. Null in templates. */
    startDate: date("start_date", { mode: "string" }),
    notes: text("notes").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("blocks_program_idx").on(t.programId, t.position)],
);

export const weeks = pgTable(
  "weeks",
  {
    id: id(),
    blockId: uuid("block_id")
      .notNull()
      .references(() => blocks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    notes: text("notes").notNull().default(""),
  },
  (t) => [index("weeks_block_idx").on(t.blockId, t.position)],
);

/** "Day 1", "Day 2"… — a row group in the grid, shared across the block's weeks. */
export const blockDays = pgTable(
  "block_days",
  {
    id: id(),
    blockId: uuid("block_id")
      .notNull()
      .references(() => blocks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull().default(""),
    /** 0 = Monday … 6 = Sunday; used to compute planned dates. */
    weekday: integer("weekday"),
  },
  (t) => [index("block_days_block_idx").on(t.blockId, t.position)],
);

/** A grid row within a day. Cells are planned_exercises keyed by (slot, week). */
export const slots = pgTable(
  "slots",
  {
    id: id(),
    blockDayId: uuid("block_day_id")
      .notNull()
      .references(() => blockDays.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [index("slots_day_idx").on(t.blockDayId, t.position)],
);

/** A concrete training session: one block day in one week. */
export const workouts = pgTable(
  "workouts",
  {
    id: id(),
    weekId: uuid("week_id")
      .notNull()
      .references(() => weeks.id, { onDelete: "cascade" }),
    blockDayId: uuid("block_day_id")
      .notNull()
      .references(() => blockDays.id, { onDelete: "cascade" }),
    plannedDate: date("planned_date", { mode: "string" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    athleteNotes: text("athlete_notes").notNull().default(""),
    coachNotes: text("coach_notes").notNull().default(""),
  },
  (t) => [uniqueIndex("workouts_week_day_uq").on(t.weekId, t.blockDayId), index("workouts_date_idx").on(t.plannedDate)],
);

/** A grid cell: what exercise to do in this workout, in this row. */
export const plannedExercises = pgTable(
  "planned_exercises",
  {
    id: id(),
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    /** Null for one-off additions outside the grid rows. */
    slotId: uuid("slot_id").references(() => slots.id, { onDelete: "set null" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    modifiers: jsonb("modifiers").$type<ExerciseModifiers>().notNull().default({}),
    restSeconds: integer("rest_seconds"),
    notes: text("notes").notNull().default(""),
    unitOverride: unitEnum("unit_override"),
    updatedAt: updatedAt(),
  },
  (t) => [index("planned_exercises_workout_idx").on(t.workoutId, t.position), index("planned_exercises_slot_idx").on(t.slotId)],
);

export const setGroups = pgTable(
  "set_groups",
  {
    id: id(),
    plannedExerciseId: uuid("planned_exercise_id")
      .notNull()
      .references(() => plannedExercises.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    prescription: jsonb("prescription").$type<SetGroup>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [index("set_groups_pe_idx").on(t.plannedExerciseId, t.position)],
);

// ---------------------------------------------------------------------------
// Performance (what the athlete logged)
// ---------------------------------------------------------------------------

export const loggedSets = pgTable(
  "logged_sets",
  {
    id: id(),
    /** Restrict: a workout with logs can't be deleted out from under them. */
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "restrict" }),
    plannedExerciseId: uuid("planned_exercise_id").references(() => plannedExercises.id, { onDelete: "set null" }),
    setGroupId: uuid("set_group_id").references(() => setGroups.id, { onDelete: "set null" }),
    /** What was actually performed (differs from planned on substitution). */
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    setIndex: integer("set_index").notNull(),
    weightKg: doublePrecision("weight_kg").notNull(),
    /** Exactly what the athlete typed, so lb entries never drift. */
    weightEntered: doublePrecision("weight_entered").notNull(),
    unitEntered: unitEnum("unit_entered").notNull(),
    reps: integer("reps").notNull(),
    rpe: doublePrecision("rpe"),
    videoUrl: text("video_url"),
    notes: text("notes").notNull().default(""),
    prescriptionSnapshot: jsonb("prescription_snapshot").$type<PrescriptionSnapshot>(),
    deviations: jsonb("deviations").$type<Deviation[]>().notNull().default([]),
    isUnprescribed: boolean("is_unprescribed").notNull().default(false),
    performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("logged_sets_workout_idx").on(t.workoutId),
    index("logged_sets_set_group_idx").on(t.setGroupId),
    index("logged_sets_exercise_idx").on(t.exerciseId, t.performedAt),
  ],
);

export const athleteNotes = pgTable(
  "athlete_notes",
  {
    id: id(),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    workoutId: uuid("workout_id").references(() => workouts.id, { onDelete: "set null" }),
    loggedSetId: uuid("logged_set_id").references(() => loggedSets.id, { onDelete: "set null" }),
    kind: noteKindEnum("kind").notNull().default("note"),
    body: text("body").notNull(),
    readByCoachAt: timestamp("read_by_coach_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("athlete_notes_athlete_idx").on(t.athleteId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Meets
// ---------------------------------------------------------------------------

export const meets = pgTable("meets", {
  id: id(),
  name: text("name").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  federation: text("federation").notNull().default(""),
  location: text("location").notNull().default(""),
  createdAt: createdAt(),
});

export const meetEntries = pgTable(
  "meet_entries",
  {
    id: id(),
    meetId: uuid("meet_id")
      .notNull()
      .references(() => meets.id, { onDelete: "cascade" }),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    weightClass: text("weight_class").notNull().default(""),
    division: text("division").notNull().default(""),
    notes: text("notes").notNull().default(""),
  },
  (t) => [uniqueIndex("meet_entries_uq").on(t.meetId, t.athleteId)],
);

export const meetAttempts = pgTable(
  "meet_attempts",
  {
    id: id(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => meetEntries.id, { onDelete: "cascade" }),
    lift: liftEnum("lift").notNull(),
    attempt: integer("attempt").notNull(),
    plannedKg: doublePrecision("planned_kg"),
    actualKg: doublePrecision("actual_kg"),
    result: attemptResultEnum("result"),
  },
  (t) => [uniqueIndex("meet_attempts_uq").on(t.entryId, t.lift, t.attempt)],
);

// ---------------------------------------------------------------------------
// Relations (for db.query.*)
// ---------------------------------------------------------------------------

export const athletesRelations = relations(athletes, ({ one, many }) => ({
  user: one(users, { fields: [athletes.userId], references: [users.id] }),
  programs: many(programs),
  trainingMaxes: many(trainingMaxes),
  exerciseSettings: many(athleteExerciseSettings),
  rpeChart: one(rpeCharts, { fields: [athletes.rpeChartId], references: [rpeCharts.id] }),
}));

export const exercisesRelations = relations(exercises, ({ one }) => ({
  parent: one(exercises, { fields: [exercises.parentId], references: [exercises.id] }),
}));

export const trainingMaxesRelations = relations(trainingMaxes, ({ one }) => ({
  exercise: one(exercises, { fields: [trainingMaxes.exerciseId], references: [exercises.id] }),
}));

export const programsRelations = relations(programs, ({ one, many }) => ({
  athlete: one(athletes, { fields: [programs.athleteId], references: [athletes.id] }),
  blocks: many(blocks),
}));

export const blocksRelations = relations(blocks, ({ one, many }) => ({
  program: one(programs, { fields: [blocks.programId], references: [programs.id] }),
  weeks: many(weeks),
  days: many(blockDays),
}));

export const weeksRelations = relations(weeks, ({ one, many }) => ({
  block: one(blocks, { fields: [weeks.blockId], references: [blocks.id] }),
  workouts: many(workouts),
}));

export const blockDaysRelations = relations(blockDays, ({ one, many }) => ({
  block: one(blocks, { fields: [blockDays.blockId], references: [blocks.id] }),
  slots: many(slots),
  workouts: many(workouts),
}));

export const slotsRelations = relations(slots, ({ one }) => ({
  day: one(blockDays, { fields: [slots.blockDayId], references: [blockDays.id] }),
}));

export const workoutsRelations = relations(workouts, ({ one, many }) => ({
  week: one(weeks, { fields: [workouts.weekId], references: [weeks.id] }),
  day: one(blockDays, { fields: [workouts.blockDayId], references: [blockDays.id] }),
  exercises: many(plannedExercises),
  loggedSets: many(loggedSets),
}));

export const plannedExercisesRelations = relations(plannedExercises, ({ one, many }) => ({
  workout: one(workouts, { fields: [plannedExercises.workoutId], references: [workouts.id] }),
  slot: one(slots, { fields: [plannedExercises.slotId], references: [slots.id] }),
  exercise: one(exercises, { fields: [plannedExercises.exerciseId], references: [exercises.id] }),
  setGroups: many(setGroups),
}));

export const setGroupsRelations = relations(setGroups, ({ one, many }) => ({
  plannedExercise: one(plannedExercises, { fields: [setGroups.plannedExerciseId], references: [plannedExercises.id] }),
  loggedSets: many(loggedSets),
}));

export const loggedSetsRelations = relations(loggedSets, ({ one }) => ({
  workout: one(workouts, { fields: [loggedSets.workoutId], references: [workouts.id] }),
  setGroup: one(setGroups, { fields: [loggedSets.setGroupId], references: [setGroups.id] }),
  plannedExercise: one(plannedExercises, { fields: [loggedSets.plannedExerciseId], references: [plannedExercises.id] }),
  exercise: one(exercises, { fields: [loggedSets.exerciseId], references: [exercises.id] }),
}));

export const meetEntriesRelations = relations(meetEntries, ({ one, many }) => ({
  meet: one(meets, { fields: [meetEntries.meetId], references: [meets.id] }),
  athlete: one(athletes, { fields: [meetEntries.athleteId], references: [athletes.id] }),
  attempts: many(meetAttempts),
}));

export const meetAttemptsRelations = relations(meetAttempts, ({ one }) => ({
  entry: one(meetEntries, { fields: [meetAttempts.entryId], references: [meetEntries.id] }),
}));
