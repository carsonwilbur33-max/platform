/**
 * Database side of the block editor: applies editor ops (src/lib/editor/ops.ts)
 * to the database, loads a block as editor state, and deep-copies blocks.
 *
 * Every function takes a db handle or open transaction so callers control the
 * transaction and tests can run against an in-memory database. Nothing here
 * imports the app's db singleton.
 */
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { blockDays, blocks, loggedSets, plannedExercises, setGroups, slots, weeks, workouts } from "@/db/schema";
import { parsePrescription } from "@/lib/calc/shorthand";
import { formatPrescription } from "@/lib/calc/shorthand";
import { plannedDate } from "@/lib/dates";
import type { CellContent, Op } from "@/lib/editor/ops";
import { cellKey, EditorError, workoutKey, type EdState } from "@/lib/editor/state";

function fail(msg: string): never {
  throw new EditorError(msg);
}

// ---------------------------------------------------------------------------
// Lookups scoped to one block (ops may only touch their own block)
// ---------------------------------------------------------------------------

async function dayInBlock(tx: Tx, blockId: string, dayId: string) {
  const [d] = await tx.select().from(blockDays).where(and(eq(blockDays.id, dayId), eq(blockDays.blockId, blockId)));
  return d ?? fail("That day isn't part of this block.");
}

async function weekInBlock(tx: Tx, blockId: string, weekId: string) {
  const [w] = await tx.select().from(weeks).where(and(eq(weeks.id, weekId), eq(weeks.blockId, blockId)));
  return w ?? fail("That week isn't part of this block.");
}

async function slotInBlock(tx: Tx, blockId: string, slotId: string) {
  const [row] = await tx
    .select({ slot: slots })
    .from(slots)
    .innerJoin(blockDays, eq(blockDays.id, slots.blockDayId))
    .where(and(eq(slots.id, slotId), eq(blockDays.blockId, blockId)));
  return row?.slot ?? fail("That row isn't part of this block.");
}

async function workoutFor(tx: Tx, weekId: string, dayId: string) {
  const [w] = await tx.select().from(workouts).where(and(eq(workouts.weekId, weekId), eq(workouts.blockDayId, dayId)));
  return w ?? fail("Session not found for that week and day.");
}

async function loggedCount(tx: Tx, workoutIds: string[]): Promise<number> {
  if (workoutIds.length === 0) return 0;
  const [{ n }] = await tx.select({ n: count() }).from(loggedSets).where(inArray(loggedSets.workoutId, workoutIds));
  const [{ c }] = await tx
    .select({ c: count() })
    .from(workouts)
    .where(and(inArray(workouts.id, workoutIds), sql`${workouts.completedAt} is not null`));
  return n + c;
}

/** Rewrite positions 0..n-1 in the given order. */
async function renumber(tx: Tx, table: typeof slots | typeof blockDays | typeof weeks, ids: string[]) {
  for (const [position, id] of ids.entries()) await tx.update(table).set({ position }).where(eq(table.id, id));
}

async function orderedSlotIds(tx: Tx, dayId: string): Promise<string[]> {
  const rows = await tx.select({ id: slots.id }).from(slots).where(eq(slots.blockDayId, dayId)).orderBy(asc(slots.position));
  return rows.map((r) => r.id);
}

/** Keep each planned exercise's position equal to its row's position (athlete-side ordering). */
async function syncExercisePositions(tx: Tx, dayId: string) {
  await tx.execute(sql`
    update ${plannedExercises} set position = ${slots.position}
    from ${slots}
    where ${plannedExercises.slotId} = ${slots.id} and ${slots.blockDayId} = ${dayId}`);
}

