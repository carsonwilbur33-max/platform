import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { athletes, authSessions, invites, users } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";

export const SESSION_COOKIE = "platform_session";
const SESSION_DAYS = 60;
const REFRESH_WHEN_DAYS_LEFT = 30;
const DAY = 24 * 60 * 60 * 1000;
export const INVITE_DAYS = 7;

export type SessionUser = typeof users.$inferSelect;

export async function createSession(userId: string): Promise<void> {
  const token = randomToken();
  await db.insert(authSessions).values({ id: sha256(token), userId, expiresAt: new Date(Date.now() + SESSION_DAYS * DAY) });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(authSessions).where(eq(authSessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

/** The signed-in user, or null. Sessions slide: active sessions are extended in the database. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = sha256(token);
  const rows = await db
    .select({ user: users, expiresAt: authSessions.expiresAt })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(eq(authSessions.id, id), gt(authSessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() - Date.now() < REFRESH_WHEN_DAYS_LEFT * DAY) {
    await db.update(authSessions).set({ expiresAt: new Date(Date.now() + SESSION_DAYS * DAY) }).where(eq(authSessions.id, id));
  }
  return row.user;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireCoach(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "coach") redirect("/");
  return user;
}

/** The signed-in athlete. Athlete-facing queries must always scope by this athlete's id. */
export const requireAthlete = cache(async () => {
  const user = await requireUser();
  if (user.role !== "athlete") redirect("/");
  const athlete = await db.query.athletes.findFirst({ where: eq(athletes.userId, user.id) });
  if (!athlete) redirect("/login?error=no-athlete");
  return { user, athlete };
});

/** Create a single-use invite link token for an athlete (raw token is only returned once). */
export async function createInvite(athleteId: string): Promise<string> {
  const token = randomToken();
  // Revoke earlier unused invites for this athlete.
  await db.delete(invites).where(and(eq(invites.athleteId, athleteId), isNull(invites.usedAt)));
  await db.insert(invites).values({ tokenHash: sha256(token), athleteId, expiresAt: new Date(Date.now() + INVITE_DAYS * DAY) });
  return token;
}

export async function findValidInvite(token: string) {
  const rows = await db
    .select({ invite: invites, athlete: athletes })
    .from(invites)
    .innerJoin(athletes, eq(athletes.id, invites.athleteId))
    .where(and(eq(invites.tokenHash, sha256(token)), isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}
