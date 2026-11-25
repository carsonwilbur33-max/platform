import { randomUUID as uid } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CellContent, Op } from "./ops";
import { opsSchema } from "./ops";
import { applyOp, applyOps, cellKey, EditorError, recomputeDates, workoutKey, type EdState } from "./state";

const EX = { squat: uid(), bench: uid(), row: uid() };
const W = [uid(), uid(), uid()];
const D = [uid(), uid()];
const S = { sq: uid(), bp: uid(), row: uid() };

function cell(text: string, exerciseId = EX.squat): CellContent {
  return { id: uid(), exerciseId, text, modifiers: {}, restSeconds: 180, notes: "", unitOverride: null };
}

let base: EdState | null = null;
/** Same ids every call (cloned), so states from separate calls are comparable. */
function fixture(): EdState {
  base ??= build();
  return structuredClone(base);
}

function build(): EdState {
  const workouts: EdState["workouts"] = {};
  for (const d of D) for (const w of W) workouts[workoutKey(d, w)] = { id: uid(), plannedDate: null, completed: false, loggedSets: 0 };
  const s: EdState = {
    blockId: uid(),
    startDate: "2026-11-16",
    weeks: W.map((id) => ({ id })),
    days: [
      { id: D[0], name: "Squat day", weekday: 0, slots: [{ id: S.sq, exerciseId: EX.squat }, { id: S.bp, exerciseId: EX.bench }] },
      { id: D[1], name: "Pull day", weekday: 3, slots: [{ id: S.row, exerciseId: EX.row }] },
    ],
    cells: {
      [cellKey(S.sq, W[0])]: { ...cell("5x5 70%"), loggedSets: 5 },
      [cellKey(S.sq, W[1])]: { ...cell("5x5 72.5%"), loggedSets: 0 },
      [cellKey(S.bp, W[0])]: { ...cell("3x8 @8", EX.bench), loggedSets: 0 },
      [cellKey(S.row, W[2])]: { ...cell("3x10 rir2", EX.row), loggedSets: 0 },
    },
    workouts,
  };
  const dated = recomputeDates(s);
  // week 1 day 1 has been trained
  const k = workoutKey(D[0], W[0]);
  dated.workouts[k] = { ...dated.workouts[k], completed: true, loggedSets: 5 };
  return dated;
}

/** Apply ops, then their inverse: must return exactly the original state. */
function roundTrip(ops: Op[]) {
  const before = fixture();
  expect(opsSchema.safeParse(ops).success).toBe(true);
  const { state: after, inverse } = applyOps(before, ops);
  expect(after).not.toEqual(before);
  const { state: restored, inverse: redo } = applyOps(after, inverse);
  expect(restored).toEqual(before);
  // and redo reproduces the edit
  expect(applyOps(restored, redo).state).toEqual(after);
  return after;
}

