/**
 * Block editor state and a pure reducer for editor operations, with inverses
 * for undo/redo. Shared by the client (optimistic updates) and tests; the
 * server applies the same ops to the database (src/server/block-ops.ts).
 */
import { plannedDate } from "@/lib/dates";
import type { CellContent, Op, SlotContent } from "./ops";

export interface EdCell extends CellContent {
  /** Sets the athlete has logged against this cell (read-only). */
  loggedSets: number;
}
export type EdSlot = SlotContent;
export interface EdDay {
  id: string;
  name: string;
  weekday: number | null;
  slots: EdSlot[];
}
export interface EdWeek {
  id: string;
}
export interface EdWorkout {
  id: string;
  plannedDate: string | null;
  completed: boolean;
  loggedSets: number;
}
export interface EdState {
  blockId: string;
  startDate: string | null;
  weeks: EdWeek[];
  days: EdDay[];
  /** Keyed by cellKey(slotId, weekId). */
  cells: Record<string, EdCell>;
  /** Keyed by workoutKey(dayId, weekId). */
  workouts: Record<string, EdWorkout>;
}

export const cellKey = (slotId: string, weekId: string) => `${slotId}:${weekId}`;
export const workoutKey = (dayId: string, weekId: string) => `${dayId}:${weekId}`;

export class EditorError extends Error {}

function fail(msg: string): never {
  throw new EditorError(msg);
}

export function findSlot(state: EdState, slotId: string): { day: EdDay; dayIndex: number; index: number; slot: EdSlot } | null {
  for (const [dayIndex, day] of state.days.entries()) {
    const index = day.slots.findIndex((s) => s.id === slotId);
    if (index >= 0) return { day, dayIndex, index, slot: day.slots[index] };
  }
  return null;
}

/** A day or week can be removed only if no session in it has been logged. */
export function loggedInDay(state: EdState, dayId: string): number {
  return state.weeks.reduce((n, w) => n + (state.workouts[workoutKey(dayId, w.id)]?.loggedSets ?? 0), 0);
}
export function loggedInWeek(state: EdState, weekId: string): number {
  return state.days.reduce((n, d) => n + (state.workouts[workoutKey(d.id, weekId)]?.loggedSets ?? 0), 0);
}
export function loggedInSlot(state: EdState, slotId: string): number {
  return state.weeks.reduce((n, w) => n + (state.cells[cellKey(slotId, w.id)]?.loggedSets ?? 0), 0);
}

function contentOf(cell: EdCell): CellContent {
  const { loggedSets: _ignored, ...content } = cell;
  return content;
}

function insertAt<T>(list: T[], index: number, item: T): T[] {
  const i = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, i), item, ...list.slice(i)];
}

/** Planned dates follow the block start, week position and weekday, except for sessions already trained. */
export function recomputeDates(state: EdState): EdState {
  const workouts = { ...state.workouts };
  state.weeks.forEach((w, wi) => {
    for (const d of state.days) {
      const k = workoutKey(d.id, w.id);
      const wo = workouts[k];
      if (!wo || wo.completed || wo.loggedSets > 0) continue;
      const date = state.startDate ? plannedDate(state.startDate, wi, d.weekday) : null;
      if (wo.plannedDate !== date) workouts[k] = { ...wo, plannedDate: date };
    }
  });
  return { ...state, workouts };
}

