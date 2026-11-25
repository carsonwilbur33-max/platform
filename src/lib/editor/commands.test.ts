import { randomUUID as uid } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildRows,
  clipToTsv,
  copyRange,
  opsBulkEdit,
  opsDuplicateDay,
  opsDuplicateWeek,
  opsFillRight,
  opsPaste,
  opsSetMeta,
  opsSetRowExercise,
  opsSetText,
  rangeCells,
  tsvToClip,
} from "./commands";
import { opsSchema } from "./ops";
import { applyOps, cellKey, recomputeDates, workoutKey, type EdState } from "./state";

const EX = { squat: uid(), bench: uid(), ssb: uid() };
const W = [uid(), uid(), uid()];
const D = [uid(), uid()];
const S = { sq: uid(), bp: uid(), empty: uid() };

function fixture(): EdState {
  const workouts: EdState["workouts"] = {};
  for (const d of D) for (const w of W) workouts[workoutKey(d, w)] = { id: uid(), plannedDate: null, completed: false, loggedSets: 0 };
  const meta = { modifiers: { pause: "1s" }, restSeconds: 180, notes: "brace", unitOverride: null };
  return recomputeDates({
    blockId: uid(),
    startDate: "2026-11-16",
    weeks: W.map((id) => ({ id })),
    days: [
      { id: D[0], name: "A", weekday: 0, slots: [{ id: S.sq, exerciseId: EX.squat }, { id: S.bp, exerciseId: EX.bench }] },
      { id: D[1], name: "B", weekday: 3, slots: [{ id: S.empty, exerciseId: null }] },
    ],
    cells: {
      [cellKey(S.sq, W[0])]: { id: uid(), exerciseId: EX.squat, text: "5x5 70%", ...meta, loggedSets: 0 },
      [cellKey(S.sq, W[1])]: { id: uid(), exerciseId: EX.ssb, text: "3x8 @7", ...meta, loggedSets: 0 },
      [cellKey(S.bp, W[0])]: { id: uid(), exerciseId: EX.bench, text: "4x6 72-77%", modifiers: {}, restSeconds: 120, notes: "", unitOverride: null, loggedSets: 0 },
    },
    workouts,
  });
}

const apply = (s: EdState, ops: ReturnType<typeof opsSetMeta>) => {
  expect(opsSchema.safeParse(ops.length ? ops : [{ t: "removeWeek", weekId: uid() }]).success).toBe(true);
  return applyOps(s, ops).state;
};

