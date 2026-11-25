import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { randomUUID as uid } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db";
import * as schema from "@/db/schema";
import type { CellContent, Op } from "@/lib/editor/ops";
import { applyOps, cellKey, EditorError, workoutKey, type EdState } from "@/lib/editor/state";
import { applyBlockOps, copyBlock, createBlankBlock, loadEdState } from "./block-ops";

let db: Tx;
let EX: Record<string, string>;
let athleteId: string;
let programId: string;

beforeAll(async () => {
  const client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: "drizzle" });
  db = d as unknown as Tx;
  const exs = await db
    .insert(schema.exercises)
    .values(["Squat", "Bench Press", "Deadlift", "Barbell Row"].map((name) => ({ name, category: "other" as const })))
    .returning();
  EX = Object.fromEntries(exs.map((e) => [e.name, e.id]));
  const [a] = await db.insert(schema.athletes).values({ name: "Test" }).returning();
  athleteId = a.id;
  const [p] = await db.insert(schema.programs).values({ athleteId, name: "P" }).returning();
  programId = p.id;
}, 60_000);

function cell(text: string, exerciseId: string, extra: Partial<CellContent> = {}): CellContent {
  return { id: uid(), exerciseId, text, modifiers: {}, restSeconds: null, notes: "", unitOverride: null, ...extra };
}

async function newBlock() {
  return createBlankBlock(db, {
    programId,
    name: "B",
    kind: "strength",
    startDate: "2026-11-16",
    weeks: 2,
    days: [
      { name: "A", weekday: 0 },
      { name: "B", weekday: 3 },
    ],
  });
}

/** Apply ops to both the reducer and the DB; the reloaded DB must equal the reducer's state. */
async function step(state: EdState, ops: Op[]): Promise<EdState> {
  const expected = applyOps(state, ops).state;
  await db.transaction((tx) => applyBlockOps(tx as unknown as Tx, state.blockId, ops));
  const actual = await loadEdState(db, state.blockId);
  expect(actual).toEqual(expected);
  return expected;
}

