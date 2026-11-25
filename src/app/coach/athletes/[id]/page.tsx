import { asc, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { athleteExerciseSettings, athletes, blocks, exercises, manualRecords, meetEntries, meets, programs, trainingMaxes } from "@/db/schema";
import { fmtNum, formatWeight, fromKg } from "@/lib/calc/units";
import { daysBetween, formatShortDate, todayISO } from "@/lib/dates";
import { loadAthleteContext } from "@/server/athlete-context";
import { AthleteSettingsForm, DeleteButton, InviteButton, OverrideForm, TmForm } from "./client";
import { deleteExerciseOverride, deleteTrainingMax } from "@/app/actions/coach";

export default async function AthletePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const athlete = await db.query.athletes.findFirst({ where: eq(athletes.id, id) });
  if (!athlete) notFound();
  const today = todayISO();
  const u = athlete.unit;

  const [exs, tms, overrides, records, progs, entries] = await Promise.all([
    db.select().from(exercises).orderBy(asc(exercises.name)),
    db.select().from(trainingMaxes).where(eq(trainingMaxes.athleteId, id)).orderBy(desc(trainingMaxes.effectiveDate)),
    db.select().from(athleteExerciseSettings).where(eq(athleteExerciseSettings.athleteId, id)),
    db.select().from(manualRecords).where(eq(manualRecords.athleteId, id)).orderBy(desc(manualRecords.date)),
    db.select().from(programs).where(eq(programs.athleteId, id)).orderBy(desc(programs.createdAt)),
    db
      .select({ entry: meetEntries, meet: meets })
      .from(meetEntries)
      .innerJoin(meets, eq(meets.id, meetEntries.meetId))
      .where(eq(meetEntries.athleteId, id))
      .orderBy(asc(meets.date)),
  ]);
  const blockRows = progs.length
    ? await db.select().from(blocks).where(inArray(blocks.programId, progs.map((p) => p.id))).orderBy(asc(blocks.position))
    : [];
  const ctx = await loadAthleteContext(id);
  const exName = new Map(exs.map((e) => [e.id, e.name]));
  const MAIN = ["Squat", "Bench Press", "Deadlift"];
  const mainLifts = MAIN.map((n) => exs.find((e) => e.name === n)).filter((e): e is (typeof exs)[number] => !!e);
  const exerciseOptions = [...mainLifts, ...exs.filter((e) => !mainLifts.includes(e))].map((e) => ({ id: e.id, name: e.name }));
  const variations = exs.filter((e) => e.parentId);
  const nextMeet = entries.find((e) => e.meet.date >= today);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/coach" className="text-xs text-muted hover:text-text">
            ← Athletes
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{athlete.name}</h1>
          <p className="text-sm text-muted">
            {athlete.email ?? "No email"} · displays in {u}
            {athlete.bodyweightKg ? ` · ${formatWeight(athlete.bodyweightKg, u)} BW` : ""}
          </p>
          {nextMeet && (
            <p className="mt-1 text-sm">
              <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">{daysBetween(today, nextMeet.meet.date)} days</span>{" "}
              to {nextMeet.meet.name} ({nextMeet.meet.federation}, {nextMeet.entry.weightClass}) · {formatShortDate(nextMeet.meet.date)}
            </p>
          )}
        </div>
        <InviteButton athleteId={id} active={!!athlete.userId} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Programs */}
        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Programs</h2>
          {progs.length === 0 && <p className="text-sm text-muted">No programs yet. The programming grid arrives in Phase 2.</p>}
          {progs.map((p) => (
            <div key={p.id} className="mb-3">
              <div className="text-sm font-medium">{p.name}</div>
              <ul className="mt-1 space-y-1">
                {blockRows
                  .filter((b) => b.programId === p.id)
                  .map((b) => (
                    <li key={b.id}>
                      <Link href={`/coach/blocks/${b.id}`} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2">
                        <span>
                          {b.name} <span className="text-xs text-muted">· {b.kind}</span>
                        </span>
                        <span className="text-xs text-muted">{b.startDate ? `starts ${formatShortDate(b.startDate)}` : "no start date"}</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </section>

        {/* Training maxes */}
        <section className="card p-4">
          <h2 className="mb-1 font-semibold">Training maxes</h2>
          <p className="mb-3 text-xs text-muted">%-based prescriptions use the TM effective on each session&apos;s date. Variations without their own TM use the parent lift × ratio.</p>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {mainLifts.map((e) => {
              const tm = ctx.tmFor(e.id, today);
              return (
                <div key={e.id} className="rounded-md bg-surface-2 px-3 py-2">
                  <div className="text-xs text-muted">{e.name}</div>
                  <div className="font-mono text-lg">{tm ? fmtNum(fromKg(tm, u), 1) : "—"}</div>
                </div>
              );
            })}
          </div>
          <table className="mb-3 w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 font-medium">Exercise</th>
                <th className="py-1 font-medium">TM ({u})</th>
                <th className="py-1 font-medium">From</th>
                <th className="py-1 font-medium">Note</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tms.map((t) => (
                <tr key={t.id}>
                  <td className="py-1.5">{exName.get(t.exerciseId)}</td>
                  <td className="py-1.5 font-mono">{fmtNum(fromKg(t.weightKg, u), 1)}</td>
                  <td className="py-1.5">{formatShortDate(t.effectiveDate)}</td>
                  <td className="py-1.5 text-muted">{t.note}</td>
                  <td className="py-1.5 text-right">
                    <DeleteButton action={deleteTrainingMax.bind(null, id, t.id)} label="Delete TM" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TmForm athleteId={id} unit={u} exercises={exerciseOptions} today={today} />
          {variations.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">Derived TMs for variations (today)</summary>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                {variations.map((v) => {
                  const tm = ctx.tmFor(v.id, today);
                  return (
                    <div key={v.id} className="flex justify-between">
                      <span className="text-muted">{v.name}</span>
                      <span className="font-mono">{tm ? fmtNum(fromKg(tm, u), 1) : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </section>

        {/* Overrides */}
        <section className="card p-4">
          <h2 className="mb-1 font-semibold">Exercise overrides</h2>
          <p className="mb-3 text-xs text-muted">Per-exercise unit (e.g. lb dumbbells), rounding, or TM ratio to the parent lift.</p>
          <table className="mb-3 w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 font-medium">Exercise</th>
                <th className="py-1 font-medium">Unit</th>
                <th className="py-1 font-medium">Rounding</th>
                <th className="py-1 font-medium">TM ratio</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {overrides.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-2 text-muted">
                    None.
                  </td>
                </tr>
              )}
              {overrides.map((o) => (
                <tr key={o.exerciseId}>
                  <td className="py-1.5">{exName.get(o.exerciseId)}</td>
                  <td className="py-1.5">{o.unit ?? "—"}</td>
                  <td className="py-1.5 font-mono">{o.rounding ?? "—"}</td>
                  <td className="py-1.5 font-mono">{o.tmRatio ? `${fmtNum(o.tmRatio * 100, 1)}%` : "—"}</td>
                  <td className="py-1.5 text-right">
                    <DeleteButton action={deleteExerciseOverride.bind(null, id, o.exerciseId)} label="Remove override" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <OverrideForm athleteId={id} exercises={exerciseOptions} />
        </section>

        {/* Past maxes */}
        <section className="card p-4">
          <h2 className="mb-1 font-semibold">Past maxes &amp; PRs</h2>
          <p className="mb-3 text-xs text-muted">Manually entered history. Editing arrives with analytics in Phase 4.</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {records.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5">{exName.get(r.exerciseId)}</td>
                  <td className="py-1.5 font-mono">
                    {formatWeight(r.weightKg, u, u === "kg" ? 0.5 : 1)} × {r.reps}
                    {r.rpe ? ` @${r.rpe}` : ""}
                  </td>
                  <td className="py-1.5 text-muted">{r.context}</td>
                  <td className="py-1.5 text-right text-muted">{formatShortDate(r.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Settings */}
        <section className="card p-4 lg:col-span-2">
          <h2 className="mb-3 font-semibold">Settings</h2>
          <AthleteSettingsForm
            athleteId={id}
            defaults={{
              name: athlete.name,
              email: athlete.email ?? "",
              unit: athlete.unit,
              roundingKg: athlete.roundingKg,
              roundingLb: athlete.roundingLb,
              bodyweight: athlete.bodyweightKg ? fmtNum(fromKg(athlete.bodyweightKg, u), 1) : "",
              e1rmFormula: athlete.e1rmFormula,
              notes: athlete.notes,
            }}
          />
        </section>
      </div>
    </div>
  );
}
