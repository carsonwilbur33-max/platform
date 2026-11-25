/**
 * Athlete logging: recording sets against the prescription, notes and flags,
 * and loading a session for the athlete's phone or the coach's review.
 *
 * Every athlete-facing function takes the signed-in athlete's id and checks
 * that the session belongs to them. Functions take a db handle or transaction
 * so tests can run against an in-memory database.
 */
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  athleteNotes,
  blockDays,
  blocks,
  exercises,
  loggedSets,
  plannedExercises,
  programs,
  setGroups,
  weeks,
  workouts,
} from "@/db/schema";
import type { Deviation } from "@/lib/calc/deviation";
import { findTopSetGroup } from "@/lib/calc/load";
import type { ExerciseModifiers, SetGroup } from "@/lib/calc/prescription";
import { formatPrescription, formatSetGroup } from "@/lib/calc/shorthand";
import { toKg, type Unit } from "@/lib/calc/units";
import { todayISO } from "@/lib/dates";
import { pickTopSet, type SessionRef } from "@/lib/logging/session";
import { normalizeVideoUrl } from "@/lib/logging/session";
import { evaluateLoggedSet, type PrescriptionSnapshot } from "@/lib/program/evaluate-set";
import { contextFromRows, loadCtxRows, type CtxRows } from "./athlete-context";

export class LoggingError extends Error {}
const fail = (msg: string): never => {
  throw new LoggingError(msg);
};

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/** The session with its day/week/block, if it belongs to this athlete (else throws). */
export async function sessionForAthlete(tx: Tx, athleteId: string, workoutId: string) {
  const [row] = await tx
    .select({ workout: workouts, day: blockDays, week: weeks, block: blocks, program: programs })
    .from(workouts)
    .innerJoin(blockDays, eq(blockDays.id, workouts.blockDayId))
    .innerJoin(weeks, eq(weeks.id, workouts.weekId))
    .innerJoin(blocks, eq(blocks.id, weeks.blockId))
    .innerJoin(programs, eq(programs.id, blocks.programId))
    .where(and(eq(workouts.id, workoutId), eq(programs.athleteId, athleteId)));
  return row ?? fail("Session not found.");
}

// ---------------------------------------------------------------------------
// Recording sets
// ---------------------------------------------------------------------------

export const logSetSchema = z.object({
  /** Client-generated, so retries and edits are idempotent. */
  id: z.string().uuid(),
  workoutId: z.string().uuid(),
  plannedExerciseId: z.string().uuid().nullable(),
  setGroupId: z.string().uuid().nullable(),
  /** What was actually performed (differs from the plan on a substitution). */
  exerciseId: z.string().uuid(),
  setIndex: z.number().int().min(0).max(999),
  weight: z.number().min(0).max(2000),
  unit: z.enum(["kg", "lb"]),
  reps: z.number().int().min(0).max(100),
  rpe: z
    .number()
    .min(1)
    .max(10)
    .refine((v) => Math.round(v * 2) === v * 2, "RPE goes in 0.5 steps.")
    .nullable(),
  videoUrl: z.string().max(500).nullable(),
  notes: z.string().max(2000),
});
export type LogSetInput = z.infer<typeof logSetSchema>;

export interface LoggedSetDTO {
  id: string;
  plannedExerciseId: string | null;
  setGroupId: string | null;
  exerciseId: string;
  setIndex: number;
  weightKg: number;
  weightEntered: number;
  unitEntered: Unit;
  reps: number;
  rpe: number | null;
  videoUrl: string | null;
  notes: string;
  deviations: Deviation[];
  isUnprescribed: boolean;
  /** What was prescribed when this set was logged (coach view compares it to the current plan). */
  snapshot: PrescriptionSnapshot | null;
}

function toDTO(r: typeof loggedSets.$inferSelect): LoggedSetDTO {
  return {
    id: r.id,
    plannedExerciseId: r.plannedExerciseId,
    setGroupId: r.setGroupId,
    exerciseId: r.exerciseId,
    setIndex: r.setIndex,
    weightKg: r.weightKg,
    weightEntered: r.weightEntered,
    unitEntered: r.unitEntered,
    reps: r.reps,
    rpe: r.rpe,
    videoUrl: r.videoUrl,
    notes: r.notes,
    deviations: r.deviations,
    isUnprescribed: r.isUnprescribed,
    snapshot: r.prescriptionSnapshot,
  };
}

