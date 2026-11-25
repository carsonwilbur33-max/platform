import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { logout } from "@/app/actions/auth";
import { db } from "@/db";
import { blockDays, blocks, programs, weeks, workouts } from "@/db/schema";
import { formatModifiers } from "@/lib/calc/prescription";
import { formatSetGroup } from "@/lib/calc/shorthand";
import { formatShortDate, todayISO } from "@/lib/dates";
import { loadAthleteContext } from "@/server/athlete-context";
import { requireAthlete } from "@/server/auth";

export const metadata = { title: "Today" };

/**
 * Phase 1 placeholder: shows the athlete's next unlogged session, read-only.
 * Logging arrives in Phase 3. All queries are scoped to the signed-in athlete.
 */
export default async function AthleteHome() {
  const { athlete } = await requireAthlete();
  const today = todayISO();

  const next = (
    await db
      .select({ workout: workouts, dayName: blockDays.name, blockName: blocks.name, weekPos: weeks.position })
      .from(workouts)
      .innerJoin(weeks, eq(weeks.id, workouts.weekId))
      .innerJoin(blocks, eq(blocks.id, weeks.blockId))
      .innerJoin(programs, eq(programs.id, blocks.programId))
      .innerJoin(blockDays, eq(blockDays.id, workouts.blockDayId))
      .where(and(eq(programs.athleteId, athlete.id), isNull(workouts.completedAt), gte(workouts.plannedDate, today)))
      .orderBy(asc(workouts.plannedDate))
      .limit(1)
  )[0];

  const detail = next
    ? await db.query.plannedExercises.findMany({
        where: (pe, { eq }) => eq(pe.workoutId, next.workout.id),
        orderBy: (pe, { asc }) => asc(pe.position),
        with: { exercise: true, setGroups: { orderBy: (sg, { asc }) => asc(sg.position) } },
      })
    : [];
  const ctx = await loadAthleteContext(athlete.id);

  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="font-semibold tracking-tight">
          Platform<span className="text-accent">.</span>
        </div>
        <form action={logout}>
          <button className="text-sm text-muted">Log out</button>
        </form>
      </div>
      <h1 className="text-xl font-semibold">Hi {athlete.name.split(" ")[0]}</h1>
      {!next ? (
        <p className="mt-2 text-sm text-muted">No upcoming sessions.</p>
      ) : (
        <section className="mt-4">
          <div className="text-xs uppercase tracking-wide text-muted">
            {next.workout.plannedDate === today ? "Today" : "Next session"} · {next.workout.plannedDate && formatShortDate(next.workout.plannedDate)}
          </div>
          <div className="text-lg font-medium">{next.dayName}</div>
          <div className="mb-3 text-xs text-muted">
            {next.blockName} · week {next.weekPos + 1}
          </div>
          <div className="space-y-3">
            {detail.map((pe) => {
              const sugg = ctx.suggestGroups(pe.exerciseId, next.workout.plannedDate ?? today, pe.setGroups.map((g) => g.prescription), {
                unitOverride: pe.unitOverride,
              });
              return (
                <div key={pe.id} className="card p-3">
                  <div className="font-medium">{pe.exercise.name}</div>
                  {formatModifiers(pe.modifiers) && <div className="text-xs text-muted">{formatModifiers(pe.modifiers)}</div>}
                  <ul className="mt-2 space-y-1">
                    {pe.setGroups.map((g, i) => (
                      <li key={g.id} className="flex justify-between font-mono text-sm">
                        <span>{formatSetGroup(g.prescription)}</span>
                        <span className="text-muted">{sugg[i]?.text ?? ""}</span>
                      </li>
                    ))}
                  </ul>
                  {pe.notes && <p className="mt-2 text-xs text-muted">{pe.notes}</p>}
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted">Logging sets arrives in Phase 3.</p>
        </section>
      )}
    </main>
  );
}
