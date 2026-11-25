"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createExercise } from "@/app/actions/editor";
import { parsePrescription, type ParseResult } from "@/lib/calc/shorthand";
import { formatShortDate, WEEKDAY_SHORT, addDays } from "@/lib/dates";
import {
  buildRows,
  cellDate,
  clipToTsv,
  copyRange,
  opsAddDay,
  opsAddWeek,
  opsBulkEdit,
  opsClear,
  opsDuplicateDay,
  opsDuplicateWeek,
  opsFillRight,
  opsPaste,
  opsSetRowExercise,
  opsSetText,
  rangeCells,
  tsvToClip,
  type Clip,
  type GridRow,
  type Range,
} from "@/lib/editor/commands";
import { newId } from "@/lib/editor/new-id";
import type { Op } from "@/lib/editor/ops";
import { cellKey, loggedInDay, loggedInSlot, loggedInWeek, workoutKey, type EdCell, type EdState } from "@/lib/editor/state";
import { formatModifiers } from "@/lib/calc/prescription";
import { AthleteContext } from "@/lib/program/athlete-context";
import { DEFAULT_RPE_CHART } from "@/lib/calc/rpe-chart";
import type { EditorData, LibraryExercise } from "@/server/editor-data";
import { BlockHeader } from "./block-header";
import { BulkEditDialog, HelpDialog } from "./dialogs";
import { ExercisePicker } from "./exercise-picker";
import { formatRest, Inspector } from "./inspector";
import { useEditor } from "./use-editor";

const CLIP_MIME = "application/x-platform-cells";
const CLIP_STORE = "platform.clipboard";
const LABEL_W = 220;
const WEEK_W = 230;

interface Pos {
  r: number;
  c: number;
}

function normRange(a: Pos, b: Pos): Range {
  return { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) };
}

