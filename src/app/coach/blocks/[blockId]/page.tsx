import { and, asc, eq, gte } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { athletes, meetEntries, meets } from "@/db/schema";
import { fmtNum, fromKg } from "@/lib/calc/units";
import { addDays, daysBetween, formatShortDate, todayISO } from "@/lib/dates";
import { getBlockGrid, type GridCell, type GridDay } from "@/server/blocks";

export const metadata = { title: "Block" };

export default async function BlockPage({ params }: { params: Promise<{ blockId: string }> }) {
  const { blockId } = await params;
  const grid = await getBlockGrid(blockId);
  if (!grid) notFound();
  const { block, program, weeks, days } = grid;
  const athlete = program.athleteId ? await db.query.athletes.findFirst({ where: eq(athletes.id, program.athleteId) }) : null;
  const today = todayISO();
  const meet = athlete
    ? (
        await db
          .select({ meet: meets, entry: meetEntries })
          .from(meetEntries)
          .innerJoin(meets, eq(meets.id, meetEntries.meetId))
          .where(and(eq(meetEntries.athleteId, athlete.id), gte(meets.date, today)))
          .orderBy(asc(meets.date))
          .limit(1)
      )[0]
    : undefined;

  const cols = `190px repeat(${weeks.length}, minmax(240px, 1fr))`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          {athlete && (
            <Link href={`/coach/athletes/${athlete.id}`} className="text-xs text-muted hover:text-text">
              ← {athlete.name}
            </Link>
          )}
          <h1 className="text-xl font-semibold tracking-tight">
            {block.name} <span className="text-sm font-normal text-muted">· {block.kind} · {program.name}</span>
          </h1>
          {block.notes && <p className="text-sm text-muted">{block.notes}</p>}
        </div>
        <div className="flex items-center gap-3 text-sm">
          {meet && (
            <span className="rounded-md bg-accent-soft px-2 py-1 text-accent">
              <strong>{daysBetween(today, meet.meet.date)}</strong> days to {meet.meet.name}
            </span>
          )}
          <span className="rounded-md border border-border px-2 py-1 text-xs text-muted">Read-only · editing arrives in Phase 2</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <div className="grid text-sm" style={{ gridTemplateColumns: cols, minWidth: 190 + weeks.length * 240 }}>
          {/* Week header */}
          <div className="sticky left-0 z-10 border-b border-border bg-surface-2 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">Exercise</div>
          {weeks.map((w) => {
            const current = w.startDate && w.startDate <= today && today < addDays(w.startDate, 7);
            return (
              <div key={w.id} className={`border-b border-l border-border px-3 py-2 ${current ? "bg-accent-soft" : "bg-surface-2"}`}>
                <div className="text-xs font-semibold uppercase tracking-wide">Week {w.position + 1}</div>
                {w.startDate && <div className="text-xs text-muted">{formatShortDate(w.startDate)}</div>}
              </div>
            );
          })}

          {days.map((d) => (
            <DaySection key={d.id} day={d} today={today} />
          ))}
        </div>
      </div>

      <Legend />
    </div>
  );
}

function DaySection({ day, today }: { day: GridDay; today: string }) {
  return (
    <>
      <div className="sticky left-0 z-10 border-b border-border bg-surface px-3 pb-1.5 pt-4 font-semibold">{day.name || "Day"}</div>
      {day.workouts.map((w, i) => (
        <div key={i} className="border-b border-l border-border px-3 pb-1.5 pt-4 text-xs text-muted">
          {w?.date && <span className={w.date === today ? "font-semibold text-accent" : ""}>{formatShortDate(w.date)}</span>}
          {w?.completed && <span className="ml-2 rounded bg-surface-2 px-1 text-ok">done · {w.loggedSets} sets</span>}
          {w && !w.completed && w.date && w.date < today && <span className="ml-2 rounded bg-bad-soft px-1 text-bad">missed</span>}
        </div>
      ))}
      {day.rows.map((row) => (
        <Row key={row.slotId} label={row.label} cells={row.cells} />
      ))}
    </>
  );
}

function Row({ label, cells }: { label: string; cells: (GridCell | null)[] }) {
  const first = cells.find((c) => c && !c.swapped) ?? cells.find(Boolean);
  return (
    <>
      <div className="sticky left-0 z-10 border-b border-border bg-surface px-3 py-2">
        <div className="font-medium">{label}</div>
        {first?.modifiers && <div className="text-xs text-muted">{first.modifiers}</div>}
        {first?.restSeconds && <div className="text-xs text-muted">rest {Math.round(first.restSeconds / 60 * 10) / 10} min</div>}
      </div>
      {cells.map((c, i) => (
        <div key={i} className="min-w-0 border-b border-l border-border px-3 py-2">
          {c ? <CellView cell={c} /> : <span className="text-xs text-muted">—</span>}
        </div>
      ))}
    </>
  );
}

function CellView({ cell }: { cell: GridCell }) {
  return (
    <div className="space-y-1">
      {cell.swapped && <div className="text-xs font-medium text-accent">↳ {cell.exerciseName}</div>}
      {cell.groups.map((g) => (
        <div key={g.id} className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-[13px]">{g.text}</span>
          <span className={`shrink-0 font-mono text-xs ${g.clamped ? "text-warn" : "text-muted"}`} title={g.clamped ? "Clamped to the hard bound" : undefined}>
            {g.suggestion ?? ""}
          </span>
        </div>
      ))}
      {(cell.notes || cell.tmKg) && (
        <div className="flex justify-between gap-2 text-[11px] text-muted">
          <span className="truncate" title={cell.notes}>
            {cell.notes}
          </span>
          {cell.tmKg && <span className="shrink-0">TM {fmtNum(fromKg(cell.tmKg, cell.unit), 1)}</span>}
        </div>
      )}
      {cell.groups.some((g) => g.loggedCount > 0) && (
        <div className="text-[11px] text-ok">logged {cell.groups.reduce((n, g) => n + g.loggedCount, 0)} sets</div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-4 grid gap-1 text-xs text-muted sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <span className="font-mono">3x5 @7-7.5 [175-180kg]</span> — RPE target, load hard bound
      </div>
      <div>
        <span className="font-mono">top 1 @8; 4x4 -10%</span> — top single then backoffs
      </div>
      <div>
        <span className="font-mono">≈</span> — load estimated from RPE chart × TM
      </div>
      <div>
        <span className="text-warn">amber load</span> — target clamped into the bound
      </div>
    </div>
  );
}
