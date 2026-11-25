import Link from "next/link";
import { db } from "@/db";
import { pickTodaySession } from "@/lib/logging/session";
import { SessionLogger } from "@/components/logging/session-logger";
import { requireAthlete } from "@/server/auth";
import { listSessions, loadSessionForAthlete } from "@/server/logging";

export const metadata = { title: "Today" };

/** Opens to the next session in program order (see pickTodaySession). */
export default async function AthleteToday() {
  const { athlete } = await requireAthlete();
  const sessions = await listSessions(db, athlete.id);
  const next = pickTodaySession(sessions);

  if (!next) {
    return (
      <div className="py-10 text-center">
        <h1 className="text-lg font-semibold">Hi {athlete.name.split(" ")[0]}</h1>
        <p className="mt-2 text-sm text-muted">
          {sessions.length ? "You've finished every session in your program. Nice work." : "Your coach hasn't posted a program yet."}
        </p>
        {sessions.length > 0 && (
          <Link href="/athlete/program" className="btn-secondary mt-4">
            See your program
          </Link>
        )}
      </div>
    );
  }
  const data = await loadSessionForAthlete(db, athlete.id, next.id);
  return <SessionLogger key={next.id} data={data} />;
}