function insertId(ids: string[], index: number, id: string): string[] {
  const out = ids.filter((x) => x !== id);
  out.splice(Math.max(0, Math.min(index, out.length)), 0, id);
  return out;
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

async function writeCell(tx: Tx, blockId: string, slotId: string, weekId: string, cell: CellContent) {
  const slot = await slotInBlock(tx, blockId, slotId);
  await weekInBlock(tx, blockId, weekId);
  const workout = await workoutFor(tx, weekId, slot.blockDayId);
  const parsed = parsePrescription(cell.text);
  if (!parsed.ok) fail(`Can't save "${cell.text}": ${parsed.error}`);
  if (parsed.groups.length === 0) fail("A cell needs at least one set group.");

  // If a different planned exercise already occupies this cell (client out of sync), replace it.
  await tx
    .delete(plannedExercises)
    .where(and(eq(plannedExercises.slotId, slotId), eq(plannedExercises.workoutId, workout.id), sql`${plannedExercises.id} <> ${cell.id}`));

  const [existing] = await tx.select().from(plannedExercises).where(eq(plannedExercises.id, cell.id));
  if (existing && existing.workoutId !== workout.id) fail("That cell id belongs to another session.");
  const values = {
    exerciseId: cell.exerciseId,
    modifiers: cell.modifiers,
    restSeconds: cell.restSeconds,
    notes: cell.notes,
    unitOverride: cell.unitOverride,
    slotId,
    workoutId: workout.id,
    position: slot.position,
  };
  if (existing) await tx.update(plannedExercises).set(values).where(eq(plannedExercises.id, cell.id));
  else await tx.insert(plannedExercises).values({ id: cell.id, ...values });

  // Update set groups in place by position so logged sets stay linked to them.
  const current = await tx.select().from(setGroups).where(eq(setGroups.plannedExerciseId, cell.id)).orderBy(asc(setGroups.position));
  for (const [i, prescription] of parsed.groups.entries()) {
    const sg = current[i];
    if (sg) {
      if (JSON.stringify(sg.prescription) !== JSON.stringify(prescription) || sg.position !== i)
        await tx.update(setGroups).set({ prescription, position: i }).where(eq(setGroups.id, sg.id));
    } else {
      await tx.insert(setGroups).values({ plannedExerciseId: cell.id, position: i, prescription });
    }
  }
  const surplus = current.slice(parsed.groups.length).map((g) => g.id);
  if (surplus.length) await tx.delete(setGroups).where(inArray(setGroups.id, surplus));
}

async function clearCell(tx: Tx, blockId: string, slotId: string, weekId: string) {
  const slot = await slotInBlock(tx, blockId, slotId);
  await weekInBlock(tx, blockId, weekId);
  const workout = await workoutFor(tx, weekId, slot.blockDayId);
  await tx.delete(plannedExercises).where(and(eq(plannedExercises.slotId, slotId), eq(plannedExercises.workoutId, workout.id)));
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

async function applyOne(tx: Tx, blockId: string, op: Op): Promise<void> {
  switch (op.t) {
    case "setCell":
      return writeCell(tx, blockId, op.slotId, op.weekId, op.cell);
    case "clearCell":
      return clearCell(tx, blockId, op.slotId, op.weekId);
    case "addSlot": {
      await dayInBlock(tx, blockId, op.dayId);
      await tx.insert(slots).values({ id: op.slot.id, blockDayId: op.dayId, position: 9999, exerciseId: op.slot.exerciseId });
      await renumber(tx, slots, insertId(await orderedSlotIds(tx, op.dayId), op.index, op.slot.id));
      return syncExercisePositions(tx, op.dayId);
    }
    case "removeSlot": {
      const slot = await slotInBlock(tx, blockId, op.slotId);
      // Delete its cells explicitly (the FK would only null them out, leaving them in sessions).
      await tx.delete(plannedExercises).where(eq(plannedExercises.slotId, op.slotId));
      await tx.delete(slots).where(eq(slots.id, op.slotId));
      await renumber(tx, slots, await orderedSlotIds(tx, slot.blockDayId));
      return syncExercisePositions(tx, slot.blockDayId);
    }
    case "moveSlot": {
      const slot = await slotInBlock(tx, blockId, op.slotId);
      await dayInBlock(tx, blockId, op.dayId);
      if (op.dayId !== slot.blockDayId) {
        const cells = await tx.select().from(plannedExercises).where(eq(plannedExercises.slotId, op.slotId));
        const [{ n }] = cells.length
          ? await tx.select({ n: count() }).from(loggedSets).where(inArray(loggedSets.plannedExerciseId, cells.map((c) => c.id)))
          : [{ n: 0 }];
        if (n > 0) fail("This row has logged sets, so it can't move to another day. Copy it instead.");
        // Move each cell to the same week's session on the new day.
        for (const c of cells) {
          const [from] = await tx.select().from(workouts).where(eq(workouts.id, c.workoutId));
          const to = await workoutFor(tx, from.weekId, op.dayId);
          await tx.update(plannedExercises).set({ workoutId: to.id }).where(eq(plannedExercises.id, c.id));
        }
        await tx.update(slots).set({ blockDayId: op.dayId, position: 9999 }).where(eq(slots.id, op.slotId));
        await renumber(tx, slots, await orderedSlotIds(tx, slot.blockDayId));
        await syncExercisePositions(tx, slot.blockDayId);
      }
      await renumber(tx, slots, insertId(await orderedSlotIds(tx, op.dayId), op.index, op.slotId));
      return syncExercisePositions(tx, op.dayId);
    }
    case "setSlotExercise": {
      await slotInBlock(tx, blockId, op.slotId);
      await tx.update(slots).set({ exerciseId: op.exerciseId }).where(eq(slots.id, op.slotId));
      return;
    }
    case "addDay": {
      const blockWeeks = await tx.select().from(weeks).where(eq(weeks.blockId, blockId));
      for (const w of blockWeeks) if (!op.workoutIds[w.id]) fail("Missing a session id for one of the weeks.");
      await tx.insert(blockDays).values({ id: op.day.id, blockId, position: 9999, name: op.day.name, weekday: op.day.weekday });
      if (blockWeeks.length)
        await tx.insert(workouts).values(blockWeeks.map((w) => ({ id: op.workoutIds[w.id], weekId: w.id, blockDayId: op.day.id })));
      const ids = (await tx.select({ id: blockDays.id }).from(blockDays).where(eq(blockDays.blockId, blockId)).orderBy(asc(blockDays.position))).map((r) => r.id);
      return renumber(tx, blockDays, insertId(ids, op.index, op.day.id));
    }
    case "removeDay": {
      await dayInBlock(tx, blockId, op.dayId);
      const wos = await tx.select({ id: workouts.id }).from(workouts).where(eq(workouts.blockDayId, op.dayId));
      if ((await loggedCount(tx, wos.map((w) => w.id))) > 0)
        fail("This day has logged sessions and can't be deleted. Clear its exercises instead.");
      await tx.delete(blockDays).where(eq(blockDays.id, op.dayId));
      const ids = (await tx.select({ id: blockDays.id }).from(blockDays).where(eq(blockDays.blockId, blockId)).orderBy(asc(blockDays.position))).map((r) => r.id);
      return renumber(tx, blockDays, ids);
    }
    case "updateDay": {
      await dayInBlock(tx, blockId, op.dayId);
      await tx.update(blockDays).set({ name: op.name, weekday: op.weekday }).where(eq(blockDays.id, op.dayId));
      return;
    }
    case "moveDay": {
      await dayInBlock(tx, blockId, op.dayId);
      const ids = (await tx.select({ id: blockDays.id }).from(blockDays).where(eq(blockDays.blockId, blockId)).orderBy(asc(blockDays.position))).map((r) => r.id);
      return renumber(tx, blockDays, insertId(ids, op.index, op.dayId));
    }
    case "addWeek": {
      const days = await tx.select().from(blockDays).where(eq(blockDays.blockId, blockId));
      for (const d of days) if (!op.workoutIds[d.id]) fail("Missing a session id for one of the days.");
      await tx.insert(weeks).values({ id: op.week.id, blockId, position: 9999 });
      if (days.length) await tx.insert(workouts).values(days.map((d) => ({ id: op.workoutIds[d.id], weekId: op.week.id, blockDayId: d.id })));
      const ids = (await tx.select({ id: weeks.id }).from(weeks).where(eq(weeks.blockId, blockId)).orderBy(asc(weeks.position))).map((r) => r.id);
      return renumber(tx, weeks, insertId(ids, op.index, op.week.id));
    }
    case "removeWeek": {
      await weekInBlock(tx, blockId, op.weekId);
      const wos = await tx.select({ id: workouts.id }).from(workouts).where(eq(workouts.weekId, op.weekId));
      if ((await loggedCount(tx, wos.map((w) => w.id))) > 0)
        fail("This week has logged sessions and can't be deleted. Clear its cells instead.");
      await tx.delete(weeks).where(eq(weeks.id, op.weekId));
      const ids = (await tx.select({ id: weeks.id }).from(weeks).where(eq(weeks.blockId, blockId)).orderBy(asc(weeks.position))).map((r) => r.id);
      return renumber(tx, weeks, ids);
    }
  }
}

/** Planned dates follow start date, week position and weekday, except sessions already trained. */
export async function recomputeBlockDates(tx: Tx, blockId: string): Promise<void> {
  const [block] = await tx.select().from(blocks).where(eq(blocks.id, blockId));
  if (!block) return;
  const ws = await tx.select().from(weeks).where(eq(weeks.blockId, blockId)).orderBy(asc(weeks.position));
  const ds = await tx.select().from(blockDays).where(eq(blockDays.blockId, blockId));
  if (!ws.length || !ds.length) return;
  const wos = await tx.select().from(workouts).where(inArray(workouts.weekId, ws.map((w) => w.id)));
  const logged = await tx
    .select({ workoutId: loggedSets.workoutId, n: count() })
    .from(loggedSets)
    .where(inArray(loggedSets.workoutId, wos.map((w) => w.id)))
    .groupBy(loggedSets.workoutId);
  const hasLogs = new Set(logged.map((l) => l.workoutId));
  const weekIndex = new Map(ws.map((w, i) => [w.id, i]));
  const dayById = new Map(ds.map((d) => [d.id, d]));
  for (const wo of wos) {
    if (wo.completedAt || hasLogs.has(wo.id)) continue;
    const date = block.startDate ? plannedDate(block.startDate, weekIndex.get(wo.weekId)!, dayById.get(wo.blockDayId)?.weekday ?? null) : null;
    if (wo.plannedDate !== date) await tx.update(workouts).set({ plannedDate: date }).where(eq(workouts.id, wo.id));
  }
}

/** Apply editor ops to a block. Call inside a transaction: any failure must roll back the whole batch. */
export async function applyBlockOps(tx: Tx, blockId: string, ops: Op[]): Promise<void> {
  const [block] = await tx.select({ id: blocks.id }).from(blocks).where(eq(blocks.id, blockId));
  if (!block) fail("Block not found.");
  for (const op of ops) await applyOne(tx, blockId, op);
  await recomputeBlockDates(tx, blockId);
  await tx.update(blocks).set({ updatedAt: new Date() }).where(eq(blocks.id, blockId));
}

// ---------------------------------------------------------------------------
// Load a block as editor state
// ---------------------------------------------------------------------------

export async function loadEdState(tx: Tx, blockId: string): Promise<EdState | null> {
  const [block] = await tx.select().from(blocks).where(eq(blocks.id, blockId));
  if (!block) return null;
  const ws = await tx.select().from(weeks).where(eq(weeks.blockId, blockId)).orderBy(asc(weeks.position));
  const ds = await tx.select().from(blockDays).where(eq(blockDays.blockId, blockId)).orderBy(asc(blockDays.position));
  const dayIds = ds.map((d) => d.id);
  const ss = dayIds.length ? await tx.select().from(slots).where(inArray(slots.blockDayId, dayIds)).orderBy(asc(slots.position)) : [];
  const wos = dayIds.length ? await tx.select().from(workouts).where(inArray(workouts.blockDayId, dayIds)) : [];
  const woIds = wos.map((w) => w.id);
  const pes = woIds.length ? await tx.select().from(plannedExercises).where(inArray(plannedExercises.workoutId, woIds)) : [];
  const peIds = pes.map((p) => p.id);
  const sgs = peIds.length ? await tx.select().from(setGroups).where(inArray(setGroups.plannedExerciseId, peIds)).orderBy(asc(setGroups.position)) : [];
  const logsByWorkout = woIds.length
    ? await tx.select({ id: loggedSets.workoutId, n: count() }).from(loggedSets).where(inArray(loggedSets.workoutId, woIds)).groupBy(loggedSets.workoutId)
    : [];
  const logsByPe = peIds.length
    ? await tx
        .select({ id: loggedSets.plannedExerciseId, n: count() })
        .from(loggedSets)
        .where(inArray(loggedSets.plannedExerciseId, peIds))
        .groupBy(loggedSets.plannedExerciseId)
    : [];
  const woLogs = new Map(logsByWorkout.map((r) => [r.id, r.n]));
  const peLogs = new Map(logsByPe.map((r) => [r.id, r.n]));
  const woById = new Map(wos.map((w) => [w.id, w]));

  const state: EdState = {
    blockId,
    startDate: block.startDate,
    weeks: ws.map((w) => ({ id: w.id })),
    days: ds.map((d) => ({
      id: d.id,
      name: d.name,
      weekday: d.weekday,
      slots: ss.filter((s) => s.blockDayId === d.id).map((s) => ({ id: s.id, exerciseId: s.exerciseId })),
    })),
    cells: {},
    workouts: {},
  };
  for (const w of wos)
    state.workouts[workoutKey(w.blockDayId, w.weekId)] = {
      id: w.id,
      plannedDate: w.plannedDate,
      completed: !!w.completedAt,
      loggedSets: woLogs.get(w.id) ?? 0,
    };
  for (const pe of pes) {
    if (!pe.slotId) continue; // one-off additions outside the grid
    const wo = woById.get(pe.workoutId)!;
    const groups = sgs.filter((g) => g.plannedExerciseId === pe.id).map((g) => g.prescription);
    state.cells[cellKey(pe.slotId, wo.weekId)] = {
      id: pe.id,
      exerciseId: pe.exerciseId,
      text: formatPrescription(groups),
      modifiers: pe.modifiers,
      restSeconds: pe.restSeconds,
      notes: pe.notes,
      unitOverride: pe.unitOverride,
      loggedSets: peLogs.get(pe.id) ?? 0,
    };
  }
  return state;
}

// ---------------------------------------------------------------------------
// Creating and copying blocks
// ---------------------------------------------------------------------------

export interface NewBlockOptions {
  programId: string;
  name: string;
  kind?: (typeof blocks.$inferInsert)["kind"];
  startDate: string | null;
  notes?: string;
  /** Position within the program; defaults to the end. */
  position?: number;
}

async function nextBlockPosition(tx: Tx, programId: string): Promise<number> {
  const [{ max }] = await tx.select({ max: sql<number | null>`max(${blocks.position})` }).from(blocks).where(eq(blocks.programId, programId));
  return max === null ? 0 : Number(max) + 1;
}

/** An empty block with N weeks and the given days (one session per week × day). */
export async function createBlankBlock(
  tx: Tx,
  opts: NewBlockOptions & { weeks: number; days: { name: string; weekday: number | null }[] },
): Promise<string> {
  const [block] = await tx
    .insert(blocks)
    .values({
      programId: opts.programId,
      name: opts.name,
      kind: opts.kind ?? "other",
      startDate: opts.startDate,
      notes: opts.notes ?? "",
      position: opts.position ?? (await nextBlockPosition(tx, opts.programId)),
    })
    .returning();
  const ws = opts.weeks > 0 ? await tx.insert(weeks).values(Array.from({ length: opts.weeks }, (_, position) => ({ blockId: block.id, position }))).returning() : [];
  const ds = opts.days.length
    ? await tx.insert(blockDays).values(opts.days.map((d, position) => ({ blockId: block.id, position, name: d.name, weekday: d.weekday }))).returning()
    : [];
  const pairs = ws.flatMap((w) => ds.map((d) => ({ weekId: w.id, blockDayId: d.id })));
  if (pairs.length) await tx.insert(workouts).values(pairs);
  await recomputeBlockDates(tx, block.id);
  return block.id;
}

/**
 * Deep-copy a block's prescriptions (weeks, days, rows, cells, set groups) into
 * a program. Logged data, completion and dates are not copied; dates are
 * recomputed from the new start date. The copy is fully independent.
 */
export async function copyBlock(tx: Tx, srcBlockId: string, opts: NewBlockOptions): Promise<string> {
  const [src] = await tx.select().from(blocks).where(eq(blocks.id, srcBlockId));
  if (!src) fail("Source block not found.");
  const [block] = await tx
    .insert(blocks)
    .values({
      programId: opts.programId,
      name: opts.name,
      kind: opts.kind ?? src.kind,
      startDate: opts.startDate,
      notes: opts.notes ?? src.notes,
      position: opts.position ?? (await nextBlockPosition(tx, opts.programId)),
    })
    .returning();

  const srcWeeks = await tx.select().from(weeks).where(eq(weeks.blockId, srcBlockId)).orderBy(asc(weeks.position));
  const srcDays = await tx.select().from(blockDays).where(eq(blockDays.blockId, srcBlockId)).orderBy(asc(blockDays.position));
  const weekMap = new Map<string, string>();
  const dayMap = new Map<string, string>();
  const slotMap = new Map<string, string>();
  const workoutMap = new Map<string, string>();

  for (const w of srcWeeks) {
    const [nw] = await tx.insert(weeks).values({ blockId: block.id, position: w.position, notes: w.notes }).returning();
    weekMap.set(w.id, nw.id);
  }
  for (const d of srcDays) {
    const [nd] = await tx.insert(blockDays).values({ blockId: block.id, position: d.position, name: d.name, weekday: d.weekday }).returning();
    dayMap.set(d.id, nd.id);
    const srcSlots = await tx.select().from(slots).where(eq(slots.blockDayId, d.id));
    for (const s of srcSlots) {
      const [ns] = await tx.insert(slots).values({ blockDayId: nd.id, position: s.position, exerciseId: s.exerciseId }).returning();
      slotMap.set(s.id, ns.id);
    }
  }
  const srcWorkouts = srcDays.length ? await tx.select().from(workouts).where(inArray(workouts.blockDayId, srcDays.map((d) => d.id))) : [];
  for (const wo of srcWorkouts) {
    const [nwo] = await tx
      .insert(workouts)
      .values({ weekId: weekMap.get(wo.weekId)!, blockDayId: dayMap.get(wo.blockDayId)!, coachNotes: wo.coachNotes })
      .returning();
    workoutMap.set(wo.id, nwo.id);
  }
  const srcPes = srcWorkouts.length ? await tx.select().from(plannedExercises).where(inArray(plannedExercises.workoutId, srcWorkouts.map((w) => w.id))) : [];
  for (const pe of srcPes) {
    const [npe] = await tx
      .insert(plannedExercises)
      .values({
        workoutId: workoutMap.get(pe.workoutId)!,
        slotId: pe.slotId ? (slotMap.get(pe.slotId) ?? null) : null,
        exerciseId: pe.exerciseId,
        position: pe.position,
        modifiers: pe.modifiers,
        restSeconds: pe.restSeconds,
        notes: pe.notes,
        unitOverride: pe.unitOverride,
      })
      .returning();
    const sgs = await tx.select().from(setGroups).where(eq(setGroups.plannedExerciseId, pe.id));
    if (sgs.length) await tx.insert(setGroups).values(sgs.map((g) => ({ plannedExerciseId: npe.id, position: g.position, prescription: g.prescription })));
  }
  await recomputeBlockDates(tx, block.id);
  return block.id;
}

/** Number of weeks in a block (to place a duplicate right after it). */
export async function blockWeekCount(tx: Tx, blockId: string): Promise<number> {
  const [{ n }] = await tx.select({ n: count() }).from(weeks).where(eq(weeks.blockId, blockId));
  return n;
}