/** Record (or correct) one set. Computes the prescription snapshot and deviation flags. */
export async function recordSet(tx: Tx, athleteId: string, raw: unknown): Promise<LoggedSetDTO> {
  const parsed = logSetSchema.safeParse(raw);
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? "Invalid set.");
  const input = parsed.data!;
  const { workout } = await sessionForAthlete(tx, athleteId, input.workoutId);

  const video = input.videoUrl ? normalizeVideoUrl(input.videoUrl) : null;
  if (video === "invalid") fail("That video link doesn't look like a web address.");
  const [ex] = await tx.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, input.exerciseId));
  if (!ex) fail("Unknown exercise.");

  const [existing] = await tx.select().from(loggedSets).where(eq(loggedSets.id, input.id));
  if (existing && existing.workoutId !== workout.id) fail("That set belongs to another session.");

  let pe: typeof plannedExercises.$inferSelect | undefined;
  if (input.plannedExerciseId) {
    [pe] = await tx
      .select()
      .from(plannedExercises)
      .where(and(eq(plannedExercises.id, input.plannedExerciseId), eq(plannedExercises.workoutId, workout.id)));
    if (!pe) fail("That exercise isn't part of this session.");
  }
  if (input.setGroupId && !pe) fail("A set group needs its exercise.");

  const weightKg = toKg(input.weight, input.unit);
  let snapshot: PrescriptionSnapshot | null = existing?.prescriptionSnapshot ?? null;
  let deviations: Deviation[] = [];

  if (pe && input.setGroupId) {
    const groups = await tx.select().from(setGroups).where(eq(setGroups.plannedExerciseId, pe.id)).orderBy(asc(setGroups.position));
    const gi = groups.findIndex((g) => g.id === input.setGroupId);
    if (gi < 0) fail("That set group isn't part of this exercise.");
    const prescriptions = groups.map((g) => g.prescription);
    // Compare against what was prescribed when the set was first logged.
    const sg = snapshot?.setGroup ?? prescriptions[gi];

    // Backoffs follow the heaviest set actually logged in the top-set group.
    const top = findTopSetGroup(prescriptions, gi);
    const topId = top ? groups[prescriptions.indexOf(top)].id : null;
    const topLogs = topId
      ? await tx
          .select()
          .from(loggedSets)
          .where(and(eq(loggedSets.setGroupId, topId), eq(loggedSets.workoutId, workout.id), sql`${loggedSets.id} <> ${input.id}`))
      : [];
    const ctx = contextFromRows(await loadCtxRows(athleteId, tx));
    const res = evaluateLoggedSet({
      ctx,
      exerciseId: pe.exerciseId,
      date: workout.plannedDate ?? todayISO(),
      setGroup: sg,
      groups: prescriptions.map((p, i) => (i === gi ? sg : p)),
      groupIndex: gi,
      unitOverride: pe.unitOverride,
      actualTopSet: pickTopSet(topLogs),
      set: { weightKg, reps: input.reps, rpe: input.rpe },
    });
    snapshot ??= res.snapshot;
    deviations = res.deviations;
    // A substituted exercise has different loads: only effort/reps flags still mean something.
    if (input.exerciseId !== pe.exerciseId) deviations = deviations.filter((d) => !d.kind.startsWith("load"));
  }

  const values = {
    workoutId: workout.id,
    plannedExerciseId: pe?.id ?? null,
    setGroupId: input.setGroupId,
    exerciseId: input.exerciseId,
    setIndex: input.setIndex,
    weightKg,
    weightEntered: input.weight,
    unitEntered: input.unit,
    reps: input.reps,
    rpe: input.rpe,
    videoUrl: video,
    notes: input.notes.trim(),
    prescriptionSnapshot: snapshot,
    deviations,
    isUnprescribed: !pe,
  };
  const [row] = existing
    ? await tx.update(loggedSets).set(values).where(eq(loggedSets.id, input.id)).returning()
    : await tx.insert(loggedSets).values({ id: input.id, ...values }).returning();
  if (!workout.startedAt) await tx.update(workouts).set({ startedAt: new Date() }).where(eq(workouts.id, workout.id));
  return toDTO(row);
}

