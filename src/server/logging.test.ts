import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { randomUUID as uid } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db";
import * as schema from "@/db/schema";
import { pickTodaySession } from "@/lib/logging/session";
import { cellKey } from "@/lib/editor/state";
import { applyBlockOps, createBlankBlock, loadEdState } from "./block-ops";
import {
  addNote,
  deleteSet,
  listSessions,
  loadSessionForAthlete,
  loadSessionForCoach,
  LoggingError,
  markSessionNotesRead,
  recordSet,
  setSessionCompleted,
} from "./logging";

let db: Tx;
let A: string; // athlete with the program
let B: string; // another athlete
let SQ: string;
let BELT: string;
let workoutId: string;
let secondWorkoutId: string;
let pe: { id: string; top: string; backoff: string };

beforeAll(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "drizzle" });
  db = d as unknown as Tx;
  const exs = await db.insert(schema.exercises).values([{ name: "Squat", category: "squat" }, { name: "Belt Squat", category: "lower" }]).returning();
  [SQ, BELT] = exs.map((e) => e.id);
  const [a, b] = await db.insert(schema.athletes).values([{ name: "A" }, { name: "B" }]).returning();
  A = a.id;
  B = b.id;
  await db.insert(schema.trainingMaxes).values({ athleteId: A, exerciseId: SQ, weightKg: 200, effectiveDate: "2026-01-01" });
  const [prog] = await db.insert(schema.programs).values({ athleteId: A, name: "P" }).returning();
  const blockId = await createBlankBlock(db, { programId: prog.id, name: "B1", startDate: "2026-11-16", weeks: 1, days: [{ name: "Squat", weekday: 0 }, { name: "Light", weekday: 2 }] });
  let s = (await loadEdState(db, blockId))!;
  const slot = uid();
  const cellId = uid();
  await applyBlockOps(db, blockId, [
    { t: "addSlot", dayId: s.days[0].id, index: 0, slot: { id: slot, exerciseId: SQ } },
    { t: "setCell", slotId: slot, weekId: s.weeks[0].id, cell: { id: cellId, exerciseId: SQ, text: "top 1 @8; 4x4 -10%", modifiers: {}, restSeconds: null, notes: "", unitOverride: null } },
  ]);
  s = (await loadEdState(db, blockId))!;
  workoutId = s.workouts[`${s.days[0].id}:${s.weeks[0].id}`].id;
  secondWorkoutId = s.workouts[`${s.days[1].id}:${s.weeks[0].id}`].id;
  const groups = await db.select().from(schema.setGroups).orderBy(schema.setGroups.position);
  pe = { id: s.cells[cellKey(slot, s.weeks[0].id)].id, top: groups[0].id, backoff: groups[1].id };
}, 60_000);

const set = (over: Record<string, unknown>) => ({
  id: uid(),
  workoutId,
  plannedExerciseId: pe.id,
  setGroupId: pe.top,
  exerciseId: SQ,
  setIndex: 0,
  weight: 185,
  unit: "kg",
  reps: 1,
  rpe: 8,
  videoUrl: null,
  notes: "",
  ...over,
});

