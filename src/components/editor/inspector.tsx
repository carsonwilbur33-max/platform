"use client";

import { useState } from "react";
import type { ExerciseModifiers } from "@/lib/calc/prescription";
import { parsePrescription } from "@/lib/calc/shorthand";
import { fmtNum, fromKg } from "@/lib/calc/units";
import { formatShortDate } from "@/lib/dates";
import { opsSetMeta } from "@/lib/editor/commands";
import type { Op } from "@/lib/editor/ops";
import { cellKey, loggedInSlot, type EdState } from "@/lib/editor/state";
import type { AthleteContext } from "@/lib/program/athlete-context";
import type { LibraryExercise } from "@/server/editor-data";
import { ExercisePicker } from "./exercise-picker";

export function parseRest(v: string): number | null | "invalid" {
  const s = v.trim();
  if (!s) return null;
  const m = s.match(/^(\d+):([0-5]\d)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(s.replace(/min$/i, "").trim());
  if (Number.isFinite(n) && n >= 0 && n <= 60) return Math.round(n * 60); // minutes
  return "invalid";
}

export function formatRest(sec: number | null): string {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}:${String(s).padStart(2, "0")}` : `${m}`;
}

export function Inspector({
  state,
  slotId,
  weekId,
  dayLabel,
  date,
  library,
  ctx,
  hasAthlete,
  commit,
  onCreateExercise,
  onClose,
  panelRef,
}: {
  state: EdState;
  slotId: string | null;
  weekId: string | null;
  dayLabel: string;
  date: string | null;
  library: LibraryExercise[];
  ctx: AthleteContext;
  hasAthlete: boolean;
  commit: (ops: Op[], label: string) => boolean;
  onCreateExercise: (name: string) => Promise<LibraryExercise | null>;
  onClose: () => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [allWeeks, setAllWeeks] = useState(true);
  const [swapping, setSwapping] = useState(false);
  const exName = (id: string | null | undefined) => library.find((e) => e.id === id)?.name ?? "—";

  if (!slotId) {
    return (
      <Panel panelRef={panelRef}>
        <p className="text-sm text-muted">Select an exercise row or cell to see its details here.</p>
      </Panel>
    );
  }
  const slot = state.days.flatMap((d) => d.slots).find((s) => s.id === slotId);
  const rowCells = state.weeks.map((w) => state.cells[cellKey(slotId, w.id)]).filter(Boolean);
  const cell = weekId ? state.cells[cellKey(slotId, weekId)] : rowCells[0];
  const weekNo = weekId ? state.weeks.findIndex((w) => w.id === weekId) + 1 : null;
  const scopeWeek = weekId && !allWeeks ? weekId : null;
  const apply = (patch: Parameters<typeof opsSetMeta>[3], label: string) => commit(opsSetMeta(state, slotId, scopeWeek, patch), label);
  const logged = weekId ? (cell?.loggedSets ?? 0) : loggedInSlot(state, slotId);

  return (
    <Panel panelRef={panelRef} onClose={onClose}>
      <div className="mb-3">
        <div className="text-xs uppercase tracking-wide text-muted">
          {dayLabel}
          {weekNo ? ` · Week ${weekNo}` : " · whole row"}
          {date && weekNo ? ` · ${formatShortDate(date)}` : ""}
        </div>
        <div className="font-semibold">{exName(slot?.exerciseId)}</div>
      </div>

      {!cell ? (
        <p className="text-sm text-muted">{weekId ? "Empty this week. Type a prescription in the cell to add it." : "No weeks filled in yet."}</p>
      ) : (
        <div className="space-y-4 text-sm" key={`${cell.id}:${scopeWeek ?? "all"}`}>
          {weekId && (
            <section>
              <div className="label">This week&apos;s exercise</div>
              <div className="relative flex items-center gap-2">
                <span className={cell.exerciseId !== slot?.exerciseId ? "font-medium text-accent" : ""}>{exName(cell.exerciseId)}</span>
                <button className="ml-auto text-xs text-accent hover:underline" onClick={() => setSwapping(true)}>
                  Swap
                </button>
                {cell.exerciseId !== slot?.exerciseId && slot?.exerciseId && (
                  <button
                    className="text-xs text-muted hover:underline"
                    onClick={() => commit(opsSetMeta(state, slotId, weekId, { exerciseId: slot.exerciseId! }), "Undo swap")}
                  >
                    Reset
                  </button>
                )}
                {swapping && (
                  <ExercisePicker
                    library={library}
                    placeholder="Swap to…"
                    onCancel={() => setSwapping(false)}
                    onCreate={onCreateExercise}
                    onPick={(e) => {
                      setSwapping(false);
                      commit(opsSetMeta(state, slotId, weekId, { exerciseId: e.id }), `Swap to ${e.name}`);
                    }}
                  />
                )}
              </div>
              <Prescription text={cell.text} exerciseId={cell.exerciseId} date={date} ctx={ctx} unitOverride={cell.unitOverride} hasAthlete={hasAthlete} />
            </section>
          )}

          {weekId && (
            <fieldset className="flex gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input type="radio" checked={allWeeks} onChange={() => setAllWeeks(true)} /> Changes apply to all weeks
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={!allWeeks} onChange={() => setAllWeeks(false)} /> this week only
              </label>
            </fieldset>
          )}

          <Modifiers value={cell.modifiers} onChange={(m) => apply({ modifiers: m }, "Edit modifiers")} />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="insp-rest">
                Rest (min or m:ss)
              </label>
              <RestInput value={cell.restSeconds} onChange={(v) => apply({ restSeconds: v }, "Edit rest")} />
            </div>
            <div>
              <label className="label" htmlFor="insp-unit">
                Unit
              </label>
              <select
                id="insp-unit"
                className="input"
                value={cell.unitOverride ?? ""}
                onChange={(e) => apply({ unitOverride: (e.target.value || null) as "kg" | "lb" | null }, "Edit unit")}
              >
                <option value="">Athlete default</option>
                <option value="kg">kg</option>
                <option value="lb">lb</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="insp-notes">
              Coach notes
            </label>
            <textarea
              id="insp-notes"
              className="input min-h-20"
              defaultValue={cell.notes}
              onBlur={(e) => e.target.value !== cell.notes && apply({ notes: e.target.value }, "Edit notes")}
            />
          </div>

          {logged > 0 && (
            <p className="rounded-md bg-surface-2 px-2 py-1.5 text-xs text-muted">
              {logged} logged set{logged === 1 ? "" : "s"}. Edits keep them attached; the athlete&apos;s view compares against what was prescribed when they logged.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

function Panel({ children, onClose, panelRef }: { children: React.ReactNode; onClose?: () => void; panelRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="card relative p-4 outline-none"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && onClose) {
          (document.activeElement as HTMLElement | null)?.blur();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

function Prescription({
  text,
  exerciseId,
  date,
  ctx,
  unitOverride,
  hasAthlete,
}: {
  text: string;
  exerciseId: string;
  date: string | null;
  ctx: AthleteContext;
  unitOverride: "kg" | "lb" | null;
  hasAthlete: boolean;
}) {
  const p = parsePrescription(text);
  if (!p.ok) return null;
  const d = date ?? "9999-12-31";
  const sugg = ctx.suggestGroups(exerciseId, d, p.groups, { unitOverride });
  const tm = ctx.tmFor(exerciseId, d);
  const unit = ctx.unitFor(exerciseId, unitOverride);
  return (
    <div className="mt-2 rounded-md bg-surface-2 p-2">
      {p.groups.map((g, i) => (
        <div key={i} className="flex justify-between font-mono text-xs">
          <span>{text.split("; ")[i]}</span>
          <span className="text-muted">{sugg[i]?.text ?? ""}</span>
        </div>
      ))}
      {hasAthlete && (
        <div className="mt-1 text-[11px] text-muted">{tm ? `TM ${fmtNum(fromKg(tm, unit), 1)} ${unit}` : "No training max for this exercise"}</div>
      )}
    </div>
  );
}

function Modifiers({ value, onChange }: { value: ExerciseModifiers; onChange: (m: ExerciseModifiers) => void }) {
  const set = (k: keyof ExerciseModifiers, v: string | boolean | undefined) => {
    const next = { ...value } as Record<string, unknown>;
    if (v === undefined || v === "") delete next[k];
    else next[k] = v;
    if (JSON.stringify(next) !== JSON.stringify(value)) onChange(next as ExerciseModifiers);
  };
  const text = (k: "pause" | "tempo" | "pins" | "other", label: string, placeholder: string) => (
    <div>
      <label className="label" htmlFor={`insp-${k}`}>
        {label}
      </label>
      <input id={`insp-${k}`} className="input" defaultValue={value[k] ?? ""} placeholder={placeholder} onBlur={(e) => set(k, e.target.value.trim())} />
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-2">
      {text("pause", "Pause", "e.g. 2s")}
      {text("tempo", "Tempo", "e.g. 3-1-0")}
      {text("pins", "Pin height", "e.g. knee")}
      <div>
        <label className="label" htmlFor="insp-belt">
          Belt
        </label>
        <select
          id="insp-belt"
          className="input"
          value={value.belt === undefined ? "" : value.belt ? "yes" : "no"}
          onChange={(e) => set("belt", e.target.value === "" ? undefined : e.target.value === "yes")}
        >
          <option value="">—</option>
          <option value="yes">Belt</option>
          <option value="no">No belt</option>
        </select>
      </div>
      <div className="col-span-2">{text("other", "Other modifier", "e.g. 2 in deficit, SSB")}</div>
    </div>
  );
}

function RestInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [error, setError] = useState(false);
  return (
    <>
      <input
        id="insp-rest"
        className={`input ${error ? "border-bad" : ""}`}
        defaultValue={formatRest(value)}
        placeholder="e.g. 3 or 2:30"
        onBlur={(e) => {
          const v = parseRest(e.target.value);
          setError(v === "invalid");
          if (v !== "invalid" && v !== value) onChange(v);
        }}
      />
      {error && <p className="mt-1 text-xs text-bad">Use minutes (3) or m:ss (2:30).</p>}
    </>
  );
}