describe("grid commands", () => {
  it("rows include an add row per day", () => {
    expect(buildRows(fixture()).map((r) => r.kind)).toEqual(["slot", "slot", "add", "slot", "add"]);
    expect(buildRows(fixture(), new Set([D[1]]))).toHaveLength(2);
  });

  it("typing a prescription normalizes it and copies row meta into a new cell", () => {
    const s = fixture();
    const r = opsSetText(s, S.sq, W[2], "5 X 5 @ 8", uid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = apply(s, r.ops).cells[cellKey(S.sq, W[2])];
    expect(c.text).toBe("5x5 @8");
    expect(c.exerciseId).toBe(EX.squat);
    expect(c.modifiers).toEqual({ pause: "1s" });
    expect(c.restSeconds).toBe(180);
  });

  it("typing keeps the cell's swap; empty text clears; bad text errors; no-op is empty", () => {
    const s = fixture();
    const r = opsSetText(s, S.sq, W[1], "3x8 @7.5", uid);
    expect(r.ok && apply(s, r.ops).cells[cellKey(S.sq, W[1])].exerciseId).toBe(EX.ssb);
    expect(opsSetText(s, S.sq, W[0], "  ", uid)).toEqual({ ok: true, ops: [{ t: "clearCell", slotId: S.sq, weekId: W[0] }] });
    expect(opsSetText(s, S.sq, W[0], "5x5 banana", uid).ok).toBe(false);
    expect(opsSetText(s, S.sq, W[0], "5x5 70%", uid)).toEqual({ ok: true, ops: [] });
  });

  it("a row without an exercise asks for one first", () => {
    const r = opsSetText(fixture(), S.empty, W[0], "3x5", uid);
    expect(r.ok).toBe(false);
  });

  it("row-wide meta edits touch every filled cell in the row", () => {
    const s = fixture();
    const after = apply(s, opsSetMeta(s, S.sq, null, { restSeconds: 240 }));
    expect(after.cells[cellKey(S.sq, W[0])].restSeconds).toBe(240);
    expect(after.cells[cellKey(S.sq, W[1])].restSeconds).toBe(240);
    expect(after.cells[cellKey(S.bp, W[0])].restSeconds).toBe(120);
  });

  it("changing the row exercise moves non-swapped cells and keeps swaps", () => {
    const s = fixture();
    const after = apply(s, opsSetRowExercise(s, S.sq, EX.bench));
    expect(after.days[0].slots[0].exerciseId).toBe(EX.bench);
    expect(after.cells[cellKey(S.sq, W[0])].exerciseId).toBe(EX.bench);
    expect(after.cells[cellKey(S.sq, W[1])].exerciseId).toBe(EX.ssb);
  });

  it("copy → paste a range into another row keeps the target row's exercise and meta, but carries swaps", () => {
    const s = fixture();
    const rows = buildRows(s);
    const clip = copyRange(s, rangeCells(s, rows, { r0: 0, r1: 0, c0: 1, c1: 2 }));
    expect(clipToTsv(clip)).toBe("5x5 70%\t3x8 @7");
    const after = apply(s, opsPaste(s, rows, { r0: 1, r1: 1, c0: 1, c1: 1 }, clip, uid));
    const a = after.cells[cellKey(S.bp, W[0])];
    expect(a.text).toBe("5x5 70%");
    expect(a.exerciseId).toBe(EX.bench);
    expect(a.restSeconds).toBe(120); // target cell's own meta kept
    expect(after.cells[cellKey(S.bp, W[1])].exerciseId).toBe(EX.ssb); // the swap travels
  });

  it("a single copied cell fills the whole selection", () => {
    const s = fixture();
    const rows = buildRows(s);
    const clip = copyRange(s, rangeCells(s, rows, { r0: 0, r1: 0, c0: 1, c1: 1 }));
    const after = apply(s, opsPaste(s, rows, { r0: 0, r1: 1, c0: 2, c1: 3 }, clip, uid));
    for (const slot of [S.sq, S.bp]) for (const w of [W[1], W[2]]) expect(after.cells[cellKey(slot, w)].text).toBe("5x5 70%");
  });

  it("pasting plain text from a spreadsheet parses each cell and counts bad ones", () => {
    const { clip, invalid } = tsvToClip("5x5 75%\t5x5 77.5%\tnope\n3x8 @8\t\t\n");
    expect(invalid).toBe(1);
    const s = fixture();
    const after = apply(s, opsPaste(s, buildRows(s), { r0: 0, r1: 0, c0: 1, c1: 1 }, clip, uid));
    expect(after.cells[cellKey(S.sq, W[0])].text).toBe("5x5 75%");
    expect(after.cells[cellKey(S.sq, W[1])].text).toBe("5x5 77.5%");
    expect(after.cells[cellKey(S.sq, W[2])]).toBeUndefined();
    expect(after.cells[cellKey(S.bp, W[0])].text).toBe("3x8 @8");
    expect(after.cells[cellKey(S.bp, W[1])]).toBeUndefined(); // blank pasted over → cleared? (was empty already)
  });

  it("fill right copies the previous week into the cell, or the first selected week across", () => {
    const s = fixture();
    const rows = buildRows(s);
    let after = apply(s, opsFillRight(s, rows, { r0: 1, r1: 1, c0: 2, c1: 2 }, uid));
    expect(after.cells[cellKey(S.bp, W[1])].text).toBe("4x6 72-77%");
    after = apply(s, opsFillRight(s, rows, { r0: 1, r1: 1, c0: 1, c1: 3 }, uid));
    expect(after.cells[cellKey(S.bp, W[2])].text).toBe("4x6 72-77%");
  });

  it("bulk edit: +2.5% per week across a row", () => {
    const s = fixture();
    const rows = buildRows(s);
    let after = apply(s, opsFillRight(s, rows, { r0: 1, r1: 1, c0: 1, c1: 3 }, uid));
    after = apply(after, opsBulkEdit(after, rangeCells(after, rows, { r0: 1, r1: 1, c0: 1, c1: 3 }), { kind: "pct", amount: 2.5 }, true));
    expect(W.map((w) => after.cells[cellKey(S.bp, w)].text)).toEqual(["4x6 72-77%", "4x6 74.5-79.5%", "4x6 77-82%"]);
  });

  it("duplicate week inserts a copy after it with new ids", () => {
    const s = fixture();
    const after = apply(s, opsDuplicateWeek(s, W[0], uid));
    expect(after.weeks).toHaveLength(4);
    const copyWeek = after.weeks[1].id;
    expect(after.cells[cellKey(S.sq, copyWeek)].text).toBe("5x5 70%");
    expect(after.cells[cellKey(S.sq, copyWeek)].id).not.toBe(s.cells[cellKey(S.sq, W[0])].id);
    expect(after.workouts[workoutKey(D[0], W[1])].plannedDate).toBe("2026-11-30"); // later weeks shift
  });

  it("duplicate day copies rows and cells", () => {
    const s = fixture();
    const after = apply(s, opsDuplicateDay(s, D[0], uid));
    expect(after.days.map((d) => d.name)).toEqual(["A", "A (copy)", "B"]);
    const copy = after.days[1];
    expect(copy.slots.map((x) => x.exerciseId)).toEqual([EX.squat, EX.bench]);
    expect(after.cells[cellKey(copy.slots[0].id, W[1])].exerciseId).toBe(EX.ssb);
  });
});