export function applyOp(state: EdState, op: Op): EdState {
  switch (op.t) {
    case "setCell": {
      if (!findSlot(state, op.slotId)) fail("That row no longer exists.");
      if (!state.weeks.some((w) => w.id === op.weekId)) fail("That week no longer exists.");
      const k = cellKey(op.slotId, op.weekId);
      const prev = state.cells[k];
      return { ...state, cells: { ...state.cells, [k]: { ...op.cell, loggedSets: prev?.id === op.cell.id ? prev.loggedSets : 0 } } };
    }
    case "clearCell": {
      const k = cellKey(op.slotId, op.weekId);
      if (!state.cells[k]) return state;
      const cells = { ...state.cells };
      delete cells[k];
      return { ...state, cells };
    }
    case "addSlot": {
      const di = state.days.findIndex((d) => d.id === op.dayId);
      if (di < 0) fail("That day no longer exists.");
      if (findSlot(state, op.slot.id)) fail("Row already exists.");
      const days = state.days.map((d, i) => (i === di ? { ...d, slots: insertAt(d.slots, op.index, op.slot) } : d));
      return { ...state, days };
    }
    case "removeSlot": {
      const f = findSlot(state, op.slotId);
      if (!f) return state;
      const days = state.days.map((d, i) => (i === f.dayIndex ? { ...d, slots: d.slots.filter((s) => s.id !== op.slotId) } : d));
      const cells = { ...state.cells };
      for (const w of state.weeks) delete cells[cellKey(op.slotId, w.id)];
      return { ...state, days, cells };
    }
    case "moveSlot": {
      const f = findSlot(state, op.slotId);
      if (!f) fail("That row no longer exists.");
      const to = state.days.findIndex((d) => d.id === op.dayId);
      if (to < 0) fail("That day no longer exists.");
      if (op.dayId !== f.day.id && loggedInSlot(state, op.slotId) > 0)
        fail("This row has logged sets, so it can't move to another day. Copy it instead.");
      let days = state.days.map((d, i) => (i === f.dayIndex ? { ...d, slots: d.slots.filter((s) => s.id !== op.slotId) } : d));
      days = days.map((d, i) => (i === to ? { ...d, slots: insertAt(d.slots, op.index, f.slot) } : d));
      return { ...state, days };
    }
    case "setSlotExercise": {
      const f = findSlot(state, op.slotId);
      if (!f) fail("That row no longer exists.");
      const days = state.days.map((d, i) =>
        i === f.dayIndex ? { ...d, slots: d.slots.map((s) => (s.id === op.slotId ? { ...s, exerciseId: op.exerciseId } : s)) } : d,
      );
      return { ...state, days };
    }
    case "addDay": {
      if (state.days.some((d) => d.id === op.day.id)) fail("Day already exists.");
      const workouts = { ...state.workouts };
      for (const w of state.weeks) {
        const wid = op.workoutIds[w.id];
        if (!wid) fail("Missing workout id for a week.");
        workouts[workoutKey(op.day.id, w.id)] = { id: wid, plannedDate: null, completed: false, loggedSets: 0 };
      }
      return recomputeDates({ ...state, days: insertAt(state.days, op.index, { ...op.day, slots: [] }), workouts });
    }
    case "removeDay": {
      const day = state.days.find((d) => d.id === op.dayId);
      if (!day) return state;
      if (loggedInDay(state, op.dayId) > 0) fail("This day has logged sessions and can't be deleted. Clear its exercises instead.");
      const cells = { ...state.cells };
      const workouts = { ...state.workouts };
      for (const w of state.weeks) {
        delete workouts[workoutKey(day.id, w.id)];
        for (const s of day.slots) delete cells[cellKey(s.id, w.id)];
      }
      return { ...state, days: state.days.filter((d) => d.id !== op.dayId), cells, workouts };
    }
    case "updateDay": {
      if (!state.days.some((d) => d.id === op.dayId)) fail("That day no longer exists.");
      const days = state.days.map((d) => (d.id === op.dayId ? { ...d, name: op.name, weekday: op.weekday } : d));
      return recomputeDates({ ...state, days });
    }
    case "moveDay": {
      const day = state.days.find((d) => d.id === op.dayId);
      if (!day) fail("That day no longer exists.");
      return { ...state, days: insertAt(state.days.filter((d) => d.id !== op.dayId), op.index, day) };
    }
    case "addWeek": {
      if (state.weeks.some((w) => w.id === op.week.id)) fail("Week already exists.");
      const workouts = { ...state.workouts };
      for (const d of state.days) {
        const wid = op.workoutIds[d.id];
        if (!wid) fail("Missing workout id for a day.");
        workouts[workoutKey(d.id, op.week.id)] = { id: wid, plannedDate: null, completed: false, loggedSets: 0 };
      }
      return recomputeDates({ ...state, weeks: insertAt(state.weeks, op.index, op.week), workouts });
    }
    case "removeWeek": {
      if (!state.weeks.some((w) => w.id === op.weekId)) return state;
      if (loggedInWeek(state, op.weekId) > 0) fail("This week has logged sessions and can't be deleted. Clear its cells instead.");
      const cells = { ...state.cells };
      const workouts = { ...state.workouts };
      for (const d of state.days) {
        delete workouts[workoutKey(d.id, op.weekId)];
        for (const s of d.slots) delete cells[cellKey(s.id, op.weekId)];
      }
      return recomputeDates({ ...state, weeks: state.weeks.filter((w) => w.id !== op.weekId), cells, workouts });
    }
  }
}

