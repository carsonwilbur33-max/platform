import { asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { athletes, blockDays, blocks, programs, weeks } from "@/db/schema";
import { NewBlockForm } from "@/components/new-block-form";
import { addDays, mondayOf, todayISO } from "@/lib/dates";
import { listTemplateBlocks } from "@/server/editor-data";
import { AssignTemplate } from "./assign";

export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const templates = await listTemplateBlocks();
  const ids = templates.map((t) => t.blockId);
  const [weekCounts, dayCounts] = ids.length
    ? await Promise.all([
        db.select({ id: weeks.blockId, n: count() }).from(weeks).where(inArray(weeks.blockId, ids)).groupBy(weeks.blockId),
        db.select({ id: blockDays.blockId, n: count() }).from(blockDays).where(inArray(blockDays.blockId, ids)).groupBy(blockDays.blockId),
      ])
    : [[], []];
  const wc = new Map(weekCounts.map((r) => [r.id, r.n]));
  const dc = new Map(dayCounts.map((r) => [r.id, r.n]));

  const roster = await db.select({ id: athletes.id, name: athletes.name }).from(athletes).where(isNull(athletes.archivedAt)).orderBy(asc(athletes.name));
  const athletePrograms = await db
    .select({ id: programs.id, name: programs.name, athleteId: programs.athleteId })
    .from(programs)
    .where(eq(programs.isTemplate, false))
    .orderBy(desc(programs.createdAt));
  const athleteBlocks = await db
    .select({ blockId: blocks.id, blockName: blocks.name, programName: programs.name, athleteName: athletes.name })
    .from(blocks)
    .innerJoin(programs, eq(programs.id, blocks.programId))
    .innerJoin(athletes, eq(athletes.id, programs.athleteId))
    .orderBy(asc(athletes.name), asc(blocks.position));
  const today = todayISO();
  const nextMonday = mondayOf(today) === today ? today : addDays(mondayOf(today), 7);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
      <section>
        <h1 className="mb-1 text-lg font-semibold">Templates</h1>
        <p className="mb-4 text-sm text-muted">
          Assigning a template gives the athlete an independent copy. Editing either one never changes the other.
        </p>
        <div className="card divide-y divide-border">
          {templates.length === 0 && <p className="p-4 text-sm text-muted">No templates yet. Create one here, or use “Save as template” on any block.</p>}
          {templates.map((t) => (
            <div key={t.blockId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/coach/blocks/${t.blockId}`} className="font-medium hover:underline">
                  {t.blockName}
                </Link>
                <div className="text-xs text-muted">
                  {wc.get(t.blockId) ?? 0} weeks · {dc.get(t.blockId) ?? 0} days
                </div>
              </div>
              <Link href={`/coach/blocks/${t.blockId}`} className="btn-secondary py-1 text-sm">
                Edit
              </Link>
              <AssignTemplate
                templateBlockId={t.blockId}
                templateName={t.blockName}
                athletes={roster}
                programs={athletePrograms.map((p) => ({ id: p.id, name: p.name, athleteId: p.athleteId! }))}
                defaultStart={nextMonday}
              />
            </div>
          ))}
        </div>
      </section>
      <aside>
        <h2 className="mb-4 text-lg font-semibold">New template</h2>
        <div className="card p-4">
          <NewBlockForm
            athleteId={null}
            programs={[]}
            templates={[]}
            ownBlocks={athleteBlocks.map((b) => ({ blockId: b.blockId, label: `${b.athleteName} · ${b.programName} · ${b.blockName}` }))}
            defaultStart={nextMonday}
          />
        </div>
      </aside>
    </div>
  );
}