export async function deleteSet(tx: Tx, athleteId: string, setId: string): Promise<void> {
  const [row] = await tx.select().from(loggedSets).where(eq(loggedSets.id, setId));
  if (!row) return;
  await sessionForAthlete(tx, athleteId, row.workoutId);
  await tx.delete(loggedSets).where(eq(loggedSets.id, setId));
}

// ---------------------------------------------------------------------------
// Notes, flags, completion
// ---------------------------------------------------------------------------

export const noteSchema = z.object({
  workoutId: z.string().uuid(),
  kind: z.enum(["note", "pain", "missed_reps", "other"]),
  body: z.string().trim().min(1, "Write something first.").max(2000),
  loggedSetId: z.string().uuid().nullable().default(null),
});

export interface NoteDTO {
  id: string;
  kind: "note" | "pain" | "missed_reps" | "other";
  body: string;
  loggedSetId: string | null;
  createdAt: string;
  readByCoach: boolean;
}

function noteDTO(n: typeof athleteNotes.$inferSelect): NoteDTO {
  return { id: n.id, kind: n.kind, body: n.body, loggedSetId: n.loggedSetId, createdAt: n.createdAt.toISOString(), readByCoach: !!n.readByCoachAt };
}

export async function addNote(tx: Tx, athleteId: string, raw: unknown): Promise<NoteDTO> {
  const p = noteSchema.safeParse(raw);
  if (!p.success) fail(p.error.issues[0]?.message ?? "Invalid note.");
  const v = p.data!;
  await sessionForAthlete(tx, athleteId, v.workoutId);
  if (v.loggedSetId) {
    const [s] = await tx.select().from(loggedSets).where(and(eq(loggedSets.id, v.loggedSetId), eq(loggedSets.workoutId, v.workoutId)));
    if (!s) fail("That set isn't part of this session.");
  }
  const [n] = await tx.insert(athleteNotes).values({ athleteId, workoutId: v.workoutId, kind: v.kind, body: v.body, loggedSetId: v.loggedSetId }).returning();
  return noteDTO(n);
}

export async function deleteNote(tx: Tx, athleteId: string, noteId: string): Promise<void> {
  await tx.delete(athleteNotes).where(and(eq(athleteNotes.id, noteId), eq(athleteNotes.athleteId, athleteId)));
}

export async function setSessionNotes(tx: Tx, athleteId: string, workoutId: string, text: string): Promise<void> {
  await sessionForAthlete(tx, athleteId, workoutId);
  await tx.update(workouts).set({ athleteNotes: text.slice(0, 5000) }).where(eq(workouts.id, workoutId));
}