function readStoredClip(): { tsv: string; clip: Clip } | null {
  try {
    const raw = localStorage.getItem(CLIP_STORE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function BlockEditor({ data }: { data: EditorData }) {
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  const ed = useEditor(data.state, notify);
  const { state } = ed;
  const [library, setLibrary] = useState(data.library);
  const exName = useMemo(() => new Map(library.map((e) => [e.id, e.name])), [library]);

  // Load previews: the athlete's real context, or a neutral one for templates (fixed loads only).
  const ctx = useMemo(
    () =>
      new AthleteContext(
        data.athlete ?? { unit: "kg", roundingKg: 2.5, roundingLb: 5, e1rmFormula: "epley" },
        library.map((e) => ({ id: e.id, name: e.name, parentId: e.parentId, defaultTmRatio: e.defaultTmRatio })),
        data.ctx?.tms ?? [],
        data.ctx?.settings ?? [],
        data.ctx?.chart ?? DEFAULT_RPE_CHART,
      ),
    [data.athlete, data.ctx, library],
  );

  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const rows = useMemo(() => buildRows(state, dayFilter ? new Set([dayFilter]) : undefined), [state, dayFilter]);
  const W = state.weeks.length;
  const [cursor, setCursor] = useState<Pos>({ r: 0, c: 1 });
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; initial: string } | null>(null);
  const [picking, setPicking] = useState<{ r: number; initial: string } | null>(null);
  const [dialog, setDialog] = useState<null | "bulk" | "help">(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const range = normRange(anchor ?? cursor, cursor);

  // Keep the cursor inside the grid as rows/weeks change.
  useEffect(() => {
    setCursor((p) => ({ r: Math.max(0, Math.min(p.r, rows.length - 1)), c: Math.max(0, Math.min(p.c, W)) }));
  }, [rows.length, W]);
  useEffect(() => {
    document.getElementById(`cell-${cursor.r}-${cursor.c}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [cursor]);

  const focusGrid = () => requestAnimationFrame(() => gridRef.current?.focus({ preventScroll: true }));
  const commit = useCallback((ops: Op[], label: string) => ed.commit(ops, label), [ed]);

  const move = (dr: number, dc: number, extend = false) => {
    if (extend && !anchor) setAnchor(cursor);
    if (!extend) setAnchor(null);
    setCursor((p) => ({ r: Math.max(0, Math.min(rows.length - 1, p.r + dr)), c: Math.max(0, Math.min(W, p.c + dc)) }));
  };
  const moveTab = (back: boolean) => {
    setAnchor(null);
    setCursor((p) => {
      let { r, c } = p;
      c += back ? -1 : 1;
      if (c > W) {
        c = 0;
        r = Math.min(rows.length - 1, r + 1);
      } else if (c < 0) {
        c = W;
        r = Math.max(0, r - 1);
      }
      return { r, c };
    });
  };

  const createEx = useCallback(
    async (name: string): Promise<LibraryExercise | null> => {
      const r = await createExercise({ name, category: "other", parentId: "", defaultTmRatio: "" });
      if (!r.ok) {
        notify(r.error);
        return null;
      }
      setLibrary((l) => [...l, r.exercise].sort((a, b) => a.name.localeCompare(b.name)));
      notify(`Created “${r.exercise.name}”. Set its category or parent lift in the exercise library.`);
      return r.exercise;
    },
    [notify],
  );

  // ---- actions ----------------------------------------------------------

  const commitText = (pos: Pos, text: string): string | null => {
    const row = rows[pos.r];
    const week = state.weeks[pos.c - 1];
    if (row?.kind !== "slot" || !week) return null;
    const r = opsSetText(state, row.slotId, week.id, text, newId);
    if (!r.ok) return r.error;
    commit(r.ops, "Edit cell");
    return null;
  };

  const pickExercise = (pos: { r: number }, ex: LibraryExercise) => {
    const row = rows[pos.r];
    setPicking(null);
    if (row?.kind === "slot") commit(opsSetRowExercise(state, row.slotId, ex.id), `Set exercise to ${ex.name}`);
    else if (row?.kind === "add") {
      const day = state.days[row.dayIndex];
      if (commit([{ t: "addSlot", dayId: day.id, index: day.slots.length, slot: { id: newId(), exerciseId: ex.id } }], `Add ${ex.name}`))
        setCursor({ r: pos.r, c: 1 });
    }
    focusGrid();
  };

  const insertRowBelow = () => {
    const row = rows[cursor.r];
    if (!row) return;
    const day = state.days[row.dayIndex];
    const index = row.kind === "slot" ? row.slotIndex + 1 : day.slots.length;
    if (commit([{ t: "addSlot", dayId: day.id, index, slot: { id: newId(), exerciseId: null } }], "Insert row")) {
      const r = row.kind === "slot" ? cursor.r + 1 : cursor.r;
      setAnchor(null);
      setCursor({ r, c: 0 });
      setPicking({ r, initial: "" });
    }
  };

  const deleteRows = () => {
    const slotRows = rows.slice(range.r0, range.r1 + 1).filter((r): r is Extract<GridRow, { kind: "slot" }> => r.kind === "slot");
    if (!slotRows.length) return;
    const logged = slotRows.reduce((n, r) => n + loggedInSlot(state, r.slotId), 0);
    const names = slotRows.map((r) => exName.get(state.days[r.dayIndex].slots[r.slotIndex].exerciseId ?? "") ?? "empty row").join(", ");
    const msg = logged
      ? `Delete ${names}? ${logged} logged set(s) will be kept in the athlete's history but unlinked from this program.`
      : `Delete ${names}?`;
    if (!confirm(msg)) return;
    commit(slotRows.map((r): Op => ({ t: "removeSlot", slotId: r.slotId })), slotRows.length > 1 ? "Delete rows" : `Delete ${names}`);
  };

  const clearSelection = () => {
    const cells = rangeCells(state, rows, range).flat();
    const logged = cells.reduce((n, c) => n + (state.cells[cellKey(c.slotId, c.weekId)]?.loggedSets ?? 0), 0);
    if (logged && !confirm(`${logged} logged set(s) are attached to these cells. They stay in the athlete's history. Clear anyway?`)) return;
    commit(opsClear(state, cells), cells.length > 1 ? "Clear cells" : "Clear cell");
  };

  const moveRow = (dir: -1 | 1) => {
    const row = rows[cursor.r];
    if (row?.kind !== "slot") return;
    const day = state.days[row.dayIndex];
    let target: { dayId: string; index: number } | null = null;
    if (dir === -1 && row.slotIndex > 0) target = { dayId: day.id, index: row.slotIndex - 1 };
    else if (dir === 1 && row.slotIndex < day.slots.length - 1) target = { dayId: day.id, index: row.slotIndex + 1 };
    else {
      const other = state.days[row.dayIndex + dir];
      if (other && (!dayFilter || dayFilter === other.id)) target = { dayId: other.id, index: dir === -1 ? other.slots.length : 0 };
    }
    if (!target) return;
    if (commit([{ t: "moveSlot", slotId: row.slotId, dayId: target.dayId, index: target.index }], "Move row")) {
      const newRows = buildRows(ed.stateRef.current, dayFilter ? new Set([dayFilter]) : undefined);
      const r = newRows.findIndex((x) => x.kind === "slot" && x.slotId === row.slotId);
      setAnchor(null);
      setCursor((p) => ({ r, c: p.c }));
    }
  };

  const fillRight = () => commit(opsFillRight(state, rows, range, newId), "Fill right");

  const doCopy = (e: ClipboardEvent, cut: boolean) => {
    if (!e.clipboardData || editing || picking || document.activeElement !== gridRef.current) return;
    const cells = rangeCells(state, rows, range);
    if (!cells.length) return;
    const clip = copyRange(state, cells);
    const tsv = clipToTsv(clip);
    e.clipboardData.setData("text/plain", tsv);
    e.clipboardData.setData(CLIP_MIME, JSON.stringify(clip));
    try {
      localStorage.setItem(CLIP_STORE, JSON.stringify({ tsv, clip }));
    } catch {
      /* storage unavailable: rich paste still works in this tab via the custom type */
    }
    e.preventDefault();
    if (cut) commit(opsClear(state, cells.flat()), "Cut");
    else notify(`Copied ${cells.flat().length} cell${cells.flat().length === 1 ? "" : "s"}`);
  };

  const doPaste = (e: ClipboardEvent) => {
    if (!e.clipboardData || editing || picking || document.activeElement !== gridRef.current) return;
    e.preventDefault();
    let clip: Clip | null = null;
    const rich = e.clipboardData.getData(CLIP_MIME);
    const text = e.clipboardData.getData("text/plain");
    if (rich) clip = JSON.parse(rich);
    else {
      const stored = readStoredClip();
      if (stored && stored.tsv === text) clip = stored.clip;
      else {
        const t = tsvToClip(text);
        clip = t.clip;
        if (t.invalid)
          notify(t.invalid === 1 ? "1 pasted value wasn't a valid prescription and was skipped." : `${t.invalid} pasted values weren't valid prescriptions and were skipped.`);
      }
    }
    if (!clip?.length) return;
    commit(opsPaste(state, rows, { ...range, c0: Math.max(1, range.c0) }, clip, newId), "Paste");
  };

  // Browsers fire copy/paste on the document when nothing is selected, so listen there
  // and act only while the grid itself has focus.
  const clipHandlers = useRef({ doCopy, doPaste });
  clipHandlers.current = { doCopy, doPaste };
  useEffect(() => {
    const copy = (e: ClipboardEvent) => clipHandlers.current.doCopy(e, false);
    const cut = (e: ClipboardEvent) => clipHandlers.current.doCopy(e, true);
    const paste = (e: ClipboardEvent) => clipHandlers.current.doPaste(e);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("paste", paste);
    return () => {
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("paste", paste);
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || picking || dialog) return;
    if (e.target !== gridRef.current) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const row = rows[cursor.r];
    const handled = () => e.preventDefault();

    if (mod && (k === "z" || k === "Z")) return handled(), e.shiftKey ? ed.redo() : ed.undo();
    if (mod && (k === "y" || k === "Y")) return handled(), ed.redo();
    if (mod && (k === "r" || k === "R")) return handled(), fillRight();
    if (mod && (k === "b" || k === "B")) return handled(), setDialog("bulk");
    if (mod && (k === "i" || k === "I")) {
      handled();
      inspectorRef.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
      return;
    }
    if (mod && k === "Enter") return handled(), insertRowBelow();
    if (e.altKey && (k === "ArrowUp" || k === "ArrowDown")) return handled(), moveRow(k === "ArrowUp" ? -1 : 1);
    if (mod || e.altKey) return;

    switch (k) {
      case "ArrowUp":
        return handled(), move(-1, 0, e.shiftKey);
      case "ArrowDown":
        return handled(), move(1, 0, e.shiftKey);
      case "ArrowLeft":
        return handled(), move(0, -1, e.shiftKey);
      case "ArrowRight":
        return handled(), move(0, 1, e.shiftKey);
      case "Tab":
        return handled(), moveTab(e.shiftKey);
      case "Home":
        return handled(), setCursor((p) => ({ ...p, c: 0 }));
      case "End":
        return handled(), setCursor((p) => ({ ...p, c: W }));
      case "Escape":
        return handled(), setAnchor(null);
      case "?":
        return handled(), setDialog("help");
      case "Enter":
      case "F2":
        handled();
        if (cursor.c === 0 || row?.kind === "add") return setPicking({ r: cursor.r, initial: "" });
        return setEditing({ ...cursor, initial: cellAt(state, rows, cursor)?.text ?? "" });
      case "Delete":
      case "Backspace":
        handled();
        return cursor.c === 0 && range.c1 === 0 ? deleteRows() : clearSelection();
    }
    if (k.length === 1) {
      handled();
      setAnchor(null);
      if (cursor.c === 0 || row?.kind === "add") setPicking({ r: cursor.r, initial: k });
      else setEditing({ ...cursor, initial: k });
    }
  };

  /** Mouse drag with the button held: extend the selection. */
  const onCellDrag = (pos: Pos) => {
    if (editing || picking) return;
    if (!anchor) setAnchor(cursor);
    setCursor(pos);
  };

  const onCellMouseDown = (e: React.MouseEvent, pos: Pos) => {
    if (e.button !== 0) return;
    if (e.shiftKey) {
      if (!anchor) setAnchor(cursor);
    } else setAnchor(pos);
    setCursor(pos);
    gridRef.current?.focus({ preventScroll: true });
  };

  // ---- structure actions (day / week menus) --------------------------------

  const dayActions = {
    rename: (dayId: string, name: string, weekday: number | null) => commit([{ t: "updateDay", dayId, name, weekday }], "Edit day"),
    move: (dayId: string, dir: -1 | 1) => {
      const i = state.days.findIndex((d) => d.id === dayId);
      if (i + dir < 0 || i + dir >= state.days.length) return;
      commit([{ t: "moveDay", dayId, index: i + dir }], "Move day");
    },
    duplicate: (dayId: string) => commit(opsDuplicateDay(state, dayId, newId), "Duplicate day"),
    remove: (dayId: string) => {
      if (loggedInDay(state, dayId) > 0) return notify("This day has logged sessions and can't be deleted. Clear its exercises instead.");
      if (confirm("Delete this day from every week?")) commit([{ t: "removeDay", dayId }], "Delete day");
    },
  };
  const weekActions = {
    duplicate: (weekId: string) => commit(opsDuplicateWeek(state, weekId, newId), "Duplicate week"),
    remove: (weekId: string) => {
      if (loggedInWeek(state, weekId) > 0) return notify("This week has logged sessions and can't be deleted. Clear its cells instead.");
      if (confirm("Delete this week?")) commit([{ t: "removeWeek", weekId }], "Delete week");
    },
  };

  // ---- render -------------------------------------------------------------

  const cols = `${LABEL_W}px repeat(${W}, minmax(${WEEK_W}px, 1fr))`;
  const minWidth = LABEL_W + W * WEEK_W;
  const cursorRow = rows[cursor.r];
  const inspectorSlot = cursorRow?.kind === "slot" ? cursorRow.slotId : null;
  const inspectorWeek = cursor.c >= 1 ? (state.weeks[cursor.c - 1]?.id ?? null) : null;
  const bulkCells = rangeCells(state, rows, range);
  const filledInRange = bulkCells.flat().filter((c) => state.cells[cellKey(c.slotId, c.weekId)]).length;
  const currentWeek = state.startDate
    ? state.weeks.findIndex((_, i) => {
        const start = addDays(state.startDate!, i * 7);
        return start <= data.today && data.today < addDays(start, 7);
      })
    : -1;

  return (
    <div>
      <BlockHeader
        data={data}
        ed={ed}
        onHelp={() => setDialog("help")}
        onBulk={() => setDialog("bulk")}
        canBulk={filledInRange > 0}
        notify={notify}
      />

      <nav aria-label="Days" className="mb-3 flex flex-wrap gap-1.5 text-sm">
        <DayTab active={dayFilter === null} onClick={() => setDayFilter(null)}>
          All days
        </DayTab>
        {state.days.map((d, i) => (
          <DayTab key={d.id} active={dayFilter === d.id} onClick={() => setDayFilter(d.id)}>
            <span className="font-semibold">Day {i + 1}</span>
            {d.weekday !== null && <span className="opacity-70"> · {WEEKDAY_SHORT[d.weekday]}</span>}
          </DayTab>
        ))}
      </nav>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div
          ref={gridRef}
          tabIndex={0}
          role="grid"
          aria-label="Program grid"
          aria-rowcount={rows.length}
          aria-colcount={W + 1}
          className="overflow-x-auto rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          onKeyDown={onKeyDown}
        >
          <div style={{ minWidth }} className="space-y-4 pb-1">
            {/* Week bar */}
            <div className="grid text-sm" style={{ gridTemplateColumns: cols }}>
              <div className="flex items-end px-3 pb-1 text-xs text-muted">
                {W} week{W === 1 ? "" : "s"} · {state.days.length} day{state.days.length === 1 ? "" : "s"}
              </div>
              {state.weeks.map((w, i) => (
                <div key={w.id} className={`group rounded-t-md px-3 py-1.5 ${i === currentWeek ? "bg-accent-soft" : ""}`}>
                  <div className="flex items-center justify-between gap-2 whitespace-nowrap">
                    <span className="text-xs font-semibold uppercase tracking-wide">Week {i + 1}</span>
                    <span className="flex gap-0.5 text-[11px] opacity-60 group-hover:opacity-100">
                      <button className="rounded px-1 hover:bg-surface-2" title="Duplicate this week after it" onClick={() => weekActions.duplicate(w.id)}>
                        Duplicate
                      </button>
                      <button className="rounded px-1 hover:bg-bad-soft hover:text-bad" title="Delete week" onClick={() => weekActions.remove(w.id)}>
                        Delete
                      </button>
                    </span>
                  </div>
                  <div className="text-xs text-muted">{state.startDate ? `from ${formatShortDate(addDays(state.startDate, i * 7))}` : "\u00a0"}</div>
                </div>
              ))}
            </div>

            {state.days.map((day, dayIndex) => {
              if (dayFilter && day.id !== dayFilter) return null;
              const dayRows = rows.map((r, i) => ({ r, i })).filter((x) => x.r.dayIndex === dayIndex);
              return (
                <section key={day.id} aria-label={`Day ${dayIndex + 1}`} className="overflow-visible rounded-lg border border-border-strong bg-surface">
                  <DayHeader
                    day={day}
                    number={dayIndex + 1}
                    count={day.slots.length}
                    isFirst={dayIndex === 0}
                    isLast={dayIndex === state.days.length - 1}
                    actions={dayActions}
                  />
                  <div className="grid text-sm" style={{ gridTemplateColumns: cols }}>
                    <div className="border-b border-border px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted">Exercise</div>
                    {state.weeks.map((w, wi) => {
                      const wo = state.workouts[workoutKey(day.id, w.id)];
                      return (
                        <div key={w.id} className={`border-b border-l border-border px-3 py-1.5 text-xs ${wi === currentWeek ? "bg-accent-soft/60" : ""}`}>
                          <div className="flex justify-between gap-2">
                            <span className={wo?.plannedDate === data.today ? "font-semibold text-accent" : "text-muted"}>
                              {wo?.plannedDate ? formatShortDate(wo.plannedDate) : `Week ${wi + 1}`}
                            </span>
                            {wo && (wo.completed || wo.loggedSets > 0) && (
                              <Link href={`/coach/sessions/${wo.id}`} className={`hover:underline ${wo.completed ? "text-ok" : "text-accent"}`} title="Review this session">
                                {wo.completed ? "done" : "in progress"} · {wo.loggedSets} →
                              </Link>
                            )}
                            {wo && !wo.completed && wo.plannedDate && wo.plannedDate < data.today && wo.loggedSets === 0 && <span className="text-bad">missed</span>}
                          </div>
                        </div>
                      );
                    })}

                    {dayRows.map(({ r: row, i: ri }) => {
                      const isAdd = row.kind === "add";
                      const slot = row.kind === "slot" ? day.slots[row.slotIndex] : null;
                      const firstCell = slot ? state.weeks.map((w) => state.cells[cellKey(slot.id, w.id)]).find(Boolean) : undefined;
                      return (
                        <RowCells
                          key={slot?.id ?? `add-${day.id}`}
                          ri={ri}
                          W={W}
                          label={
                            isAdd ? (
                              <span className="text-muted">+ Add exercise</span>
                            ) : (
                              <div>
                                <div className="flex gap-2">
                                  <span className="w-4 shrink-0 text-right font-mono text-xs leading-5 text-muted">{(row.kind === "slot" ? row.slotIndex : 0) + 1}</span>
                                  <span className={`font-medium ${slot?.exerciseId ? "" : "italic text-muted"}`}>
                                    {slot?.exerciseId ? exName.get(slot.exerciseId) : "Pick exercise…"}
                                  </span>
                                </div>
                                {firstCell && (formatModifiers(firstCell.modifiers) || firstCell.restSeconds) && (
                                  <div className="pl-6 text-xs text-muted">
                                    {[formatModifiers(firstCell.modifiers), firstCell.restSeconds ? `rest ${formatRest(firstCell.restSeconds)} min` : ""]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </div>
                                )}
                              </div>
                            )
                          }
                          isAdd={isAdd}
                          range={range}
                          cursor={cursor}
                          onMouseDown={onCellMouseDown}
                          onDrag={onCellDrag}
                          onDoubleClick={(pos) => {
                            if (pos.c === 0 || isAdd) setPicking({ r: pos.r, initial: "" });
                            else setEditing({ ...pos, initial: cellAt(state, rows, pos)?.text ?? "" });
                          }}
                          picker={
                            picking?.r === ri ? (
                              <ExercisePicker
                                library={library}
                                initialQuery={picking.initial}
                                onCreate={createEx}
                                onPick={(ex) => pickExercise({ r: ri }, ex)}
                                onCancel={() => {
                                  setPicking(null);
                                  focusGrid();
                                }}
                              />
                            ) : null
                          }
                          renderCell={(c) => {
                            const week = state.weeks[c - 1];
                            if (!slot || !week) return null;
                            const cell = state.cells[cellKey(slot.id, week.id)];
                            const date = cellDate(state, day.id, week.id, data.today);
                            if (editing && editing.r === ri && editing.c === c) {
                              return (
                                <CellEditor
                                  initial={editing.initial}
                                  exerciseId={cell?.exerciseId ?? slot.exerciseId}
                                  date={date}
                                  unitOverride={cell?.unitOverride ?? null}
                                  ctx={ctx}
                                  onCommit={(text, dir, fromBlur) => {
                                    const err = commitText({ r: ri, c }, text);
                                    if (err) {
                                      if (fromBlur) {
                                        notify(`Not saved: ${err}`);
                                        setEditing(null);
                                      }
                                      return err;
                                    }
                                    setEditing(null);
                                    if (!fromBlur) {
                                      if (dir === "down") move(1, 0);
                                      else if (dir === "right") moveTab(false);
                                      else if (dir === "left") moveTab(true);
                                      focusGrid();
                                    }
                                    return null;
                                  }}
                                  onCancel={() => {
                                    setEditing(null);
                                    focusGrid();
                                  }}
                                />
                              );
                            }
                            return cell ? <CellView cell={cell} swapped={cell.exerciseId !== slot.exerciseId} exName={exName} date={date} ctx={ctx} /> : null;
                          }}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}

            <div className="flex gap-2">
              <button
                className="btn-secondary"
                onClick={() => commit(opsAddDay(state, state.days.length, `Day ${state.days.length + 1}`, null, newId), "Add day")}
              >
                + Add day
              </button>
              <button className="btn-secondary" onClick={() => commit(opsAddWeek(state, state.weeks.length, newId), "Add week")}>
                + Add week
              </button>
            </div>
          </div>
        </div>

        <aside className="xl:sticky xl:top-16 xl:self-start">
          <Inspector
            state={state}
            slotId={inspectorSlot}
            weekId={inspectorWeek}
            dayLabel={cursorRow ? `Day ${cursorRow.dayIndex + 1}` : ""}
            date={inspectorSlot && inspectorWeek && cursorRow ? cellDate(state, cursorRow.dayId, inspectorWeek, data.today) : null}
            library={library}
            ctx={ctx}
            hasAthlete={!!data.athlete}
            commit={commit}
            onCreateExercise={createEx}
            onClose={focusGrid}
            panelRef={inspectorRef}
          />
          <p className="mt-2 px-1 text-xs text-muted">
            Press <kbd className="rounded border border-border px-1">?</kbd> for keyboard shortcuts and shorthand.
          </p>
        </aside>
      </div>

      {dialog === "bulk" && (
        <BulkEditDialog
          cellCount={filledInRange}
          weekCount={Math.max(1, Math.min(range.c1, W) - Math.max(1, range.c0) + 1)}
          defaultUnit={data.athlete?.unit ?? "kg"}
          onClose={() => {
            setDialog(null);
            focusGrid();
          }}
          onApply={(edit, progressive) => {
            const ops = opsBulkEdit(state, bulkCells, edit, progressive);
            if (!ops.length) notify("Nothing in the selection uses that kind of value.");
            else commit(ops, "Bulk edit");
            setDialog(null);
            focusGrid();
          }}
        />
      )}
      {dialog === "help" && (
        <HelpDialog
          onClose={() => {
            setDialog(null);
            focusGrid();
          }}
        />
      )}

      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-md bg-text px-4 py-2 text-sm text-bg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function cellAt(state: EdState, rows: GridRow[], pos: Pos): EdCell | undefined {
  const row = rows[pos.r];
  const week = state.weeks[pos.c - 1];
  if (row?.kind !== "slot" || !week) return undefined;
  return state.cells[cellKey(row.slotId, week.id)];
}

function DayTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 ${active ? "border-accent bg-accent text-white" : "border-border bg-surface hover:bg-surface-2"}`}
    >
      {children}
    </button>
  );
}

function DayHeader({
  day,
  number,
  count,
  isFirst,
  isLast,
  actions,
}: {
  day: EdState["days"][number];
  number: number;
  count: number;
  isFirst: boolean;
  isLast: boolean;
  actions: {
    rename: (id: string, name: string, weekday: number | null) => void;
    move: (id: string, dir: -1 | 1) => void;
    duplicate: (id: string) => void;
    remove: (id: string) => void;
  };
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-t-lg border-b border-border-strong bg-surface-2 px-4 py-2.5">
      <span className="rounded bg-text px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-bg">Day {number}</span>
      <input
        key={day.name}
        aria-label={`Day ${number} name`}
        className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-base font-semibold outline-none hover:bg-surface focus:bg-surface focus:ring-2 focus:ring-accent/30 sm:max-w-sm"
        defaultValue={day.name}
        placeholder={`Day ${number}`}
        onBlur={(e) => e.target.value.trim() !== day.name && actions.rename(day.id, e.target.value.trim(), day.weekday)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <select
        aria-label={`Day ${number} weekday`}
        className="rounded border border-border bg-surface px-1.5 py-0.5 text-sm"
        value={day.weekday ?? ""}
        onChange={(e) => actions.rename(day.id, day.name, e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">No weekday</option>
        {WEEKDAY_SHORT.map((d, i) => (
          <option key={d} value={i}>
            {d}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted">
        {count} exercise{count === 1 ? "" : "s"}
      </span>
      <div className="ml-auto flex gap-1 text-xs">
        <button className="rounded px-1.5 py-0.5 hover:bg-surface disabled:opacity-30" disabled={isFirst} onClick={() => actions.move(day.id, -1)} title="Move day up">
          ↑
        </button>
        <button className="rounded px-1.5 py-0.5 hover:bg-surface disabled:opacity-30" disabled={isLast} onClick={() => actions.move(day.id, 1)} title="Move day down">
          ↓
        </button>
        <button className="rounded px-1.5 py-0.5 hover:bg-surface" onClick={() => actions.duplicate(day.id)}>
          Duplicate
        </button>
        <button className="rounded px-1.5 py-0.5 hover:bg-bad-soft hover:text-bad" onClick={() => actions.remove(day.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}

function RowCells({
  ri,
  W,
  label,
  isAdd,
  range,
  cursor,
  onMouseDown,
  onDrag,
  onDoubleClick,
  renderCell,
  picker,
}: {
  ri: number;
  W: number;
  label: React.ReactNode;
  isAdd: boolean;
  range: Range;
  cursor: Pos;
  onMouseDown: (e: React.MouseEvent, pos: Pos) => void;
  onDrag: (pos: Pos) => void;
  onDoubleClick: (pos: Pos) => void;
  renderCell: (c: number) => React.ReactNode;
  picker: React.ReactNode;
}) {
  const cls = (c: number) => {
    const active = cursor.r === ri && cursor.c === c;
    const selected = ri >= range.r0 && ri <= range.r1 && c >= range.c0 && c <= range.c1 && !(range.r0 === range.r1 && range.c0 === range.c1);
    return `${active ? "relative z-10 outline outline-2 -outline-offset-2 outline-accent" : ""} ${selected ? "bg-accent-soft/70" : ""}`;
  };
  return (
    <>
      <div
        id={`cell-${ri}-0`}
        role="rowheader"
        className={`relative cursor-pointer border-b border-border px-3 py-2 ${isAdd ? "py-1.5 text-xs" : ""} ${cls(0)}`}
        onMouseDown={(e) => onMouseDown(e, { r: ri, c: 0 })}
        onMouseEnter={(e) => e.buttons === 1 && onDrag({ r: ri, c: 0 })}
        onDoubleClick={() => onDoubleClick({ r: ri, c: 0 })}
      >
        {label}
        {picker}
      </div>
      {Array.from({ length: W }, (_, i) => i + 1).map((c) => (
        <div
          key={c}
          id={`cell-${ri}-${c}`}
          role="gridcell"
          className={`min-w-0 border-b border-l border-border px-3 py-2 ${isAdd ? "bg-surface-2/40" : "cursor-cell"} ${cls(c)}`}
          onMouseDown={(e) => onMouseDown(e, { r: ri, c })}
          onMouseEnter={(e) => e.buttons === 1 && onDrag({ r: ri, c })}
          onDoubleClick={() => onDoubleClick({ r: ri, c })}
        >
          {isAdd ? null : renderCell(c)}
        </div>
      ))}
    </>
  );
}

function CellView({ cell, swapped, exName, date, ctx }: { cell: EdCell; swapped: boolean; exName: Map<string, string>; date: string; ctx: AthleteContext }) {
  const view = useMemo(() => {
    const p = parsePrescription(cell.text);
    if (!p.ok) return null;
    const sugg = ctx.suggestGroups(cell.exerciseId, date, p.groups, { unitOverride: cell.unitOverride });
    return cell.text.split("; ").map((t, i) => ({ t, s: sugg[i] }));
  }, [cell.text, cell.exerciseId, cell.unitOverride, date, ctx]);
  return (
    <div className="space-y-0.5">
      {swapped && <div className="text-xs font-medium text-accent">↳ {exName.get(cell.exerciseId)}</div>}
      {view?.map((g, i) => (
        <div key={i} className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-[13px]">{g.t}</span>
          <span className={`shrink-0 font-mono text-xs ${g.s?.rounded.clamped ? "text-warn" : "text-muted"}`}>{g.s?.text ?? ""}</span>
        </div>
      ))}
      {(cell.loggedSets > 0 || cell.notes) && (
        <div className="flex min-w-0 gap-2 text-[11px]">
          {cell.loggedSets > 0 && <span className="shrink-0 whitespace-nowrap text-ok">logged {cell.loggedSets}</span>}
          {cell.notes && (
            <span className="truncate text-muted" title={cell.notes}>
              ✎ {cell.notes}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CellEditor({
  initial,
  exerciseId,
  date,
  unitOverride,
  ctx,
  onCommit,
  onCancel,
}: {
  initial: string;
  exerciseId: string | null;
  date: string;
  unitOverride: "kg" | "lb" | null;
  ctx: AthleteContext;
  /** Returns an error message to keep the editor open, or null when saved. */
  onCommit: (text: string, dir: "down" | "right" | "left" | "none", fromBlur: boolean) => string | null;
  onCancel: () => void;
}) {
  // Show set groups one per line while editing.
  const [value, setValue] = useState(() => initial.replace(/; /g, "\n"));
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const parsed: ParseResult = useMemo(() => parsePrescription(value), [value]);
  const preview = useMemo(() => {
    if (!parsed.ok || !exerciseId) return [];
    return ctx.suggestGroups(exerciseId, date, parsed.groups, { unitOverride });
  }, [parsed, exerciseId, date, unitOverride, ctx]);

  const finish = (dir: "down" | "right" | "left" | "none", fromBlur: boolean) => {
    if (done.current) return;
    const err = onCommit(value, dir, fromBlur);
    if (err) setError(err);
    else done.current = true;
  };

  return (
    <div onMouseDown={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        aria-label="Prescription"
        className="w-full resize-none rounded border border-accent bg-surface px-1.5 py-1 font-mono text-[13px] outline-none"
        rows={Math.max(1, value.split("\n").length)}
        value={value}
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            finish("down", false);
          } else if (e.key === "Tab") {
            e.preventDefault();
            finish(e.shiftKey ? "left" : "right", false);
          } else if (e.key === "Escape") {
            e.preventDefault();
            done.current = true;
            onCancel();
          }
        }}
        onBlur={() => finish("none", true)}
        onCopy={(e) => e.stopPropagation()}
        onCut={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
      />
      <div className="mt-1 min-h-4 text-[11px]">
        {value.trim() === "" ? (
          <span className="text-muted">Empty: Enter clears the cell</span>
        ) : !parsed.ok ? (
          <span className="text-bad">{error ?? parsed.error}</span>
        ) : error ? (
          <span className="text-bad">{error}</span>
        ) : (
          preview.map((s, i) => (
            <div key={i} className="flex justify-end font-mono text-muted">
              {s?.text ?? ""}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