describe("editor state", () => {
  it("computes planned dates from start, week and weekday", () => {
    const s = fixture();
    expect(s.workouts[workoutKey(D[0], W[1])].plannedDate).toBe("2026-11-23");
    expect(s.workouts[workoutKey(D[1], W[2])].plannedDate).toBe("2026-12-03");
  });

  it("setCell on an empty cell, and undo clears it", () => {
    const after = roundTrip([{ t: "setCell", slotId: S.bp, weekId: W[1], cell: cell("3x8 @8.5", EX.bench) }]);
    expect(after.cells[cellKey(S.bp, W[1])].text).toBe("3x8 @8.5");
  });

  it("editing a logged cell keeps its logged count and is undoable", () => {
    const existing = fixture().cells[cellKey(S.sq, W[0])];
    const after = roundTrip([{ t: "setCell", slotId: S.sq, weekId: W[0], cell: { ...existing, text: "5x5 71%" } }]);
    expect(after.cells[cellKey(S.sq, W[0])].loggedSets).toBe(5);
  });

  it("clearCell", () => {
    const after = roundTrip([{ t: "clearCell", slotId: S.sq, weekId: W[1] }]);
    expect(after.cells[cellKey(S.sq, W[1])]).toBeUndefined();
  });

  it("add, move and remove rows", () => {
    const slot = { id: uid(), exerciseId: EX.row };
    const after = roundTrip([{ t: "addSlot", dayId: D[0], index: 1, slot }]);
    expect(after.days[0].slots.map((s) => s.id)).toEqual([S.sq, slot.id, S.bp]);
    roundTrip([{ t: "moveSlot", slotId: S.bp, dayId: D[0], index: 0 }]);
    const moved = roundTrip([{ t: "moveSlot", slotId: S.bp, dayId: D[1], index: 1 }]);
    expect(moved.days[1].slots.map((s) => s.id)).toEqual([S.row, S.bp]);
    const removed = roundTrip([{ t: "removeSlot", slotId: S.bp }]);
    expect(removed.cells[cellKey(S.bp, W[0])]).toBeUndefined();
  });

  it("undoing removal of a logged row restores the row, but its logs stay unlinked", () => {
    const before = fixture();
    const { state: after, inverse } = applyOps(before, [{ t: "removeSlot", slotId: S.sq }]);
    const restored = applyOps(after, inverse).state;
    expect(restored.days).toEqual(before.days);
    expect(restored.cells[cellKey(S.sq, W[0])].text).toBe("5x5 70%");
    expect(restored.cells[cellKey(S.sq, W[0])].loggedSets).toBe(0); // server unlinks logs on delete
  });

  it("a logged row can be reordered within its day but not moved to another day", () => {
    expect(() => applyOp(fixture(), { t: "moveSlot", slotId: S.sq, dayId: D[1], index: 0 })).toThrow(EditorError);
    roundTrip([{ t: "moveSlot", slotId: S.sq, dayId: D[0], index: 1 }]);
  });

  it("set a row's exercise", () => {
    const after = roundTrip([{ t: "setSlotExercise", slotId: S.bp, exerciseId: EX.row }]);
    expect(after.days[0].slots[1].exerciseId).toBe(EX.row);
  });

  it("add a day creates a session per week with dates", () => {
    const id = uid();
    const workoutIds = Object.fromEntries(W.map((w) => [w, uid()]));
    const after = roundTrip([{ t: "addDay", index: 2, day: { id, name: "Extra", weekday: 5 }, workoutIds }]);
    expect(after.workouts[workoutKey(id, W[0])].plannedDate).toBe("2026-11-21");
  });

  it("remove an unlogged day restores rows and cells on undo", () => {
    const after = roundTrip([{ t: "removeDay", dayId: D[1] }]);
    expect(after.days).toHaveLength(1);
  });

  it("refuses to remove a day or week with logged sessions", () => {
    expect(() => applyOp(fixture(), { t: "removeDay", dayId: D[0] })).toThrow(EditorError);
    expect(() => applyOp(fixture(), { t: "removeWeek", weekId: W[0] })).toThrow(EditorError);
  });

  it("changing a day's weekday moves unlogged sessions but not trained ones", () => {
    const after = roundTrip([{ t: "updateDay", dayId: D[0], name: "Squat day", weekday: 1 }]);
    expect(after.workouts[workoutKey(D[0], W[0])].plannedDate).toBe("2026-11-16"); // trained: unchanged
    expect(after.workouts[workoutKey(D[0], W[1])].plannedDate).toBe("2026-11-24");
  });

  it("move a day", () => {
    const after = roundTrip([{ t: "moveDay", dayId: D[1], index: 0 }]);
    expect(after.days[0].id).toBe(D[1]);
  });

  it("insert a week in the middle shifts later unlogged dates", () => {
    const id = uid();
    const workoutIds = Object.fromEntries(D.map((d) => [d, uid()]));
    const after = roundTrip([{ t: "addWeek", index: 1, week: { id }, workoutIds }]);
    expect(after.weeks.map((w) => w.id)).toEqual([W[0], id, W[1], W[2]]);
    expect(after.workouts[workoutKey(D[0], W[1])].plannedDate).toBe("2026-11-30");
  });

  it("remove an unlogged week restores its cells on undo", () => {
    const after = roundTrip([{ t: "removeWeek", weekId: W[2] }]);
    expect(after.weeks).toHaveLength(2);
  });

  it("a mixed batch undoes as one step", () => {
    const slot = { id: uid(), exerciseId: EX.bench };
    roundTrip([
      { t: "addSlot", dayId: D[1], index: 0, slot },
      { t: "setCell", slotId: slot.id, weekId: W[0], cell: cell("3x5 @7", EX.bench) },
      { t: "setCell", slotId: slot.id, weekId: W[1], cell: cell("3x5 @7.5", EX.bench) },
      { t: "clearCell", slotId: S.sq, weekId: W[1] },
    ]);
  });

  it("rejects ops on rows or weeks that don't exist", () => {
    expect(() => applyOp(fixture(), { t: "setCell", slotId: uid(), weekId: W[0], cell: cell("3x5") })).toThrow(EditorError);
    expect(() => applyOp(fixture(), { t: "setCell", slotId: S.sq, weekId: uid(), cell: cell("3x5") })).toThrow(EditorError);
  });
});
