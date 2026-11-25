import Link from "next/link";
import { db } from "@/db";
import { formatSetGroup, parsePrescription } from "@/lib/calc/shorthand";
import { formatShortDate, todayISO } from "@/lib/dates";
import { cellKey, workoutKey } from "@/lib/editor/state";
import { pickTodaySession } from "@/lib/logging/session";
import { contextFromRows, loadCtxRows } from "@/server/athlete-context";
import { requireAthlete } from "@/server/auth";
import { loadEdState } from "@/server/block-ops";
import { listSessions } from "@/server/logging";

export const metadata = { title: "Program" };

/** The athlete's whole block, read-only, one week at a time. */
export default async function AthleteProgram({ searchParams }: { searchParams: Promise<{ block?: string; week?: string }> }) {
  const { athlete } = await requireAthlete();
  const sp = await searchParams;
  const sessions = await listSessions(db, athlete.id);
  if (!sessions.length) return <p className="py-10 text-center text-sm text-muted">Your coach hasn't posted a program yet.</p>;

  const blocks = [...new Map(sessions.map((s) => [s.blockId, s.blockName])).entries()].map(([id, name]) => ({ id, name }));
  const next = pickTodaySession(sessions);
  // Only blocks from this athlete's own sessions can be shown.
  const blockId = blocks.some((b) => b.id === sp.block) ? sp.block! : (next?.blockId ?? blocks.at(-1)!.id);
  const state = (await loadEdState(db, blockId))!;
  const blockSessions = sessions.filter((s) => s.blockId === blockId);
  const defaultWeek = next && next.blockId === blockId ? next.weekNumber : 1;
  const weekNo = Math.min(Math.max(1, Number(sp.week) || defaultWeek), state.weeks.length);
  const week = state.weeks[weekNo - 1];
  const ctx = contextFromRows(await loadCtxRows(athlete.id));
  const names = new Map(ctx.exercisesList().map((e) => [e.id, e.name]));
  const today = todayISO();

  return (
    <div className="space-y-4">
      {blocks.length > 1 && (
        <div className="flex flex-wrap gap-1.5 text-sm">
          {blocks.map((b) => (
            <Link key={b.id} href={`/athlete/program?block=${b.id}`} className={`rounded-md border px-2.5 py-1 ${b.id === blockId ? "border-accent bg-accent text-white" : "border-border"}`}>
              {b.name}
            </Link>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{blocks.find((b) => b.id === blockId)?.name}</h1>
        <span className="text-xs text-muted">{blockSessions.filter((s) => s.completed).length}/{blockSessions.length} sessions done</span>
      </div>
      <nav aria-label="Weeks" className="flex gap-1.5 overflow-x-auto pb-1">
        {state.weeks.map((w, i) => (
          <Link
            key={w.id}
            href={`/athlete/program?block=${blockId}&week=${i + 1}`}
            aria-current={i + 1 === weekNo ? "page" : undefined}
            className={`shrink-0 rounded-md border px-3 py-1.5 text-sm ${i + 1 === weekNo ? "border-text bg-text text-bg" : "border-border"}`}
          >
            Week {i + 1}
          </Link>
        ))}
      </nav>

      {state.days.map((day, di) => {
        const wo = state.workouts[workoutKey(day.id, week.id)];
        const s = blockSessions.find((x) => x.id === wo?.id);
        const status = s?.completed
          ? { text: "Done", cls: "text-ok" }
          : s?.inProgress
            ? { text: "In progress", cls: "text-accent" }
            : wo?.plannedDate && wo.plannedDate < today
              ? { text: "Missed", cls: "text-bad" }
              : next?.id === wo?.id
                ? { text: "Up next", cls: "text-accent" }
                : null;
        return (
          <Link key={day.id} href={`/athlete/session/${wo?.id}`} className="card block p-3 active:bg-surface-2">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">Day {di + 1}</span>
                <span className="ml-2 font-medium">{day.name}</span>
              </div>
              <span className="shrink-0 text-xs">
                {wo?.plannedDate && <span className="text-muted">{formatShortDate(wo.plannedDate)}</span>}
                {status && <span className={`ml-2 font-medium ${status.cls}`}>{status.text}</span>}
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {day.slots.map((slot) => {
                const cell = state.cells[cellKey(slot.id, week.id)];
                if (!cell) return null;
                const p = parsePrescription(cell.text);
                const groups = p.ok ? p.groups : [];
                const loads = ctx.suggestGroups(cell.exerciseId, wo?.plannedDate ?? today, groups, { unitOverride: cell.unitOverride });
                return (
                  <li key={slot.id} className="text-sm">
                    <div className="font-medium">{names.get(cell.exerciseId)}</div>
                    {groups.map((g, i) => (
                      <div key={i} className="flex justify-between gap-2 font-mono text-xs text-muted">
                        <span>{formatSetGroup(g)}</span>
                        <span>{loads[i]?.text ?? ""}</span>
                      </div>
                    ))}
                  </li>
                );
              })}
              {!day.slots.some((s) => state.cells[cellKey(s.id, week.id)]) && <li className="text-sm text-muted">Rest / nothing planned</li>}
            </ul>
          </Link>
        );
      })}
    </div>
  );
}