describe("block ops against the database", () => {
  it("creates a blank block with sessions and dates", async () => {
    const s = (await loadEdState(db, await newBlock()))!;
    expect(s.weeks).toHaveLength(2);
    expect(s.days.map((d) => d.name)).toEqual(["A", "B"]);
    expect(s.workouts[workoutKey(s.days[1].id, s.weeks[1].id)].plannedDate).toBe("2026-11-26");
  });

  it("matches the reducer through a long sequence of edits, and undo restores it", async () => {
    let s = (await loadEdState(db, await newBlock()))!;
    const original = s;
    const [A, B] = s.days.map((d) => d.id);
    const [W1, W2] = s.weeks.map((w) => w.id);
    const sq = { id: uid(), exerciseId: EX.Squat };
    const bp = { id: uid(), exerciseId: EX["Bench Press"] };
    const history: { before: EdState; ops: Op[] }[] = [];
    const run = async (ops: Op[]) => {
      history.push({ before: s, ops });
      s = await step(s, ops);
    };

    await run([
      { t: "addSlot", dayId: A, index: 0, slot: sq },
      { t: "addSlot", dayId: A, index: 1, slot: bp },
      { t: "setCell", slotId: sq.id, weekId: W1, cell: cell("top 1 @8; 4x4 -10%", EX.Squat, { restSeconds: 240, modifiers: { pause: "1s" } }) },
      { t: "setCell", slotId: sq.id, weekId: W2, cell: cell("top 1 @8.5; 4x4 -10%", EX.Squat) },
      { t: "setCell", slotId: bp.id, weekId: W1, cell: cell("4x6 72-77%", EX["Bench Press"]) },
    ]);
    // edit text with fewer groups, swap exercise for one week
    await run([{ t: "setCell", slotId: sq.id, weekId: W2, cell: { ...s.cells[cellKey(sq.id, W2)], text: "3x3 85%", exerciseId: EX.Deadlift } }]);
    await run([{ t: "moveSlot", slotId: bp.id, dayId: A, index: 0 }]);
    await run([{ t: "moveSlot", slotId: bp.id, dayId: B, index: 0 }]);
    await run([{ t: "setSlotExercise", slotId: sq.id, exerciseId: EX.Deadlift }]);
    const extraWeek = { id: uid() };
    await run([{ t: "addWeek", index: 1, week: extraWeek, workoutIds: { [A]: uid(), [B]: uid() } }]);
    const C = uid();
    await run([{ t: "addDay", index: 0, day: { id: C, name: "C", weekday: 5 }, workoutIds: { [W1]: uid(), [extraWeek.id]: uid(), [W2]: uid() } }]);
    await run([{ t: "updateDay", dayId: A, name: "A2", weekday: 1 }]);
    await run([{ t: "moveDay", dayId: C, index: 2 }]);
    await run([{ t: "clearCell", slotId: sq.id, weekId: W1 }]);
    await run([{ t: "removeWeek", weekId: extraWeek.id }]);
    await run([{ t: "removeSlot", slotId: sq.id }]);
    await run([{ t: "removeDay", dayId: C }]);

    // Undo everything, step by step, against the DB.
    for (const h of history.reverse()) {
      const { inverse } = applyOps(h.before, h.ops);
      s = await step(s, inverse);
      expect(s).toEqual(h.before);
    }
    expect(s).toEqual(original);
  });

  it("keeps logged sets linked when a logged cell is edited, and refuses to delete logged days/weeks", async () => {
    let s = (await loadEdState(db, await newBlock()))!;
    const [A] = s.days.map((d) => d.id);
    const [W1] = s.weeks.map((w) => w.id);
    const row = { id: uid(), exerciseId: EX.Squat };
    const c = cell("top 1 @8; 4x4 -10%", EX.Squat);
    s = await step(s, [
      { t: "addSlot", dayId: A, index: 0, slot: row },
      { t: "setCell", slotId: row.id, weekId: W1, cell: c },
    ]);
    // athlete logs a set against the backoff group
    const [backoff] = await db.select().from(schema.setGroups).where(and(eq(schema.setGroups.plannedExerciseId, c.id), eq(schema.setGroups.position, 1)));
    const workoutId = s.workouts[workoutKey(A, W1)].id;
    await db.insert(schema.loggedSets).values({
      workoutId,
      plannedExerciseId: c.id,
      setGroupId: backoff.id,
      exerciseId: EX.Squat,
      setIndex: 1,
      weightKg: 170,
      weightEntered: 170,
      unitEntered: "kg",
      reps: 4,
    });
    s = (await loadEdState(db, s.blockId))!;
    expect(s.cells[cellKey(row.id, W1)].loggedSets).toBe(1);

    // coach edits the backoff percentage: same set group row, log still linked
    s = await step(s, [{ t: "setCell", slotId: row.id, weekId: W1, cell: { ...c, text: "top 1 @8; 4x4 -8%" } }]);
    const [after] = await db.select().from(schema.setGroups).where(eq(schema.setGroups.id, backoff.id));
    expect(after.prescription.target).toEqual({ kind: "drop", min: 8, max: 8 });
    const [log] = await db.select().from(schema.loggedSets).where(eq(schema.loggedSets.workoutId, workoutId));
    expect(log.setGroupId).toBe(backoff.id);

    // deleting the logged day / week is refused and the transaction rolls back
    await expect(db.transaction((tx) => applyBlockOps(tx as unknown as Tx, s.blockId, [{ t: "removeDay", dayId: A }]))).rejects.toThrow(EditorError);
    await expect(db.transaction((tx) => applyBlockOps(tx as unknown as Tx, s.blockId, [{ t: "removeWeek", weekId: W1 }]))).rejects.toThrow(EditorError);
    expect(await loadEdState(db, s.blockId)).toEqual(s);

    // a batch that fails part-way leaves nothing behind
    const ghost = { id: uid(), exerciseId: EX.Deadlift };
    await expect(
      db.transaction((tx) =>
        applyBlockOps(tx as unknown as Tx, s.blockId, [
          { t: "addSlot", dayId: A, index: 1, slot: ghost },
          { t: "removeWeek", weekId: W1 },
        ]),
      ),
    ).rejects.toThrow(EditorError);
    expect(await loadEdState(db, s.blockId)).toEqual(s);

    // a cell with an invalid prescription is rejected
    await expect(
      db.transaction((tx) => applyBlockOps(tx as unknown as Tx, s.blockId, [{ t: "setCell", slotId: row.id, weekId: W1, cell: { ...c, text: "3x5 banana" } }])),
    ).rejects.toThrow(/banana/);
  });

  it("refuses ops that reference another block", async () => {
    const a = (await loadEdState(db, await newBlock()))!;
    const b = (await loadEdState(db, await newBlock()))!;
    const slot = { id: uid(), exerciseId: EX.Squat };
    await expect(
      db.transaction((tx) => applyBlockOps(tx as unknown as Tx, a.blockId, [{ t: "addSlot", dayId: b.days[0].id, index: 0, slot }])),
    ).rejects.toThrow(EditorError);
  });

  it("copies a block independently, without logs, with new dates", async () => {
    let s = (await loadEdState(db, await newBlock()))!;
    const row = { id: uid(), exerciseId: EX.Squat };
    s = await step(s, [
      { t: "addSlot", dayId: s.days[0].id, index: 0, slot: row },
      { t: "setCell", slotId: row.id, weekId: s.weeks[0].id, cell: cell("5x5 70%", EX.Squat, { notes: "brace" }) },
      { t: "setCell", slotId: row.id, weekId: s.weeks[1].id, cell: cell("5x5 72.5%", EX.Squat) },
    ]);
    const [tpl] = await db.insert(schema.programs).values({ name: "Template", isTemplate: true }).returning();
    const copyId = await copyBlock(db, s.blockId, { programId: tpl.id, name: "Copy", startDate: null });
    const copy = (await loadEdState(db, copyId))!;
    expect(copy.days[0].slots[0].id).not.toBe(row.id);
    expect(Object.values(copy.cells).map((c) => c.text).sort()).toEqual(["5x5 70%", "5x5 72.5%"]);
    expect(Object.values(copy.cells).every((c) => c.loggedSets === 0)).toBe(true);
    expect(Object.values(copy.workouts).every((w) => w.plannedDate === null)).toBe(true);

    // editing the copy doesn't touch the original
    const k = cellKey(copy.days[0].slots[0].id, copy.weeks[0].id);
    await step(copy, [{ t: "setCell", slotId: copy.days[0].slots[0].id, weekId: copy.weeks[0].id, cell: { ...copy.cells[k], text: "3x3 80%" } }]);
    expect((await loadEdState(db, s.blockId))!.cells[cellKey(row.id, s.weeks[0].id)].text).toBe("5x5 70%");

    // assigning back to an athlete with a start date gives dated sessions
    const assigned = (await loadEdState(db, await copyBlock(db, copyId, { programId, name: "Assigned", startDate: "2027-01-04" })))!;
    expect(assigned.workouts[workoutKey(assigned.days[0].id, assigned.weeks[1].id)].plannedDate).toBe("2027-01-11");
  });
});