describe("logging", () => {
  it("records a top set with a snapshot of what was prescribed and flags RPE above target", async () => {
    const r = await recordSet(db, A, set({ weight: 190, rpe: 8.5 }));
    expect(r.snapshot?.setGroup.mode).toBe("workUp");
    expect(r.snapshot?.tmKg).toBe(200);
    expect(r.snapshot?.suggestedMinKg).toBe(185); // 92.2% of 200, rounded
    expect(r.deviations.map((d) => d.kind)).toEqual(["rpe_high"]);
    const [w] = await db.select().from(schema.workouts).where(eq(schema.workouts.id, workoutId));
    expect(w.startedAt).not.toBeNull();
  });

  it("backoffs are judged against the actual top set (190 → −10% = 171 → 170)", async () => {
    const ok = await recordSet(db, A, set({ setGroupId: pe.backoff, weight: 170, reps: 4, rpe: 8 }));
    expect(ok.snapshot?.suggestedMinKg).toBe(170);
    expect(ok.deviations).toEqual([]);
    const heavy = await recordSet(db, A, set({ setGroupId: pe.backoff, setIndex: 1, weight: 180, reps: 4, rpe: 8 }));
    expect(heavy.deviations.map((d) => d.kind)).toEqual(["load_high"]);
    const missed = await recordSet(db, A, set({ setGroupId: pe.backoff, setIndex: 2, weight: 170, reps: 3, rpe: 9 }));
    expect(missed.deviations.map((d) => d.kind)).toEqual(["reps_low"]);
  });

  it("entering in lb stores exactly what was typed plus canonical kg", async () => {
    const r = await recordSet(db, A, set({ setGroupId: pe.backoff, setIndex: 3, weight: 375, unit: "lb", reps: 4, rpe: 8 }));
    expect(r.weightEntered).toBe(375);
    expect(r.unitEntered).toBe("lb");
    expect(r.weightKg).toBeCloseTo(170.097, 3);
    expect(r.deviations).toEqual([]);
  });

  it("an athlete can't touch another athlete's session or sets", async () => {
    await expect(recordSet(db, B, set({}))).rejects.toThrow(LoggingError);
    await expect(loadSessionForAthlete(db, B, workoutId)).rejects.toThrow(LoggingError);
    await expect(addNote(db, B, { workoutId, kind: "note", body: "hi" })).rejects.toThrow(LoggingError);
    const mine = await recordSet(db, A, set({ setIndex: 5 }));
    await expect(deleteSet(db, B, mine.id)).rejects.toThrow(LoggingError);
    await deleteSet(db, A, mine.id);
    expect((await loadSessionForAthlete(db, A, workoutId)).logged.find((l) => l.id === mine.id)).toBeUndefined();
  });

  it("rejects sets aimed at another session's exercise and bad video links; normalizes good ones", async () => {
    await expect(recordSet(db, A, set({ workoutId: secondWorkoutId }))).rejects.toThrow(/isn't part of this session/);
    await expect(recordSet(db, A, set({ videoUrl: "javascript:alert(1)" }))).rejects.toThrow(/web address/);
    const r = await recordSet(db, A, set({ setIndex: 6, videoUrl: "youtu.be/abc" }));
    expect(r.videoUrl).toBe("https://youtu.be/abc");
    await deleteSet(db, A, r.id);
  });

  it("editing a logged set keeps its original snapshot; coach sees sets prescribed differently than the plan now", async () => {
    const data = await loadSessionForAthlete(db, A, workoutId);
    const first = data.logged.find((l) => l.setGroupId === pe.backoff && l.setIndex === 0)!;
    // coach changes the backoff to -8% after the athlete logged
    await db.update(schema.setGroups).set({ prescription: { ...data.exercises[0].groups[1].prescription, target: { kind: "drop", min: 8, max: 8 } } }).where(eq(schema.setGroups.id, pe.backoff));
    const edited = await recordSet(db, A, set({ id: first.id, setGroupId: pe.backoff, weight: 172.5, reps: 4, rpe: 8 }));
    expect(edited.snapshot?.setGroup.target).toEqual({ kind: "drop", min: 10, max: 10 }); // still the -10% it was logged against
    const coach = (await loadSessionForCoach(db, workoutId))!;
    expect(coach.athlete.name).toBe("A");
    expect(coach.editedAfterLogging).toContain(first.id);
    expect(coach.editedAfterLogging).not.toContain(data.logged.find((l) => l.setGroupId === pe.top)!.id);
  });

  it("a substitution keeps effort/rep flags but drops load flags", async () => {
    const r = await recordSet(db, A, set({ exerciseId: BELT, setGroupId: pe.backoff, setIndex: 7, weight: 300, reps: 4, rpe: 9.5 }));
    expect(r.exerciseId).toBe(BELT);
    expect(r.deviations.some((d) => d.kind.startsWith("load"))).toBe(false);
  });

  it("unprescribed exercises and athlete notes/flags", async () => {
    const extra = await recordSet(db, A, set({ plannedExerciseId: null, setGroupId: null, exerciseId: BELT, weight: 100, reps: 12, rpe: null }));
    expect(extra.isUnprescribed).toBe(true);
    expect(extra.deviations).toEqual([]);
    const note = await addNote(db, A, { workoutId, kind: "pain", body: "Left hip 3/10", loggedSetId: extra.id });
    expect(note.readByCoach).toBe(false);
    await expect(addNote(db, A, { workoutId, kind: "pain", body: "  " })).rejects.toThrow(LoggingError);
    await markSessionNotesRead(db, workoutId);
    expect((await loadSessionForAthlete(db, A, workoutId)).notes[0].readByCoach).toBe(true);
  });

  it("sessions list in program order and 'today' moves on after completing", async () => {
    let list = await listSessions(db, A);
    expect(list.map((s) => s.dayName)).toEqual(["Squat", "Light"]);
    expect(pickTodaySession(list)?.id).toBe(workoutId); // in progress
    await setSessionCompleted(db, A, workoutId, true);
    list = await listSessions(db, A);
    expect(list[0].completed).toBe(true);
    expect(pickTodaySession(list)?.id).toBe(secondWorkoutId);
    expect(await listSessions(db, B)).toEqual([]);
  });
});
