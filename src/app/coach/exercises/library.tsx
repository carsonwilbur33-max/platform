"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createExercise, setExerciseArchived, updateExercise } from "@/app/actions/editor";
import { FormError } from "@/components/forms";
import { fmtNum } from "@/lib/calc/units";

const CATEGORIES = ["squat", "bench", "deadlift", "upper", "lower", "core", "other"] as const;

interface Ex {
  id: string;
  name: string;
  category: string;
  parentId: string | null;
  defaultTmRatio: number | null;
  isCustom: boolean;
  archived: boolean;
}

export function ExerciseLibrary({ exercises }: { exercises: Ex[] }) {
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const parents = exercises.filter((e) => !e.parentId && !e.archived);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = exercises.filter((e) => (showArchived || !e.archived) && words.every((w) => e.name.toLowerCase().includes(w)));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold">Exercise library</h1>
          <input className="input max-w-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search exercises" />
          <label className="flex items-center gap-1.5 text-sm text-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
        </div>
        <p className="mb-3 text-sm text-muted">
          Variations can take their training max from a parent lift × ratio (e.g. Pause Squat = 90% of Squat). Athletes can override the ratio on
          their page. Archived exercises are hidden from the picker but stay in existing programs.
        </p>
        <div className="space-y-5">
          {CATEGORIES.map((cat) => {
            const list = shown.filter((e) => e.category === cat);
            if (!list.length) return null;
            return (
              <div key={cat}>
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{cat}</h2>
                <div className="card divide-y divide-border">
                  {list.map((e) =>
                    editing === e.id ? (
                      <div key={e.id} className="p-3">
                        <ExerciseForm initial={e} parents={parents.filter((p) => p.id !== e.id)} onDone={() => setEditing(null)} />
                      </div>
                    ) : (
                      <div key={e.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${e.archived ? "opacity-50" : ""}`}>
                        <div className="min-w-0 flex-1">
                          <span className="font-medium">{e.name}</span>
                          {e.isCustom && <span className="ml-2 rounded bg-surface-2 px-1 text-[11px] text-muted">custom</span>}
                          {e.parentId && (
                            <span className="ml-2 text-xs text-muted">
                              variation of {byId.get(e.parentId)?.name}
                              {e.defaultTmRatio ? ` · TM ${fmtNum(e.defaultTmRatio * 100, 1)}%` : ""}
                            </span>
                          )}
                        </div>
                        <button className="text-xs text-accent hover:underline" onClick={() => setEditing(e.id)}>
                          Edit
                        </button>
                        <ArchiveButton id={e.id} archived={e.archived} />
                      </div>
                    ),
                  )}
                </div>
              </div>
            );
          })}
          {shown.length === 0 && <p className="text-sm text-muted">No matches.</p>}
        </div>
      </section>
      <aside>
        <h2 className="mb-4 text-lg font-semibold">Add exercise</h2>
        <div className="card p-4">
          <ExerciseForm parents={parents} />
        </div>
      </aside>
    </div>
  );
}

function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      className="text-xs text-muted hover:text-text"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setExerciseArchived(id, !archived);
          router.refresh();
        })
      }
    >
      {archived ? "Restore" : "Archive"}
    </button>
  );
}

function ExerciseForm({ initial, parents, onDone }: { initial?: Ex; parents: Ex[]; onDone?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [key, setKey] = useState(0);
  return (
    <form
      key={key}
      className="grid gap-2 sm:grid-cols-2"
      action={(fd) =>
        start(async () => {
          setError(undefined);
          const data = Object.fromEntries(fd);
          const r = initial ? await updateExercise(initial.id, data) : await createExercise(data);
          if (!r.ok) return setError(r.error);
          router.refresh();
          if (onDone) onDone();
          else setKey((k) => k + 1);
        })
      }
    >
      <div className="sm:col-span-2">
        <label className="label">Name</label>
        <input name="name" className="input" defaultValue={initial?.name} required />
      </div>
      <div>
        <label className="label">Category</label>
        <select name="category" className="input" defaultValue={initial?.category ?? "other"}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Variation of</label>
        <select name="parentId" className="input" defaultValue={initial?.parentId ?? ""}>
          <option value="">— none —</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">TM ratio to parent (%)</label>
        <input
          name="defaultTmRatio"
          className="input"
          type="number"
          step="0.5"
          min="1"
          max="200"
          defaultValue={initial?.defaultTmRatio ? fmtNum(initial.defaultTmRatio * 100, 1) : ""}
          placeholder="e.g. 90"
        />
      </div>
      <div className="flex items-end gap-2">
        <button className="btn-primary" disabled={pending}>
          {initial ? "Save" : "Add"}
        </button>
        {onDone && (
          <button type="button" className="btn-secondary" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
      <div className="sm:col-span-2">
        <FormError error={error} />
      </div>
    </form>
  );
}
