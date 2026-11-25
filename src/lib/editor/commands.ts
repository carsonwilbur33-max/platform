/**
 * Higher-level grid commands, each producing a list of ops (one undo step).
 * Pure: they read editor state and return ops; ids come from `newId`.
 */
import { applyBulkEdit, type BulkEdit } from "@/lib/calc/bulk-edit";
import { formatPrescription, parsePrescription } from "@/lib/calc/shorthand";
import type { CellContent, Op } from "./ops";
import { cellKey, findSlot, workoutKey, type EdCell, type EdState } from "./state";

export type NewId = () => string;

// ---------------------------------------------------------------------------
// Row model for keyboard navigation: slot rows, plus an "add exercise" row per day
// ---------------------------------------------------------------------------

export type GridRow =
  | { kind: "slot"; dayId: string; dayIndex: number; slotId: string; slotIndex: number }
  | { kind: "add"; dayId: string; dayIndex: number };

export function buildRows(state: EdState, visibleDayIds?: Set<string>): GridRow[] {
  const rows: GridRow[] = [];
  state.days.forEach((d, dayIndex) => {
    if (visibleDayIds && !visibleDayIds.has(d.id)) return;
    d.slots.forEach((s, slotIndex) => rows.push({ kind: "slot", dayId: d.id, dayIndex, slotId: s.id, slotIndex }));
    rows.push({ kind: "add", dayId: d.id, dayIndex });
  });
  return rows;
}

export interface Range {
  r0: number;
  r1: number;
  /** Week columns, 1-based (column 0 is the exercise label). */
  c0: number;
  c1: number;
}

