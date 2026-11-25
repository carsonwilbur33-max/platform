"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { addSessionNote, completeSession, logSet, removeSessionNote, removeSet, saveSessionNotes } from "@/app/actions/logging";
import type { Deviation } from "@/lib/calc/deviation";
import { findTopSetGroup } from "@/lib/calc/load";
import { formatModifiers } from "@/lib/calc/prescription";
import { clean, fmtNum, fromKg, type Unit } from "@/lib/calc/units";
import { addDays, formatShortDate } from "@/lib/dates";
import { newId } from "@/lib/editor/new-id";
import { describeTarget, pickTopSet, repeatUntilDone, RPE_OPTIONS, setRows, type SetRow } from "@/lib/logging/session";
import { AthleteContext } from "@/lib/program/athlete-context";
import type { LoggedSetDTO, NoteDTO, SessionData, SessionExercise } from "@/server/logging";

const NOTE_KINDS: { kind: NoteDTO["kind"]; label: string }[] = [
  { kind: "pain", label: "Report pain" },
  { kind: "missed_reps", label: "Missed reps" },
  { kind: "note", label: "Note to coach" },
];

const DEVIATION_LABEL: Record<Deviation["kind"], string> = {
  rpe_high: "RPE above target",
  rpe_low: "RPE below target",
  load_high: "Heavier than prescribed",
  load_low: "Lighter than prescribed",
  reps_low: "Fewer reps",
  reps_high: "More reps",
};

