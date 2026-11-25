import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { SessionLogger } from "@/components/logging/session-logger";
import { requireAthlete } from "@/server/auth";
import { loadSessionForAthlete, LoggingError } from "@/server/logging";

export const metadata = { title: "Session" };

export default async function AthleteSession({ params }: { params: Promise<{ workoutId: string }> }) {
  const { workoutId } = await params;
  const { athlete } = await requireAthlete();
  let data;
  try {
    data = await loadSessionForAthlete(db, athlete.id, workoutId);
  } catch (e) {
    // Someone else's session (or a bad id) looks the same as a missing one.
    if (e instanceof LoggingError) notFound();
    throw e;
  }
  return (
    <>
      <Link href="/athlete/program" className="mb-2 inline-block text-xs text-muted">
        ← Program
      </Link>
      <SessionLogger key={workoutId} data={data} />
    </>
  );
}
