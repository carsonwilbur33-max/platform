"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteBlock, duplicateBlock, saveBlockAsTemplate, updateBlockMeta } from "@/app/actions/editor";
import { daysBetween } from "@/lib/dates";
import type { EditorData } from "@/server/editor-data";
import type { useEditor } from "./use-editor";

const KINDS = ["hypertrophy", "strength", "peak", "pivot", "taper", "other"] as const;

export function BlockHeader({
  data,
  ed,
  onHelp,
  onBulk,
  canBulk,
  notify,
}: {
  data: EditorData;
  ed: ReturnType<typeof useEditor>;
  onHelp: () => void;
  onBulk: () => void;
  canBulk: boolean;
  notify: (msg: string) => void;
}) {
  const router = useRouter();
  const [meta, setMeta] = useState({ name: data.block.name, kind: data.block.kind, startDate: data.block.startDate ?? "", notes: data.block.notes });
  const [saved, setSaved] = useState(meta);
  const [busy, start] = useTransition();
  const isTemplate = data.program.isTemplate;

  const saveMeta = (next = meta) => {
    if (JSON.stringify(next) === JSON.stringify(saved)) return;
    start(async () => {
      await ed.flush(); // grid edits first, so the reload below includes them
      const r = await updateBlockMeta(data.block.id, next);
      if (!r.ok) return notify(r.error);
      setSaved(next);
      ed.replace(r.state);
      router.refresh();
    });
  };

  const statusText = { saved: "All changes saved", saving: "Saving…", error: "Not saved" }[ed.status];

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {data.athlete ? (
          <Link href={`/coach/athletes/${data.athlete.id}`} className="hover:text-text">
            ← {data.athlete.name}
          </Link>
        ) : (
          <Link href="/coach/templates" className="hover:text-text">
            ← Templates
          </Link>
        )}
        <span>·</span>
        <span>{isTemplate ? "Template" : data.program.name}</span>
        {data.siblings.length > 1 && (
          <span className="flex gap-1">
            {data.siblings.map((b) => (
              <Link
                key={b.id}
                href={`/coach/blocks/${b.id}`}
                className={`rounded px-1.5 py-0.5 ${b.id === data.block.id ? "bg-text text-bg" : "hover:bg-surface-2"}`}
              >
                {b.name}
              </Link>
            ))}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <input
          aria-label="Block name"
          className="min-w-0 rounded bg-transparent px-1 text-xl font-semibold tracking-tight outline-none hover:bg-surface focus:bg-surface focus:ring-2 focus:ring-accent/30"
          value={meta.name}
          onChange={(e) => setMeta({ ...meta, name: e.target.value })}
          onBlur={() => saveMeta()}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <select
          aria-label="Block type"
          className="rounded border border-border bg-surface px-2 py-1 text-sm"
          value={meta.kind}
          onChange={(e) => {
            const next = { ...meta, kind: e.target.value };
            setMeta(next);
            saveMeta(next);
          }}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        {!isTemplate && (
          <label className="flex items-center gap-2 text-sm text-muted">
            Starts
            <input
              type="date"
              className="rounded border border-border bg-surface px-2 py-1 text-sm text-text"
              value={meta.startDate}
              onChange={(e) => setMeta({ ...meta, startDate: e.target.value })}
              onBlur={() => saveMeta()}
            />
          </label>
        )}
        {data.meet && (
          <span className="rounded-md bg-accent-soft px-2 py-1 text-sm text-accent">
            <strong>{daysBetween(data.today, data.meet.date)}</strong> days to {data.meet.name}
          </span>
        )}
        <span
          role="status"
          className={`ml-auto text-xs ${ed.status === "error" ? "text-bad" : "text-muted"}`}
          data-save-status={ed.status}
        >
          {busy ? "Saving…" : statusText}
        </span>
      </div>

      <input
        aria-label="Block notes"
        className="w-full rounded bg-transparent px-1 text-sm text-muted outline-none placeholder:text-muted/60 hover:bg-surface focus:bg-surface focus:text-text focus:ring-2 focus:ring-accent/30"
        placeholder="Block notes (goal, focus, what to watch)…"
        value={meta.notes}
        onChange={(e) => setMeta({ ...meta, notes: e.target.value })}
        onBlur={() => saveMeta()}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />

      <div className="flex flex-wrap gap-2 text-sm">
        <button className="btn-secondary py-1" disabled={!ed.canUndo} onClick={ed.undo} title={ed.undoLabel ? `Undo: ${ed.undoLabel}` : "Nothing to undo"}>
          ↶ Undo
        </button>
        <button className="btn-secondary py-1" disabled={!ed.canRedo} onClick={ed.redo} title={ed.redoLabel ? `Redo: ${ed.redoLabel}` : "Nothing to redo"}>
          ↷ Redo
        </button>
        <button className="btn-secondary py-1" disabled={!canBulk} onClick={onBulk} title="Select cells first">
          Bulk edit…
        </button>
        <span className="mx-1 w-px bg-border" />
        <button
          className="btn-secondary py-1"
          onClick={() =>
            start(async () => {
              await ed.flush();
              const r = await duplicateBlock(data.block.id);
              if (!r.ok) return notify(r.error);
              router.push(`/coach/blocks/${r.blockId}`);
            })
          }
        >
          Duplicate block
        </button>
        {!isTemplate && (
          <button
            className="btn-secondary py-1"
            onClick={() => {
              const name = prompt("Template name", meta.name);
              if (name === null) return;
              start(async () => {
                await ed.flush();
                const r = await saveBlockAsTemplate(data.block.id, name);
                if (!r.ok) return notify(r.error);
                notify(`Saved template “${name || "Untitled template"}”. Find it under Templates.`);
              });
            }}
          >
            Save as template
          </button>
        )}
        <button
          className="btn-secondary py-1 hover:text-bad"
          onClick={() => {
            if (!confirm(`Delete “${meta.name}”? This can't be undone.`)) return;
            start(async () => {
              await ed.flush();
              const r = await deleteBlock(data.block.id);
              if (!r.ok) return notify(r.error);
              router.push(r.athleteId ? `/coach/athletes/${r.athleteId}` : "/coach/templates");
            });
          }}
        >
          Delete block
        </button>
        <button className="btn-secondary ml-auto py-1" onClick={onHelp}>
          Shortcuts <kbd className="ml-1 rounded border border-border px-1 text-xs">?</kbd>
        </button>
      </div>
    </div>
  );
}