/** Ops that undo `op`, computed against the state *before* `op` is applied. */
export function invertOp(state: EdState, op: Op): Op[] {
  switch (op.t) {
    case "setCell": {
      const prev = state.cells[cellKey(op.slotId, op.weekId)];
      return prev ? [{ t: "setCell", slotId: op.slotId, weekId: op.weekId, cell: contentOf(prev) }] : [{ t: "clearCell", slotId: op.slotId, weekId: op.weekId }];
    }
    case "clearCell": {
      const prev = state.cells[cellKey(op.slotId, op.weekId)];
      return prev ? [{ t: "setCell", slotId: op.slotId, weekId: op.weekId, cell: contentOf(prev) }] : [];
    }
    case "addSlot":
      return [{ t: "removeSlot", slotId: op.slot.id }];
    case "removeSlot": {
      const f = findSlot(state, op.slotId);
      if (!f) return [];
      return [{ t: "addSlot", dayId: f.day.id, index: f.index, slot: f.slot }, ...cellsOfSlot(state, op.slotId)];
    }
    case "moveSlot": {
      const f = findSlot(state, op.slotId);
      return f ? [{ t: "moveSlot", slotId: op.slotId, dayId: f.day.id, index: f.index }] : [];
    }
    case "setSlotExercise": {
      const f = findSlot(state, op.slotId);
      return f ? [{ t: "setSlotExercise", slotId: op.slotId, exerciseId: f.slot.exerciseId }] : [];
    }
    case "addDay":
      return [{ t: "removeDay", dayId: op.day.id }];
    case "removeDay": {
      const index = state.days.findIndex((d) => d.id === op.dayId);
      if (index < 0) return [];
      const day = state.days[index];
      const workoutIds: Record<string, string> = {};
      for (const w of state.weeks) workoutIds[w.id] = state.workouts[workoutKey(day.id, w.id)].id;
      return [
        { t: "addDay", index, day: { id: day.id, name: day.name, weekday: day.weekday }, workoutIds },
        ...day.slots.map((slot, i): Op => ({ t: "addSlot", dayId: day.id, index: i, slot })),
        ...day.slots.flatMap((s) => cellsOfSlot(state, s.id)),
      ];
    }
    case "updateDay": {
      const day = state.days.find((d) => d.id === op.dayId);
      return day ? [{ t: "updateDay", dayId: day.id, name: day.name, weekday: day.weekday }] : [];
    }
    case "moveDay": {
      const index = state.days.findIndex((d) => d.id === op.dayId);
      return index >= 0 ? [{ t: "moveDay", dayId: op.dayId, index }] : [];
    }
    case "addWeek":
      return [{ t: "removeWeek", weekId: op.week.id }];
    case "removeWeek": {
      const index = state.weeks.findIndex((w) => w.id === op.weekId);
      if (index < 0) return [];
      const workoutIds: Record<string, string> = {};
      for (const d of state.days) workoutIds[d.id] = state.workouts[workoutKey(d.id, op.weekId)].id;
      const cells: Op[] = [];
      for (const d of state.days)
        for (const s of d.slots) {
          const c = state.cells[cellKey(s.id, op.weekId)];
          if (c) cells.push({ t: "setCell", slotId: s.id, weekId: op.weekId, cell: contentOf(c) });
        }
      return [{ t: "addWeek", index, week: { id: op.weekId }, workoutIds }, ...cells];
    }
  }
}

function cellsOfSlot(state: EdState, slotId: string): Op[] {
  return state.weeks.flatMap((w): Op[] => {
    const c = state.cells[cellKey(slotId, w.id)];
    return c ? [{ t: "setCell", slotId, weekId: w.id, cell: contentOf(c) }] : [];
  });
}

/** Apply a batch of ops; returns the new state and the ops that undo the whole batch. */
export function applyOps(state: EdState, ops: Op[]): { state: EdState; inverse: Op[] } {
  let s = state;
  const inverses: Op[][] = [];
  for (const op of ops) {
    inverses.push(invertOp(s, op));
    s = applyOp(s, op);
  }
  return { state: s, inverse: inverses.reverse().flat() };
}