/** Slot rows × week ids covered by a range (skips "add" rows and the label column). */
export function rangeCells(state: EdState, rows: GridRow[], range: Range): { slotId: string; weekId: string; ri: number; ci: number }[][] {
  const out: { slotId: string; weekId: string; ri: number; ci: number }[][] = [];
  for (let r = range.r0; r <= range.r1; r++) {
    const row = rows[r];
    if (row?.kind !== "slot") continue;
    const line = [];
    for (let c = Math.max(1, range.c0); c <= range.c1; c++) {
      const week = state.weeks[c - 1];
      if (week) line.push({ slotId: row.slotId, weekId: week.id, ri: r, ci: c });
    }
    if (line.length) out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export function contentOf(cell: EdCell): CellContent {
  const { loggedSets: _l, ...c } = cell;
  return c;
}

/** Exercise-level fields for a new cell: copied from the nearest cell in the row (left first). */
function neighborMeta(state: EdState, slotId: string, weekId: string): Pick<CellContent, "modifiers" | "restSeconds" | "notes" | "unitOverride"> {
  const wi = state.weeks.findIndex((w) => w.id === weekId);
  const order = [...state.weeks.slice(0, wi).reverse(), ...state.weeks.slice(wi + 1)];
  for (const w of order) {
    const c = state.cells[cellKey(slotId, w.id)];
    if (c) return { modifiers: c.modifiers, restSeconds: c.restSeconds, notes: c.notes, unitOverride: c.unitOverride };
  }
  return { modifiers: {}, restSeconds: null, notes: "", unitOverride: null };
}

export type TextResult = { ok: true; ops: Op[] } | { ok: false; error: string };

/**
 * Ops for typing `text` into a cell. Empty text clears it. The text is stored
 * in canonical form. `exerciseId` overrides the exercise (paste / swap).
 */
export function opsSetText(state: EdState, slotId: string, weekId: string, text: string, newId: NewId, exerciseId?: string): TextResult {
  const k = cellKey(slotId, weekId);
  const existing = state.cells[k];
  if (text.trim() === "") return { ok: true, ops: existing ? [{ t: "clearCell", slotId, weekId }] : [] };
  const parsed = parsePrescription(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.groups.length === 0) return { ok: true, ops: existing ? [{ t: "clearCell", slotId, weekId }] : [] };
  const canonical = formatPrescription(parsed.groups);
  const slot = findSlot(state, slotId)?.slot;
  const ex = exerciseId ?? existing?.exerciseId ?? slot?.exerciseId;
  if (!ex) return { ok: false, error: "Pick this row's exercise first (Enter on the exercise name)." };
  if (existing && existing.text === canonical && existing.exerciseId === ex) return { ok: true, ops: [] };
  const cell: CellContent = existing
    ? { ...contentOf(existing), text: canonical, exerciseId: ex }
    : { id: newId(), exerciseId: ex, text: canonical, ...neighborMeta(state, slotId, weekId) };
  return { ok: true, ops: [{ t: "setCell", slotId, weekId, cell }] };
}

/** Update exercise-level fields of one cell, or of every cell in its row. */
export function opsSetMeta(
  state: EdState,
  slotId: string,
  weekId: string | null,
  patch: Partial<Pick<CellContent, "modifiers" | "restSeconds" | "notes" | "unitOverride" | "exerciseId">>,
): Op[] {
  const weekIds = weekId ? [weekId] : state.weeks.map((w) => w.id);
  const ops: Op[] = [];
  for (const wid of weekIds) {
    const c = state.cells[cellKey(slotId, wid)];
    if (!c) continue;
    const next = { ...contentOf(c), ...patch };
    if (JSON.stringify(next) !== JSON.stringify(contentOf(c))) ops.push({ t: "setCell", slotId, weekId: wid, cell: next });
  }
  return ops;
}

export function opsClear(state: EdState, cells: { slotId: string; weekId: string }[]): Op[] {
  return cells.filter((c) => state.cells[cellKey(c.slotId, c.weekId)]).map((c): Op => ({ t: "clearCell", slotId: c.slotId, weekId: c.weekId }));
}

/** Change a row's exercise. Cells that used the row's exercise follow; per-week swaps are kept. */
export function opsSetRowExercise(state: EdState, slotId: string, exerciseId: string): Op[] {
  const f = findSlot(state, slotId);
  if (!f || f.slot.exerciseId === exerciseId) return [];
  const ops: Op[] = [{ t: "setSlotExercise", slotId, exerciseId }];
  for (const w of state.weeks) {
    const c = state.cells[cellKey(slotId, w.id)];
    if (c && (c.exerciseId === f.slot.exerciseId || !f.slot.exerciseId)) ops.push({ t: "setCell", slotId, weekId: w.id, cell: { ...contentOf(c), exerciseId } });
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

export interface ClipCell {
  text: string;
  /** Set when the copied cell was a per-week swap, so the swap travels with it. */
  swapExerciseId: string | null;
  exerciseId: string;
  meta: Pick<CellContent, "modifiers" | "restSeconds" | "notes" | "unitOverride">;
}
export type Clip = (ClipCell | null)[][];

export function copyRange(state: EdState, cells: { slotId: string; weekId: string }[][]): Clip {
  return cells.map((line) =>
    line.map(({ slotId, weekId }) => {
      const c = state.cells[cellKey(slotId, weekId)];
      if (!c) return null;
      const rowEx = findSlot(state, slotId)?.slot.exerciseId;
      return {
        text: c.text,
        exerciseId: c.exerciseId,
        swapExerciseId: c.exerciseId !== rowEx ? c.exerciseId : null,
        meta: { modifiers: c.modifiers, restSeconds: c.restSeconds, notes: c.notes, unitOverride: c.unitOverride },
      };
    }),
  );
}

/** Tab-separated text for the system clipboard (pastes into Google Sheets / Excel). */
export function clipToTsv(clip: Clip): string {
  return clip.map((line) => line.map((c) => c?.text ?? "").join("\t")).join("\n");
}

/** Plain text pasted from elsewhere: one prescription per cell, tab-separated columns. */
export function tsvToClip(text: string): { clip: Clip; invalid: number } {
  let invalid = 0;
  const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n");
  const clip = lines.map((line) =>
    line.split("\t").map((raw): ClipCell | null => {
      const v = raw.trim().replace(/^"|"$/g, "");
      if (!v) return null;
      const p = parsePrescription(v);
      if (!p.ok || p.groups.length === 0) {
        invalid++;
        return null;
      }
      return { text: formatPrescription(p.groups), exerciseId: "", swapExerciseId: null, meta: { modifiers: {}, restSeconds: null, notes: "", unitOverride: null } };
    }),
  );
  return { clip, invalid };
}

function pasteCell(state: EdState, slotId: string, weekId: string, src: ClipCell | null, newId: NewId): Op[] {
  const k = cellKey(slotId, weekId);
  const existing = state.cells[k];
  if (!src) return existing ? [{ t: "clearCell", slotId, weekId }] : [];
  const rowEx = findSlot(state, slotId)?.slot.exerciseId ?? null;
  const exerciseId = src.swapExerciseId ?? rowEx ?? (src.exerciseId || null);
  if (!exerciseId) return [];
  const sameExercise = exerciseId === src.exerciseId;
  const meta = existing
    ? { modifiers: existing.modifiers, restSeconds: existing.restSeconds, notes: existing.notes, unitOverride: existing.unitOverride }
    : sameExercise
      ? src.meta
      : neighborMeta(state, slotId, weekId);
  const cell: CellContent = { id: existing?.id ?? newId(), exerciseId, text: src.text, ...meta };
  if (existing && JSON.stringify(contentOf(existing)) === JSON.stringify(cell)) return [];
  return [{ t: "setCell", slotId, weekId, cell }];
}

/**
 * Paste a clip with its top-left at the target's top-left. A single copied
 * cell fills the whole target selection; otherwise the clip's shape is used
 * (clipped to the rows and weeks that exist).
 */
export function opsPaste(state: EdState, rows: GridRow[], target: Range, clip: Clip, newId: NewId): Op[] {
  const slotRows = rows.map((r, i) => ({ r, i })).filter((x) => x.r.kind === "slot").filter((x) => x.i >= target.r0);
  const single = clip.length === 1 && clip[0].length === 1;
  const height = single ? slotRows.filter((x) => x.i <= target.r1).length : clip.length;
  const width = single ? Math.max(1, target.c1 - Math.max(1, target.c0) + 1) : Math.max(...clip.map((l) => l.length));
  const c0 = Math.max(1, target.c0);
  const ops: Op[] = [];
  for (let dr = 0; dr < height && dr < slotRows.length; dr++) {
    const row = slotRows[dr].r;
    if (row.kind !== "slot") continue;
    for (let dc = 0; dc < width; dc++) {
      const week = state.weeks[c0 - 1 + dc];
      if (!week) break;
      const src = single ? clip[0][0] : (clip[dr]?.[dc] ?? null);
      ops.push(...pasteCell(state, row.slotId, week.id, src, newId));
    }
  }
  return ops;
}

/** Copy each row's leftmost selected cell (or the cell to the left, for one column) across the selection. */
export function opsFillRight(state: EdState, rows: GridRow[], range: Range, newId: NewId): Op[] {
  const c0 = Math.max(1, range.c0);
  const sourceCol = range.c1 > c0 ? c0 : c0 - 1;
  if (sourceCol < 1) return [];
  const ops: Op[] = [];
  for (let r = range.r0; r <= range.r1; r++) {
    const row = rows[r];
    if (row?.kind !== "slot") continue;
    const srcWeek = state.weeks[sourceCol - 1];
    const [src] = copyRange(state, [[{ slotId: row.slotId, weekId: srcWeek.id }]])[0];
    for (let c = Math.max(c0, sourceCol + 1); c <= range.c1; c++) ops.push(...pasteCell(state, row.slotId, state.weeks[c - 1].id, src, newId));
  }
  return ops;
}

/** Bulk edit every filled cell in a range; progressive edits scale by weeks after the first selected week. */
export function opsBulkEdit(state: EdState, cells: { slotId: string; weekId: string; ci: number }[][], edit: BulkEdit, progressive: boolean): Op[] {
  const firstCol = Math.min(...cells.flat().map((c) => c.ci));
  const ops: Op[] = [];
  for (const { slotId, weekId, ci } of cells.flat()) {
    const c = state.cells[cellKey(slotId, weekId)];
    if (!c) continue;
    const p = parsePrescription(c.text);
    if (!p.ok) continue;
    const factor = progressive ? ci - firstCol : 1;
    const text = formatPrescription(p.groups.map((g) => applyBulkEdit(g, edit, factor)));
    if (text !== c.text) ops.push({ t: "setCell", slotId, weekId, cell: { ...contentOf(c), text } });
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

export function opsAddWeek(state: EdState, index: number, newId: NewId): Op[] {
  const workoutIds = Object.fromEntries(state.days.map((d) => [d.id, newId()]));
  return [{ t: "addWeek", index, week: { id: newId() }, workoutIds }];
}

/** Insert a copy of a week right after it. */
export function opsDuplicateWeek(state: EdState, weekId: string, newId: NewId): Op[] {
  const index = state.weeks.findIndex((w) => w.id === weekId);
  if (index < 0) return [];
  const [add] = opsAddWeek(state, index + 1, newId) as [Extract<Op, { t: "addWeek" }>];
  const ops: Op[] = [add];
  for (const d of state.days)
    for (const s of d.slots) {
      const c = state.cells[cellKey(s.id, weekId)];
      if (c) ops.push({ t: "setCell", slotId: s.id, weekId: add.week.id, cell: { ...contentOf(c), id: newId() } });
    }
  return ops;
}

export function opsAddDay(state: EdState, index: number, name: string, weekday: number | null, newId: NewId): Op[] {
  const workoutIds = Object.fromEntries(state.weeks.map((w) => [w.id, newId()]));
  return [{ t: "addDay", index, day: { id: newId(), name, weekday }, workoutIds }];
}

/** Insert a copy of a day (rows and every week's cells) right after it. */
export function opsDuplicateDay(state: EdState, dayId: string, newId: NewId): Op[] {
  const index = state.days.findIndex((d) => d.id === dayId);
  if (index < 0) return [];
  const day = state.days[index];
  const [add] = opsAddDay(state, index + 1, day.name ? `${day.name} (copy)` : "", day.weekday, newId) as [Extract<Op, { t: "addDay" }>];
  const ops: Op[] = [add];
  day.slots.forEach((s, i) => {
    const slotId = newId();
    ops.push({ t: "addSlot", dayId: add.day.id, index: i, slot: { id: slotId, exerciseId: s.exerciseId } });
    for (const w of state.weeks) {
      const c = state.cells[cellKey(s.id, w.id)];
      if (c) ops.push({ t: "setCell", slotId, weekId: w.id, cell: { ...contentOf(c), id: newId() } });
    }
  });
  return ops;
}

/** Planned date for a cell's session, falling back to the block start or today (for TM lookup). */
export function cellDate(state: EdState, dayId: string, weekId: string, fallback: string): string {
  return state.workouts[workoutKey(dayId, weekId)]?.plannedDate ?? state.startDate ?? fallback;
}
