import { asc, isNull } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { athletes } from "@/db/schema";
import { NewAthleteForm } from "./new-athlete-form";

export const metadata = { title: "Athletes" };

export default async function CoachHome() {
  const list = await db.select().from(athletes).where(isNull(athletes.archivedAt)).orderBy(asc(athletes.name));
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section>
        <h1 className="mb-4 text-lg font-semibold">Athletes</h1>
        <div className="card divide-y divide-border">
          {list.length === 0 && <p className="p-4 text-sm text-muted">No athletes yet.</p>}
          {list.map((a) => (
            <Link key={a.id} href={`/coach/athletes/${a.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-surface-2">
              <div>
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-muted">{a.email ?? "No email"}</div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">{a.unit}</span>
                {a.userId ? (
                  <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent">active</span>
                ) : (
                  <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn">not invited</span>
                )}
              </div>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">The roster dashboard (who trained, missed sessions, unread notes, PRs) arrives in Phase 4.</p>
      </section>
      <aside>
        <h2 className="mb-4 text-lg font-semibold">Add athlete</h2>
        <NewAthleteForm />
      </aside>
    </div>
  );
}