export async function setSessionCompleted(tx: Tx, athleteId: string, workoutId: string, completed: boolean): Promise<void> {
  const { workout } = await sessionForAthlete(tx, athleteId, workoutId);
  await tx
    .update(workouts)
    .set({ completedAt: completed ? new Date() : null, startedAt: workout.startedAt ?? (completed ? new Date() : null) })
    .where(eq(workouts.id, workoutId));
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface SessionListItem extends SessionRef {
  blockId: string;
  blockName: string;
  weekNumber: number;
  dayNumber: number;
  dayName: string;
  loggedSets: number;
}

/** All of an athlete's sessions in program order (blocks by start date/position, then week, then day). */
export async function listSessions(tx: Tx, athleteId: string): Promise<SessionListItem[]> {
  const rows = await tx
    .select({
      id: workouts.id,
      plannedDate: workouts.plannedDate,
      completedAt: workouts.completedAt,
      startedAt: workouts.startedAt,
      blockId: blocks.id,
      blockName: blocks.name,
      blockStart: blocks.startDate,
      blockPos: blocks.position,
      programCreated: programs.createdAt,
      weekPos: weeks.position,
      dayPos: blockDays.position,
      dayName: blockDays.name,
    })
    .from(workouts)
    .innerJoin(weeks, eq(weeks.id, workouts.weekId))
    .innerJoin(blocks, eq(blocks.id, weeks.blockId))
    .innerJoin(programs, eq(programs.id, blocks.programId))
    .innerJoin(blockDays, eq(blockDays.id, workouts.blockDayId))
    .where(and(eq(programs.athleteId, athleteId), isNull(programs.archivedAt)));
  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await tx.select({ id: loggedSets.workoutId, n: count() }).from(loggedSets).where(inArray(loggedSets.workoutId, ids)).groupBy(loggedSets.workoutId)
    : [];
  const n = new Map(counts.map((c) => [c.id, c.n]));
  rows.sort(
    (a, b) =>
      (a.blockStart ?? "9999").localeCompare(b.blockStart ?? "9999") ||
      a.programCreated.getTime() - b.programCreated.getTime() ||
      a.blockPos - b.blockPos ||
      a.weekPos - b.weekPos ||
      a.dayPos - b.dayPos,
  );
  return rows.map((r) => ({
    id: r.id,
    plannedDate: r.plannedDate,
    completed: !!r.completedAt,
    inProgress: !r.completedAt && (!!r.startedAt || (n.get(r.id) ?? 0) > 0),
    blockId: r.blockId,
    blockName: r.blockName,
    weekNumber: r.weekPos + 1,
    dayNumber: r.dayPos + 1,
    dayName: r.dayName,
    loggedSets: n.get(r.id) ?? 0,
  }));
}

export interface SessionExercise {
  plannedExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  modifiers: ExerciseModifiers;
  restSeconds: number | null;
  notes: string;
  unitOverride: Unit | null;
  groups: { id: string; prescription: SetGroup; text: string }[];
}

export interface SessionData {
  workout: {
    id: string;
    plannedDate: string | null;
    completed: boolean;
    started: boolean;
    athleteNotes: string;
    dayName: string;
    dayNumber: number;
    weekNumber: number;
    blockId: string;
    blockName: string;
  };
  exercises: SessionExercise[];
  logged: LoggedSetDTO[];
  notes: NoteDTO[];
  ctx: CtxRows;
  /** id → name for every exercise (for substitutions and unprescribed sets). */
  names: Record<string, string>;
  /** Non-archived library, for swapping or adding exercises. */
  library: { id: string; name: string }[];
}

async function loadSession(tx: Tx, athleteId: string, workoutId: string): Promise<SessionData> {
  const { workout, day, week, block } = await sessionForAthlete(tx, athleteId, workoutId);
  const pes = await tx
    .select({ pe: plannedExercises, name: exercises.name })
    .from(plannedExercises)
    .innerJoin(exercises, eq(exercises.id, plannedExercises.exerciseId))
    .where(eq(plannedExercises.workoutId, workoutId))
    .orderBy(asc(plannedExercises.position));
  const sgs = pes.length
    ? await tx.select().from(setGroups).where(inArray(setGroups.plannedExerciseId, pes.map((p) => p.pe.id))).orderBy(asc(setGroups.position))
    : [];
  const logged = await tx.select().from(loggedSets).where(eq(loggedSets.workoutId, workoutId)).orderBy(asc(loggedSets.performedAt));
  const notes = await tx.select().from(athleteNotes).where(eq(athleteNotes.workoutId, workoutId)).orderBy(asc(athleteNotes.createdAt));
  const lib = await tx.select({ id: exercises.id, name: exercises.name, archivedAt: exercises.archivedAt }).from(exercises).orderBy(asc(exercises.name));
  return {
    workout: {
      id: workout.id,
      plannedDate: workout.plannedDate,
      completed: !!workout.completedAt,
      started: !!workout.startedAt,
      athleteNotes: workout.athleteNotes,
      dayName: day.name,
      dayNumber: day.position + 1,
      weekNumber: week.position + 1,
      blockId: block.id,
      blockName: block.name,
    },
    exercises: pes.map(({ pe, name }) => ({
      plannedExerciseId: pe.id,
      exerciseId: pe.exerciseId,
      exerciseName: name,
      modifiers: pe.modifiers,
      restSeconds: pe.restSeconds,
      notes: pe.notes,
      unitOverride: pe.unitOverride,
      groups: sgs.filter((g) => g.plannedExerciseId === pe.id).map((g) => ({ id: g.id, prescription: g.prescription, text: formatSetGroup(g.prescription) })),
    })),
    logged: logged.map(toDTO),
    notes: notes.map(noteDTO),
    ctx: await loadCtxRows(athleteId, tx),
    names: Object.fromEntries(lib.map((e) => [e.id, e.name])),
    library: lib.filter((e) => !e.archivedAt).map((e) => ({ id: e.id, name: e.name })),
  };
}

/** A session for the athlete's phone (only their own). */
export async function loadSessionForAthlete(tx: Tx, athleteId: string, workoutId: string): Promise<SessionData> {
  return loadSession(tx, athleteId, workoutId);
}

export interface CoachSessionData extends SessionData {
  athlete: { id: string; name: string };
  /** Set ids whose prescription changed after they were logged. */
  editedAfterLogging: string[];
}

/** A session for the coach: same data plus which logged sets were prescribed differently than the plan says now. */
export async function loadSessionForCoach(tx: Tx, workoutId: string): Promise<CoachSessionData | null> {
  const [row] = await tx
    .select({ athleteId: programs.athleteId })
    .from(workouts)
    .innerJoin(weeks, eq(weeks.id, workouts.weekId))
    .innerJoin(blocks, eq(blocks.id, weeks.blockId))
    .innerJoin(programs, eq(programs.id, blocks.programId))
    .where(eq(workouts.id, workoutId));
  if (!row?.athleteId) return null;
  const data = await loadSession(tx, row.athleteId, workoutId);
  const current = new Map(data.exercises.flatMap((e) => e.groups.map((g) => [g.id, formatSetGroup(g.prescription)] as const)));
  const editedAfterLogging = data.logged
    .filter((l) => l.setGroupId && l.snapshot && current.has(l.setGroupId) && formatSetGroup(l.snapshot.setGroup) !== current.get(l.setGroupId))
    .map((l) => l.id);
  const a = await tx.query.athletes.findFirst({ where: (t, { eq }) => eq(t.id, row.athleteId!) });
  return { ...data, athlete: { id: a!.id, name: a!.name }, editedAfterLogging };
}

export async function markSessionNotesRead(tx: Tx, workoutId: string): Promise<void> {
  await tx.update(athleteNotes).set({ readByCoachAt: new Date() }).where(and(eq(athleteNotes.workoutId, workoutId), isNull(athleteNotes.readByCoachAt)));
}

/** Prescription text for a planned exercise, for summaries. */
export function prescriptionText(e: SessionExercise): string {
  return formatPrescription(e.groups.map((g) => g.prescription));
}

export interface RecentSession {
  id: string;
  plannedDate: string | null;
  dayName: string;
  blockName: string;
  weekNumber: number;
  completed: boolean;
  loggedSets: number;
  flaggedSets: number;
  unreadNotes: number;
  painNotes: number;
}

/** The athlete's most recent sessions with anything logged, newest first, with flag counts. */
export async function recentSessionsForCoach(tx: Tx, athleteId: string, limit = 8): Promise<RecentSession[]> {
  const sessions = (await listSessions(tx, athleteId)).filter((s) => s.loggedSets > 0 || s.completed);
  const recent = sessions.slice(-limit).reverse();
  const ids = recent.map((s) => s.id);
  if (!ids.length) return [];
  const flagged = await tx
    .select({ id: loggedSets.workoutId, n: count() })
    .from(loggedSets)
    .where(and(inArray(loggedSets.workoutId, ids), sql`jsonb_array_length(${loggedSets.deviations}) > 0`))
    .groupBy(loggedSets.workoutId);
  const notes = await tx
    .select({ id: athleteNotes.workoutId, kind: athleteNotes.kind, read: athleteNotes.readByCoachAt })
    .from(athleteNotes)
    .where(inArray(athleteNotes.workoutId, ids));
  const f = new Map(flagged.map((r) => [r.id, r.n]));
  return recent.map((s) => ({
    id: s.id,
    plannedDate: s.plannedDate,
    dayName: s.dayName,
    blockName: s.blockName,
    weekNumber: s.weekNumber,
    completed: s.completed,
    loggedSets: s.loggedSets,
    flaggedSets: f.get(s.id) ?? 0,
    unreadNotes: notes.filter((n) => n.id === s.id && !n.read).length,
    painNotes: notes.filter((n) => n.id === s.id && n.kind === "pain").length,
  }));
}
