import { and, asc, eq, gte } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { athletes, meetEntries, meets } from "@/db/schema";
import { fmtNum, fromKg } from "@/lib/calc/units";
import { addDays, daysBetween, formatShortDate, todayISO, WEEKDAY_SHORT } from "@/lib/dates";
import { getBlockGrid, type BlockGridData, type GridCell, type GridDay } from "@/server/blocks";

export const metadata = { title: "Block" };

export default async function BlockPage({
  params,
  searchParams,
}: {
  params: Promise<{ blockId: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  const { blockId } = await params;
  const { day: dayParam } = await searchParams;
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

  const focused = dayParam ? Number(dayParam) : null;
  const shown = days.map((d, i) => ({ day: d, number: i + 1 })).filter((d) => focused === null || d.number === focused);
  const currentWeek = weeks.findIndex((w) => w.startDate && w.startDate <= today && today < addDays(w.startDate, 7));

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

      {/* Day tabs: all days, or one day at a time */}
      <nav aria-label="Days" className="mb-4 flex flex-wrap gap-1.5 text-sm">
        <DayTab href={`/coach/blocks/${blockId}`} active={focused === null}>
          All days
        </DayTab>
        {days.map((d, i) => (
          <DayTab key={d.id} href={`/coach/blocks/${blockId}?day=${i + 1}`} active={focused === i + 1}>
            <span className="font-semibold">Day {i + 1}</span>
            {d.weekday !== null && <span className="opacity-70"> · {WEEKDAY_SHORT[d.weekday]}</span>}
          </DayTab>
        ))}
      </nav>

      <div className="space-y-6">
        {shown.map(({ day, number }) => (
          <DaySection key={day.id} day={day} number={number} weeks={weeks} currentWeek={currentWeek} today={today} />
        ))}
        {shown.length === 0 && <p className="text-sm text-muted">No such day in this block.</p>}
      </div>

      <Legend />
    </div>
  );
}

function DayTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-md border px-3 py-1.5 ${active ? "border-accent bg-accent text-white" : "border-border bg-surface hover:bg-surface-2"}`}
    >
      {children}
    </Link>
  );
}

const LABEL_W = 210;
const WEEK_W = 240;

function DaySection({
  day,
  number,
  weeks,
  currentWeek,
  today,
}: {
  day: GridDay;
  number: number;
  weeks: BlockGridData["weeks"];
  currentWeek: number;
  today: string;
}) {
  const cols = `${LABEL_W}px repeat(${weeks.length}, minmax(${WEEK_W}px, 1fr))`;
  return (
    <section id={`day-${number}`} aria-label={`Day ${number}`} className="overflow-hidden rounded-lg border border-border-strong bg-surface">
      {/* Day header band */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border-strong bg-surface-2 px-4 py-3">
        <span className="rounded bg-text px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-bg">Day {number}</span>
        <h2 className="text-base font-semibold">{day.name || `Day ${number}`}</h2>
        {day.weekday !== null && <span className="text-sm text-muted">{WEEKDAY_SHORT[day.weekday]}s</span>}
        <span className="ml-auto text-xs text-muted">
          {day.rows.length} exercise{day.rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="grid text-sm" style={{ gridTemplateColumns: cols, minWidth: LABEL_W + weeks.length * WEEK_W }}>
          {/* Week columns for this day: week number, planned date, status */}
          <div className="sticky left-0 z-10 border-b border-border bg-surface px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">Exercise</div>
          {weeks.map((w, i) => {
            const wo = day.workouts[i];
            return (
              <div key={w.id} className={`border-b border-l border-border px-3 py-2 ${i === currentWeek ? "bg-accent-soft" : ""}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide">Week {w.position + 1}</span>
                  {wo?.date && <span className={`text-xs ${wo.date === today ? "font-semibold text-accent" : "text-muted"}`}>{formatShortDate(wo.date)}</span>}
                </div>
                <div className="mt-0.5 h-4 text-[11px]">
                  {wo?.completed && <span className="rounded bg-surface-2 px-1 text-ok">done · {wo.loggedSets} sets</span>}
                  {wo && !wo.completed && wo.date === today && <span className="rounded bg-accent-soft px-1 text-accent">today</span>}
                  {wo && !wo.completed && wo.date && wo.date < today && <span className="rounded bg-bad-soft px-1 text-bad">missed</span>}
                </div>
              </div>
            );
          })}

          {day.rows.map((row, i) => (
            <Row key={row.slotId} index={i + 1} label={row.label} cells={row.cells} last={i === day.rows.length - 1} />
          ))}
          {day.rows.length === 0 && (
            <div className="col-span-full px-3 py-4 text-sm text-muted">No exercises on this day yet.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ index, label, cells, last }: { index: number; label: string; cells: (GridCell | null)[]; last: boolean }) {
  const first = cells.find((c) => c && !c.swapped) ?? cells.find(Boolean);
  const border = last ? "" : "border-b";
  return (
    <>
      <div className={`sticky left-0 z-10 ${border} border-border bg-surface px-3 py-2`}>
        <div className="flex gap-2 font-medium">
          <span className="w-4 shrink-0 text-right font-mono text-xs leading-5 text-muted">{index}</span>
          <span>{label}</span>
        </div>
        {first?.modifiers && <div className="pl-6 text-xs text-muted">{first.modifiers}</div>}
        {first?.restSeconds && <div className="pl-6 text-xs text-muted">rest {Math.round((first.restSeconds / 60) * 10) / 10} min</div>}
      </div>
      {cells.map((c, i) => (
        <div key={i} className={`min-w-0 ${border} border-l border-border px-3 py-2`}>
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