/** Device-local date, so "today" matches the athlete's phone, not the server. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function relativeDay(date: string | null, today: string): string {
  if (!date) return "Unscheduled";
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  if (date === addDays(today, 1)) return "Tomorrow";
  return formatShortDate(date);
}

export function SessionLogger({ data, heading }: { data: SessionData; heading?: string }) {
  const [logged, setLogged] = useState<LoggedSetDTO[]>(data.logged);
  const [notes, setNotes] = useState<NoteDTO[]>(data.notes);
  const [completed, setCompleted] = useState(data.workout.completed);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(localToday()), []);
  const ctx = useMemo(() => new AthleteContext(data.ctx.athlete, data.ctx.exercises, data.ctx.tms, data.ctx.settings, data.ctx.chart), [data.ctx]);
  const date = data.workout.plannedDate ?? today ?? "2000-01-01";

  // Substitutions: from sets already logged with a different exercise.
  const [subs, setSubs] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const e of data.exercises) {
      const other = data.logged.find((l) => l.plannedExerciseId === e.plannedExerciseId && l.exerciseId !== e.exerciseId);
      if (other) m[e.plannedExerciseId] = other.exerciseId;
    }
    return m;
  });
  // Unprescribed exercises: one card per exercise logged without a plan, plus ones added now.
  const [extras, setExtras] = useState<string[]>(() => [...new Set(data.logged.filter((l) => !l.plannedExerciseId).map((l) => l.exerciseId))]);

  const upsert = (s: LoggedSetDTO) => setLogged((list) => [...list.filter((l) => l.id !== s.id), s]);

  const save = async (input: Record<string, unknown>): Promise<boolean> => {
    setError(null);
    const r = await logSet({ workoutId: data.workout.id, videoUrl: null, notes: "", ...input });
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    upsert(r.value);
    return true;
  };
  const del = async (id: string) => {
    const r = await removeSet(id);
    if (!r.ok) return setError(r.error);
    setLogged((l) => l.filter((x) => x.id !== id));
  };

  const totalSets = logged.length;
  const flagged = logged.filter((l) => l.deviations.length).length;

  return (
    <div className="space-y-4 pb-24">
      <header>
        <div className="text-xs uppercase tracking-wide text-muted">
          {heading ?? (today ? relativeDay(data.workout.plannedDate, today) : " ")}
        </div>
        <h1 className="text-xl font-semibold leading-tight">{data.workout.dayName || `Day ${data.workout.dayNumber}`}</h1>
        <div className="text-sm text-muted">
          {data.workout.blockName} · week {data.workout.weekNumber} · day {data.workout.dayNumber}
          {data.workout.plannedDate && ` · ${formatShortDate(data.workout.plannedDate)}`}
        </div>
      </header>

      {completed && (
        <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
          <span className="text-ok">
            ✓ Session complete · {totalSets} sets ·{" "}
            <Link href="/athlete" className="underline">
              what&apos;s next
            </Link>
          </span>
          <button
            className="text-xs text-muted underline"
            onClick={async () => {
              const r = await completeSession(data.workout.id, false);
              if (r.ok) setCompleted(false);
            }}
          >
            Reopen
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      {data.exercises.map((ex) => (
        <ExerciseCard
          key={ex.plannedExerciseId}
          ex={ex}
          ctx={ctx}
          date={date}
          logged={logged.filter((l) => l.plannedExerciseId === ex.plannedExerciseId)}
          performedId={subs[ex.plannedExerciseId] ?? ex.exerciseId}
          names={data.names}
          library={data.library}
          onSwap={(id) => setSubs((s) => ({ ...s, [ex.plannedExerciseId]: id }))}
          save={save}
          del={del}
        />
      ))}

      {extras.map((exerciseId) => (
        <ExtraExerciseCard
          key={exerciseId}
          exerciseId={exerciseId}
          name={data.names[exerciseId] ?? "Exercise"}
          unit={ctx.unitFor(exerciseId)}
          increment={ctx.incrementFor(exerciseId, ctx.unitFor(exerciseId))}
          logged={logged.filter((l) => !l.plannedExerciseId && l.exerciseId === exerciseId)}
          save={save}
          del={del}
        />
      ))}
      <AddExercise library={data.library} onAdd={(id) => setExtras((x) => (x.includes(id) ? x : [...x, id]))} />

      <SessionNotes
        workoutId={data.workout.id}
        initial={data.workout.athleteNotes}
        notes={notes}
        onAdd={(n) => setNotes((list) => [...list, n])}
        onDelete={(id) => setNotes((list) => list.filter((n) => n.id !== id))}
      />

      {!completed && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
            <span className="text-sm text-muted">
              {totalSets} set{totalSets === 1 ? "" : "s"} logged
              {flagged ? ` · ${flagged} flagged` : ""}
            </span>
            <button
              className="btn-primary"
              onClick={async () => {
                const r = await completeSession(data.workout.id, true);
                if (!r.ok) return setError(r.error);
                setCompleted(true);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Finish session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ExerciseCard({
  ex,
  ctx,
  date,
  logged,
  performedId,
  names,
  library,
  onSwap,
  save,
  del,
}: {
  ex: SessionExercise;
  ctx: AthleteContext;
  date: string;
  logged: LoggedSetDTO[];
  performedId: string;
  names: Record<string, string>;
  library: { id: string; name: string }[];
  onSwap: (exerciseId: string) => void;
  save: (input: Record<string, unknown>) => Promise<boolean>;
  del: (id: string) => Promise<void>;
}) {
  const [swapping, setSwapping] = useState(false);
  const [extraRows, setExtraRows] = useState<Record<string, number>>({});
  const unit = ctx.unitFor(performedId, ex.unitOverride);
  const increment = ctx.incrementFor(performedId, unit);
  const groups = ex.groups.map((g) => g.prescription);
  const byGroup = (gid: string) => logged.filter((l) => l.setGroupId === gid).sort((a, b) => a.setIndex - b.setIndex);
  const swapped = performedId !== ex.exerciseId;

  // Suggested loads: backoffs follow the top set actually logged today.
  const suggestions = ex.groups.map((g, gi) => {
    const top = findTopSetGroup(groups, gi);
    const topGroupId = top ? ex.groups[groups.indexOf(top)].id : null;
    const actualTopSet = topGroupId ? pickTopSet(byGroup(topGroupId)) : null;
    return ctx.suggestGroups(ex.exerciseId, date, groups, { unitOverride: ex.unitOverride, actualTopSet })[gi];
  });
  const mods = formatModifiers(ex.modifiers);
  const unlogged = logged.filter((l) => !l.setGroupId);

  return (
    <section className="card overflow-hidden" aria-label={names[performedId] ?? ex.exerciseName}>
      <div className="border-b border-border bg-surface-2 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold leading-tight">{swapped ? names[performedId] : ex.exerciseName}</h2>
            {swapped && <div className="text-xs text-warn">instead of {ex.exerciseName}</div>}
            {(mods || ex.restSeconds) && (
              <div className="text-xs text-muted">
                {[mods, ex.restSeconds ? `rest ${fmtNum(ex.restSeconds / 60, 1)} min` : ""].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
          <button className="shrink-0 text-xs text-accent" onClick={() => setSwapping((s) => !s)}>
            {swapping ? "Cancel" : "Swap"}
          </button>
        </div>
        {swapping && (
          <ExerciseSearch
            library={library}
            placeholder="Swap to…"
            onPick={(id) => {
              onSwap(id);
              setSwapping(false);
            }}
            extra={swapped ? { label: `Back to ${ex.exerciseName}`, id: ex.exerciseId } : undefined}
          />
        )}
        {ex.notes && <p className="mt-1.5 rounded bg-surface px-2 py-1 text-xs">{ex.notes}</p>}
      </div>

      <div className="divide-y divide-border">
        {ex.groups.map((g, gi) => {
          const done = byGroup(g.id);
          const rows: SetRow[] = setRows(g.prescription, done);
          const extra = extraRows[g.id] ?? 0;
          for (let i = 0; i < extra; i++) rows.push({ index: rows.length, kind: "extra", label: `Set ${rows.length + 1} (extra)` });
          const sugg = suggestions[gi];
          const finished = repeatUntilDone(g.prescription, done);
          return (
            <div key={g.id} className="px-3 py-2.5">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-medium">{g.text}</span>
                {sugg && (
                  <span className={`shrink-0 font-mono text-sm ${sugg.rounded.clamped ? "text-warn" : "text-accent"}`}>{sugg.text}</span>
                )}
              </div>
              <p className="mb-2 text-xs text-muted">{describeTarget(g.prescription)}</p>
              <div className="space-y-1.5">
                {rows.map((row) => {
                  const entry = done.find((d) => d.setIndex === row.index);
                  const nextOpen = rows.find((r) => !done.some((d) => d.setIndex === r.index))?.index;
                  const prev = done.filter((d) => d.setIndex < row.index).at(-1);
                  const defaultWeight = prev
                    ? prev.unitEntered === unit
                      ? prev.weightEntered
                      : clean(fromKg(prev.weightKg, unit), 1)
                    : sugg
                      ? sugg.rounded.min
                      : null;
                  const defaultReps = g.prescription.reps === "amrap" ? null : g.prescription.reps.max;
                  return (
                    <SetLine
                      key={`${row.index}-${entry?.id ?? "new"}-${prev?.id ?? ""}`}
                      startOpen={row.index === nextOpen}
                      label={row.label}
                      optional={row.kind === "optional"}
                      entry={entry}
                      unit={unit}
                      increment={increment}
                      defaultWeight={defaultWeight}
                      defaultReps={defaultReps}
                      defaultRpe={null}
                      onSave={(v) =>
                        save({
                          id: entry?.id ?? newId(),
                          plannedExerciseId: ex.plannedExerciseId,
                          setGroupId: g.id,
                          exerciseId: performedId,
                          setIndex: row.index,
                          ...v,
                        })
                      }
                      onDelete={entry ? () => del(entry.id) : undefined}
                    />
                  );
                })}
              </div>
              {finished && <p className="mt-1.5 text-xs text-ok">Reached RPE {g.prescription.repeatUntilRpe}{g.prescription.maxSets && done.length >= g.prescription.maxSets ? " or the set cap" : ""}: done.</p>}
              {g.prescription.mode !== "repeatUntil" && (
                <button className="mt-1.5 text-xs text-muted underline" onClick={() => setExtraRows((m) => ({ ...m, [g.id]: (m[g.id] ?? 0) + 1 }))}>
                  + Add a set
                </button>
              )}
            </div>
          );
        })}
        {unlogged.length > 0 && (
          <div className="px-3 py-2 text-xs text-muted">
            {unlogged.length} extra set{unlogged.length === 1 ? "" : "s"} logged outside the plan.
          </div>
        )}
      </div>
    </section>
  );
}

function ExtraExerciseCard({
  exerciseId,
  name,
  unit,
  increment,
  logged,
  save,
  del,
}: {
  exerciseId: string;
  name: string;
  unit: Unit;
  increment: number;
  logged: LoggedSetDTO[];
  save: (input: Record<string, unknown>) => Promise<boolean>;
  del: (id: string) => Promise<void>;
}) {
  const sorted = [...logged].sort((a, b) => a.setIndex - b.setIndex);
  // Always one empty row ready for the next set, plus any the athlete added.
  const [added, setAdded] = useState(0);
  const count = sorted.length + 1 + added;
  return (
    <section className="card overflow-hidden" aria-label={name}>
      <div className="border-b border-border bg-surface-2 px-3 py-2.5">
        <h2 className="font-semibold">{name}</h2>
        <div className="text-xs text-muted">Added by you (not in the plan)</div>
      </div>
      <div className="space-y-1.5 px-3 py-2.5">
        {Array.from({ length: count }, (_, i) => {
          const entry = sorted[i];
          const prev = sorted[i - 1];
          return (
            <SetLine
              key={`${i}-${entry?.id ?? "new"}-${prev?.id ?? ""}`}
              startOpen={i === sorted.length}
              label={`Set ${i + 1}`}
              entry={entry}
              unit={unit}
              increment={increment}
              defaultWeight={prev?.weightEntered ?? null}
              defaultReps={prev?.reps ?? null}
              defaultRpe={null}
              onSave={(v) => save({ id: entry?.id ?? newId(), plannedExerciseId: null, setGroupId: null, exerciseId, setIndex: entry?.setIndex ?? i, ...v })}
              onDelete={entry ? () => del(entry.id) : undefined}
            />
          );
        })}
        <button className="text-xs text-muted underline" onClick={() => setAdded((n) => n + 1)}>
          + Add a set
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

interface SetValues {
  weight: number;
  unit: Unit;
  reps: number;
  rpe: number | null;
  videoUrl: string | null;
  notes: string;
}

function SetLine({
  startOpen = true,
  label,
  optional,
  entry,
  unit,
  increment,
  defaultWeight,
  defaultReps,
  defaultRpe,
  onSave,
  onDelete,
}: {
  label: string;
  optional?: boolean;
  entry?: LoggedSetDTO;
  unit: Unit;
  increment: number;
  defaultWeight: number | null;
  defaultReps: number | null;
  defaultRpe: number | null;
  onSave: (v: SetValues) => Promise<boolean>;
  onDelete?: () => Promise<void>;
  /** Unlogged rows other than the next one start collapsed to keep the page short. */
  startOpen?: boolean;
}) {
  const [editing, setEditing] = useState(!entry && startOpen);
  const [more, setMore] = useState(false);
  const entryUnit = entry?.unitEntered ?? unit;
  const [weight, setWeight] = useState(entry ? String(entry.weightEntered) : defaultWeight != null ? String(defaultWeight) : "");
  const [reps, setReps] = useState(entry ? String(entry.reps) : defaultReps != null ? String(defaultReps) : "");
  const [rpe, setRpe] = useState(entry?.rpe != null ? String(entry.rpe) : defaultRpe != null ? String(defaultRpe) : "");
  const [video, setVideo] = useState(entry?.videoUrl ?? "");
  const [note, setNote] = useState(entry?.notes ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (!entry && !editing) {
    return (
      <button
        className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm ${optional ? "border-dashed border-border" : "border-border"}`}
        onClick={() => setEditing(true)}
        aria-label={`${label}: tap to log`}
      >
        <span className="w-24 shrink-0 text-xs text-muted">{label}</span>
        <span className="font-mono text-muted">
          {weight !== "" ? `${weight} ${unit}` : ""}
          {reps !== "" ? ` × ${reps}` : ""}
        </span>
        <span className="ml-auto text-xs text-accent">Log</span>
      </button>
    );
  }

  if (entry && !editing) {
    const hard = entry.deviations.some((d) => d.hardBound);
    return (
      <button
        className="w-full rounded-md bg-surface-2 px-2.5 py-2 text-left"
        onClick={() => setEditing(true)}
        aria-label={`${label}: ${entry.weightEntered} ${entry.unitEntered} × ${entry.reps}${entry.rpe != null ? ` at RPE ${entry.rpe}` : ""}. Tap to edit.`}
      >
        <span className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-xs text-muted">{label.replace(" (optional)", "").replace(" (extra)", "+")}</span>
          <span className="whitespace-nowrap font-mono text-sm">
            {fmtNum(entry.weightEntered)} {entry.unitEntered} × {entry.reps}
            {entry.rpe != null && <span className="text-muted"> @{fmtNum(entry.rpe)}</span>}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {entry.videoUrl && <span title="Video">▶</span>}
            {entry.notes && <span title={entry.notes}>✎</span>}
            {entry.deviations.length === 0 && <span className="text-ok">✓</span>}
          </span>
        </span>
        {entry.deviations.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1 pl-[6.5rem]">
            {entry.deviations.map((d) => (
              <span key={d.kind} className={`rounded px-1.5 py-0.5 text-[11px] ${hard && d.hardBound ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"}`}>
                {DEVIATION_LABEL[d.kind]}
              </span>
            ))}
          </span>
        )}
      </button>
    );
  }

  const step = (setter: (v: string) => void, value: string, by: number, min = 0) => {
    const n = Number(value || 0) + by;
    setter(String(clean(Math.max(min, n), 2)));
  };

  const submit = () =>
    start(async () => {
      setErr(null);
      const w = Number(weight);
      const r = Number(reps);
      if (weight === "" || !Number.isFinite(w) || w < 0) return setErr("Enter the weight (0 for bodyweight).");
      if (reps === "" || !Number.isInteger(r) || r < 0) return setErr("Enter reps.");
      const ok = await onSave({ weight: w, unit: entryUnit, reps: r, rpe: rpe === "" ? null : Number(rpe), videoUrl: video.trim() || null, notes: note });
      if (ok) {
        setEditing(false);
        setMore(false);
      }
    });

  return (
    <div className={`rounded-md border px-2.5 py-2 ${optional && !entry ? "border-dashed border-border" : "border-border-strong"}`}>
      <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="flex gap-3">
          <button type="button" onClick={() => setMore((m) => !m)} className="underline">
            {more ? "Less" : "Note / video"}
          </button>
          {entry && (
            <button type="button" onClick={() => setEditing(false)} className="underline">
              Cancel
            </button>
          )}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
        <Stepper
          label={unit}
          value={weight}
          onChange={setWeight}
          onMinus={() => step(setWeight, weight, -increment)}
          onPlus={() => step(setWeight, weight, increment)}
          inputMode="decimal"
        />
        <Stepper label="reps" value={reps} onChange={setReps} onMinus={() => step(setReps, reps, -1)} onPlus={() => step(setReps, reps, 1)} inputMode="numeric" narrow />
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted">RPE</span>
          <select className="h-10 rounded-md border border-border bg-surface px-1.5 text-base" value={rpe} onChange={(e) => setRpe(e.target.value)} aria-label={`${label} RPE`}>
            <option value="">–</option>
            {RPE_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {more && (
        <div className="mt-2 space-y-2">
          <input className="input" placeholder="Video link (YouTube, Drive…)" value={video} onChange={(e) => setVideo(e.target.value)} inputMode="url" aria-label={`${label} video link`} />
          <input className="input" placeholder="Note for this set" value={note} onChange={(e) => setNote(e.target.value)} aria-label={`${label} note`} />
        </div>
      )}
      {err && <p className="mt-1.5 text-xs text-bad">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button className="btn-primary flex-1 py-2.5 text-base" onClick={submit} disabled={pending} aria-label={`Log ${label}`}>
          {pending ? "Saving…" : entry ? "Save" : "Log set"}
        </button>
        {onDelete && (
          <button
            className="btn-secondary py-2.5 text-bad"
            disabled={pending}
            onClick={() => {
              if (confirm("Delete this set?")) start(() => onDelete());
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  onChange,
  onMinus,
  onPlus,
  inputMode,
  narrow,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onMinus: () => void;
  onPlus: () => void;
  inputMode: "decimal" | "numeric";
  narrow?: boolean;
}) {
  return (
    <label className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <span className="flex h-10 items-stretch overflow-hidden rounded-md border border-border bg-surface">
        <button type="button" className="w-9 shrink-0 text-lg text-muted active:bg-surface-2" onClick={onMinus} aria-label={`Less ${label}`}>
          −
        </button>
        <input
          className={`${narrow ? "w-10" : "w-full min-w-0"} bg-transparent text-center font-mono text-base outline-none`}
          value={value}
          inputMode={inputMode}
          onChange={(e) => onChange(e.target.value.replace(",", "."))}
          aria-label={label}
        />
        <button type="button" className="w-9 shrink-0 text-lg text-muted active:bg-surface-2" onClick={onPlus} aria-label={`More ${label}`}>
          +
        </button>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------

function ExerciseSearch({
  library,
  placeholder,
  onPick,
  extra,
}: {
  library: { id: string; name: string }[];
  placeholder: string;
  onPick: (id: string) => void;
  extra?: { label: string; id: string };
}) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length ? library.filter((e) => words.every((w) => e.name.toLowerCase().includes(w))).slice(0, 6) : [];
  return (
    <div className="mt-2 space-y-1">
      <input className="input" autoFocus placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label={placeholder} />
      {extra && (
        <button className="block w-full rounded px-2 py-1.5 text-left text-sm text-accent" onClick={() => onPick(extra.id)}>
          {extra.label}
        </button>
      )}
      {matches.map((m) => (
        <button key={m.id} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-surface" onClick={() => onPick(m.id)}>
          {m.name}
        </button>
      ))}
    </div>
  );
}

function AddExercise({ library, onAdd }: { library: { id: string; name: string }[]; onAdd: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="btn-secondary w-full" onClick={() => setOpen(true)}>
        + Add an exercise
      </button>
    );
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Add an exercise</span>
        <button className="text-xs text-muted underline" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <ExerciseSearch
        library={library}
        placeholder="Search exercises…"
        onPick={(id) => {
          onAdd(id);
          setOpen(false);
        }}
      />
    </div>
  );
}

function SessionNotes({
  workoutId,
  initial,
  notes,
  onAdd,
  onDelete,
}: {
  workoutId: string;
  initial: string;
  notes: NoteDTO[];
  onAdd: (n: NoteDTO) => void;
  onDelete: (id: string) => void;
}) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [flag, setFlag] = useState<NoteDTO["kind"] | null>(null);
  const [flagText, setFlagText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const label = (k: NoteDTO["kind"]) => NOTE_KINDS.find((n) => n.kind === k)?.label ?? "Note";

  return (
    <section className="card space-y-3 p-3" aria-label="Session notes">
      <div>
        <label className="label" htmlFor="session-notes">
          How did it go?
        </label>
        <textarea
          id="session-notes"
          className="input min-h-20"
          placeholder="Sleep, energy, anything your coach should know…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={async () => {
            if (text === saved) return;
            const r = await saveSessionNotes(workoutId, text);
            if (r.ok) setSaved(text);
            else setErr(r.error);
          }}
        />
        {text !== saved && <p className="mt-1 text-xs text-muted">Saves when you leave the box.</p>}
      </div>

      <div>
        <span className="label">Flag something for your coach</span>
        <div className="flex flex-wrap gap-2">
          {NOTE_KINDS.map((n) => (
            <button
              key={n.kind}
              className={`rounded-full border px-3 py-1.5 text-sm ${flag === n.kind ? "border-accent bg-accent-soft text-accent" : "border-border"}`}
              onClick={() => setFlag(flag === n.kind ? null : n.kind)}
            >
              {n.label}
            </button>
          ))}
        </div>
        {flag && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              const r = await addSessionNote({ workoutId, kind: flag, body: flagText });
              if (!r.ok) return setErr(r.error);
              onAdd(r.value);
              setFlag(null);
              setFlagText("");
            }}
          >
            <input
              className="input"
              autoFocus
              value={flagText}
              onChange={(e) => setFlagText(e.target.value)}
              placeholder={flag === "pain" ? "Where, how bad (0–10), during which lift?" : flag === "missed_reps" ? "Which set, what happened?" : "Your note"}
              aria-label={label(flag)}
            />
            <button className="btn-primary shrink-0">Send</button>
          </form>
        )}
      </div>

      {notes.length > 0 && (
        <ul className="space-y-1.5">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-2 rounded-md bg-surface-2 px-2.5 py-2 text-sm">
              <span className={`shrink-0 rounded px-1.5 text-[11px] ${n.kind === "pain" ? "bg-bad-soft text-bad" : n.kind === "missed_reps" ? "bg-warn-soft text-warn" : "bg-surface text-muted"}`}>
                {n.kind === "missed_reps" ? "missed reps" : n.kind}
              </span>
              <span className="min-w-0 flex-1">{n.body}</span>
              {n.readByCoach ? (
                <span className="shrink-0 text-[11px] text-muted">seen</span>
              ) : (
                <button
                  className="shrink-0 text-xs text-muted"
                  aria-label="Delete note"
                  onClick={async () => {
                    const r = await removeSessionNote(n.id);
                    if (r.ok) onDelete(n.id);
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {err && <p className="text-xs text-bad">{err}</p>}
    </section>
  );
}
