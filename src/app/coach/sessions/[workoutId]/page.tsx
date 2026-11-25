import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import type { Deviation } from "@/lib/calc/deviation";
import { estimateE1rm } from "@/lib/calc/e1rm";
import { findTopSetGroup } from "@/lib/calc/load";
import { formatModifiers } from "@/lib/calc/prescription";
import { pickTopSet } from "@/lib/logging/session";
import { formatSetGroup } from "@/lib/calc/shorthand";
import { fmtNum, fromKg } from "@/lib/calc/units";
import { formatShortDate } from "@/lib/dates";
import { contextFromRows } from "@/server/athlete-context";
import { loadSessionForCoach, markSessionNotesRead, type LoggedSetDTO } from "@/server/logging";

export const metadata = { title: "Session" };

const DEVIATION_LABEL: Record<Deviation["kind"], string> = {
  rpe_high: "RPE high",
  rpe_low: "RPE low",
  load_high: "Load high",
  load_low: "Load low",
  reps_low: "Missed reps",
  reps_high: "Extra reps",
};

export default async function CoachSessionPage({ params }: { params: Promise<{ workoutId: string }> }) {
  const { workoutId } = await params;
  const data = await loadSessionForCoach(db, workoutId);
  if (!data) notFound();
  await markSessionNotesRead(db, workoutId);
  const ctx = contextFromRows(data.ctx);
  const unit = data.ctx.athlete.unit;
  const w = data.workout;
  const edited = new Set(data.editedAfterLogging);
  const flagged = data.logged.filter((l) => l.deviations.length).length;
  const extras = [...new Set(data.logged.filter((l) => !l.plannedExerciseId).map((l) => l.exerciseId))];

  const e1rm = (l: LoggedSetDTO) => {
    const r = estimateE1rm({ weightKg: l.weightKg, reps: l.reps, rpe: l.rpe }, { chart: data.ctx.chart, formula: data.ctx.athlete.e1rmFormula });
    return r && l.weightKg > 0 ? `${fmtNum(fromKg(r.e1rmKg, unit), 1)}` : "—";
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link href={`/coach/athletes/${data.athlete.id}`} className="text-xs text-muted hover:text-text">
          ← {data.athlete.name}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{w.dayName || `Day ${w.dayNumber}`}</h1>
        <p className="text-sm text-muted">
          <Link href={`/coach/blocks/${w.blockId}`} className="hover:underline">
            {w.blockName}
          </Link>{" "}
          · week {w.weekNumber} · day {w.dayNumber}
          {w.plannedDate && ` · planned ${formatShortDate(w.plannedDate)}`} ·{" "}
          {w.completed ? <span className="text-ok">completed</span> : w.started ? <span className="text-accent">in progress</span> : "not started"}
        </p>
        <p className="mt-1 text-sm">
          {data.logged.length} sets logged · {flagged > 0 ? <span className="text-warn">{flagged} flagged</span> : "no flags"}
          {data.editedAfterLogging.length > 0 && <span className="text-muted"> · {data.editedAfterLogging.length} edited after logging</span>}
        </p>
      </div>

      {(data.notes.length > 0 || w.athleteNotes) && (
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">From {data.athlete.name.split(" ")[0]}</h2>
          {w.athleteNotes && <p className="text-sm">“{w.athleteNotes}”</p>}
          {data.notes.map((n) => (
            <div key={n.id} className="flex items-start gap-2 text-sm">
              <span
                className={`shrink-0 rounded px-1.5 text-[11px] ${n.kind === "pain" ? "bg-bad-soft text-bad" : n.kind === "missed_reps" ? "bg-warn-soft text-warn" : "bg-surface-2 text-muted"}`}
              >
                {n.kind === "missed_reps" ? "missed reps" : n.kind}
              </span>
              <span>{n.body}</span>
              {!n.readByCoach && <span className="shrink-0 rounded bg-accent-soft px-1 text-[11px] text-accent">new</span>}
            </div>
          ))}
        </section>
      )}

      {data.exercises.map((ex) => {
        const sets = data.logged.filter((l) => l.plannedExerciseId === ex.plannedExerciseId);
        const subs = [...new Set(sets.filter((s) => s.exerciseId !== ex.exerciseId).map((s) => data.names[s.exerciseId]))];
        const date = w.plannedDate ?? "9999-12-31";
        const prescriptions = ex.groups.map((g) => g.prescription);
        // Backoff loads from the top set the athlete actually hit, as on their phone.
        const sugg = ex.groups.map((_, gi) => {
          const top = findTopSetGroup(prescriptions, gi);
          const topId = top ? ex.groups[prescriptions.indexOf(top)].id : null;
          const actualTopSet = topId ? pickTopSet(sets.filter((s) => s.setGroupId === topId)) : null;
          return ctx.suggestGroups(ex.exerciseId, date, prescriptions, { unitOverride: ex.unitOverride, actualTopSet })[gi];
        });
        return (
          <section key={ex.plannedExerciseId} className="card overflow-hidden">
            <div className="border-b border-border bg-surface-2 px-4 py-2.5">
              <h2 className="font-semibold">
                {ex.exerciseName}
                {subs.length > 0 && <span className="ml-2 text-sm font-normal text-warn">done as {subs.join(", ")}</span>}
              </h2>
              {formatModifiers(ex.modifiers) && <div className="text-xs text-muted">{formatModifiers(ex.modifiers)}</div>}
            </div>
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[20%]" />
                <col className="w-[10%]" />
                <col />
              </colgroup>
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-1.5 font-medium">Prescribed</th>
                  <th className="px-2 py-1.5 font-medium">Logged</th>
                  <th className="px-2 py-1.5 font-medium">e1RM</th>
                  <th className="px-4 py-1.5 font-medium">Flags &amp; notes</th>
                </tr>
              </thead>
              <tbody>
                {ex.groups.map((g, gi) => {
                  const gs = sets.filter((s) => s.setGroupId === g.id).sort((a, b) => a.setIndex - b.setIndex);
                  const rows = gs.length ? gs : [null];
                  return rows.map((s, i) => (
                    <tr key={s?.id ?? `${g.id}-none`} className={`align-top ${i === rows.length - 1 ? "border-b border-border" : ""}`}>
                      <td className="px-4 py-1.5">
                        {i === 0 && (
                          <>
                            <div className="break-words font-mono text-[13px]">{g.text}</div>
                            {sugg[gi] && <div className="font-mono text-xs text-muted">{sugg[gi]!.text}</div>}
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                        {s ? (
                          <>
                            {fmtNum(s.weightEntered)} {s.unitEntered} × {s.reps}
                            {s.rpe != null && <span className="text-muted"> @{fmtNum(s.rpe)}</span>}
                          </>
                        ) : (
                          <span className="text-muted">not logged</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-muted">{s ? e1rm(s) : ""}</td>
                      <td className="px-4 py-1.5">{s && <SetNotes s={s} edited={edited.has(s.id)} />}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </section>
        );
      })}

      {extras.map((exId) => (
        <section key={exId} className="card overflow-hidden">
          <div className="border-b border-border bg-surface-2 px-4 py-2.5">
            <h2 className="font-semibold">
              {data.names[exId]} <span className="text-sm font-normal text-muted">· added by athlete</span>
            </h2>
          </div>
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[30%]" />
              <col />
            </colgroup>
            <tbody>
              {data.logged
                .filter((l) => !l.plannedExerciseId && l.exerciseId === exId)
                .sort((a, b) => a.setIndex - b.setIndex)
                .map((s) => (
                  <tr key={s.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-1.5 font-mono">
                      {fmtNum(s.weightEntered)} {s.unitEntered} × {s.reps}
                      {s.rpe != null && <span className="text-muted"> @{fmtNum(s.rpe)}</span>}
                    </td>
                    <td className="px-4 py-1.5">
                      <SetNotes s={s} edited={false} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function SetNotes({ s, edited }: { s: LoggedSetDTO; edited: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {s.deviations.map((d) => (
        <span key={d.kind} title={d.message} className={`rounded px-1.5 py-0.5 ${d.hardBound ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"}`}>
          {DEVIATION_LABEL[d.kind]}
        </span>
      ))}
      {edited && s.snapshot && (
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-muted" title="You changed this prescription after the set was logged">
          edited after logging · was <span className="font-mono">{formatSetGroup(s.snapshot.setGroup)}</span>
        </span>
      )}
      {s.notes && <span className="text-muted">“{s.notes}”</span>}
      {s.videoUrl && (
        <a href={s.videoUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">
          video
        </a>
      )}
    </div>
  );
}
