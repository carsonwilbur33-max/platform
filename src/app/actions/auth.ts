"use server";

import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { athletes, invites, users } from "@/db/schema";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "@/lib/crypto";
import { createSession, destroySession, findValidInvite } from "@/server/auth";

export interface FormState {
  error?: string;
  /** Echo of submitted values so the form can restore them after React resets it. */
  values?: Record<string, string>;
}

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const values = { email: String(form.get("email") ?? "") };
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter your email and password.", values };
  const user = await db.query.users.findFirst({ where: eq(sql`lower(${users.email})`, parsed.data.email) });
  // Always run a hash comparison so response time doesn't reveal whether the email exists.
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  if (!user || !ok) return { error: "Email or password is incorrect.", values };
  await createSession(user.id);
  redirect(user.role === "coach" ? "/coach" : "/athlete");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

const acceptSchema = z
  .object({
    token: z.string().min(10),
    email: z.string().trim().toLowerCase().email("Enter a valid email."),
    password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match.", path: ["confirm"] });

export async function acceptInvite(_: FormState, form: FormData): Promise<FormState> {
  const values = { email: String(form.get("email") ?? "") };
  const parsed = acceptSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };
  const { token, email, password } = parsed.data;

  const found = await findValidInvite(token);
  if (!found) return { error: "This invite link has expired or was already used. Ask your coach for a new one.", values };
  if (found.athlete.userId) return { error: "This athlete already has an account. Log in instead.", values };
  const taken = await db.query.users.findFirst({ where: eq(sql`lower(${users.email})`, email) });
  if (taken) return { error: "That email already has an account.", values };

  const passwordHash = await hashPassword(password);
  const userId = await db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ email, passwordHash, role: "athlete", name: found.athlete.name }).returning();
    await tx.update(athletes).set({ userId: user.id, email }).where(eq(athletes.id, found.athlete.id));
    await tx.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, found.invite.id));
    return user.id;
  });
  await createSession(userId);
  redirect("/athlete");
}
