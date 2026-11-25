"use client";

import { useEffect, useRef, useState } from "react";
import { BULK_EDIT_LABELS, type BulkEdit, type BulkEditKind } from "@/lib/calc/bulk-edit";
import type { Unit } from "@/lib/calc/units";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, select, button")?.focus();
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      onMouseDown={onClose}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="card w-full max-w-lg p-5 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <button className="text-muted hover:text-text" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function BulkEditDialog({
  cellCount,
  weekCount,
  defaultUnit,
  onApply,
  onClose,
}: {
  cellCount: number;
  weekCount: number;
  defaultUnit: Unit;
  onApply: (edit: BulkEdit, progressive: boolean) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<BulkEditKind>("pct");
  const [amount, setAmount] = useState("2.5");
  const [unit, setUnit] = useState<Unit>(defaultUnit);
  const [progressive, setProgressive] = useState(weekCount > 1);
  const n = Number(amount);
  return (
    <Modal title="Bulk edit selection" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!Number.isFinite(n) || n === 0) return;
          onApply({ kind, amount: n, unit }, progressive);
        }}
      >
        <p className="text-sm text-muted">
          {cellCount} filled cell{cellCount === 1 ? "" : "s"} across {weekCount} week{weekCount === 1 ? "" : "s"}.
        </p>
        <div className="grid grid-cols-[1fr_110px_80px] gap-2">
          <div>
            <label className="label" htmlFor="bulk-kind">
              Change
            </label>
            <select id="bulk-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as BulkEditKind)}>
              {Object.entries(BULK_EDIT_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="bulk-amount">
              By
            </label>
            <input id="bulk-amount" className="input" type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="bulk-unit">
              Unit
            </label>
            <select id="bulk-unit" className="input" value={unit} disabled={kind !== "load"} onChange={(e) => setUnit(e.target.value as Unit)}>
              <option value="kg">kg</option>
              <option value="lb">lb</option>
            </select>
          </div>
        </div>
        <fieldset className="space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={progressive} onChange={() => setProgressive(true)} disabled={weekCount < 2} />
            Progressive: first selected week unchanged, then {amount || "…"} more each week
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={!progressive} onChange={() => setProgressive(false)} />
            Same change in every selected week
          </label>
        </fieldset>
        <p className="text-xs text-muted">Use a negative number to decrease. RPE snaps to 0.5 steps. Sets and reps never drop below 1. One undo reverts it all.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!Number.isFinite(n) || n === 0}>
            Apply
          </button>
        </div>
      </form>
    </Modal>
  );
}

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

export const SHORTCUTS: [string, string][] = [
  ["Arrows · Tab · Shift+Tab", "Move between cells"],
  ["Type anything", "Start writing in the cell (replaces it)"],
  ["Enter · F2", "Edit cell / pick exercise"],
  ["Enter (while editing)", "Save and move down"],
  ["Tab (while editing)", "Save and move right"],
  ["Shift+Enter (while editing)", "New set group (line)"],
  ["Esc", "Cancel edit / clear selection"],
  ["Shift+Arrows · Shift+click · drag", "Select a range"],
  ["Delete · Backspace", "Clear selected cells (on the exercise column: delete row)"],
  [`${MOD}+C · ${MOD}+X · ${MOD}+V`, "Copy · cut · paste (also to/from Google Sheets)"],
  [`${MOD}+R`, "Fill right (copy previous week across the selection)"],
  [`${MOD}+B`, "Bulk edit selection (e.g. +2.5% per week)"],
  [`${MOD}+Enter`, "Insert a row below"],
  ["Alt+↑ · Alt+↓", "Move row up / down"],
  [`${MOD}+I`, "Edit details (swap, modifiers, rest, notes) in the side panel"],
  [`${MOD}+Z · ${MOD}+Shift+Z`, "Undo · redo"],
  ["?", "This help"],
];

export const SHORTHAND: [string, string][] = [
  ["3x5 @8", "RPE"],
  ["3x6-8 @7-8", "Rep and RPE ranges"],
  ["3x5 rir1-2", "RIR"],
  ["4x6 72-77%", "% of training max"],
  ["3x5 180kg · 3x10 70-80lb", "Fixed load"],
  ["3x5 @7-7.5 [175-180kg]", "Target + hard bound in [ ]"],
  ["top 1 @8", "Work up to a top single"],
  ["4x4 -8%", "Backoff: % drop from today's top set"],
  ["3x3 80%e1rm", "Backoff: % of today's top-set e1RM"],
  ["4 -8% until @9 max6", "Repeat sets until RPE 9 (cap 6)"],
  ["1xAMRAP 80% @9", "AMRAP, stop at RPE 9"],
  ["top 1 @8; 4x4 -8%", "Several set groups (; or Shift+Enter)"],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard & shorthand" onClose={onClose}>
      <div className="grid gap-5 text-sm sm:grid-cols-2">
        <table>
          <tbody>
            {SHORTCUTS.map(([k, v]) => (
              <tr key={k} className="align-top">
                <td className="whitespace-nowrap py-0.5 pr-3 font-mono text-xs">{k}</td>
                <td className="py-0.5 text-muted">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <tbody>
            {SHORTHAND.map(([k, v]) => (
              <tr key={k} className="align-top">
                <td className="whitespace-nowrap py-0.5 pr-3 font-mono text-xs">{k}</td>
                <td className="py-0.5 text-muted">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
