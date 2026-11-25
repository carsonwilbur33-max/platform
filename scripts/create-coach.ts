/**
 * Create (or reset the password of) the coach account on any database:
 *   npm run create-coach -- you@example.com "Your Name"
 * Prompts for the password so it never lands in shell history.
 */
import { eq } from "drizzle-orm";
import { createInterface } from "node:readline/promises";
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../src/lib/crypto";

const [email, ...nameParts] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run create-coach -- you@example.com "Your Name"');
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question("Password: ");
rl.close();
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  process.exit(1);
}
const passwordHash = await hashPassword(password);
const existing = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
if (existing) {
  await db.update(users).set({ passwordHash, role: "coach" }).where(eq(users.id, existing.id));
  console.log(`Updated password for ${email}.`);
} else {
  await db.insert(users).values({ email: email.toLowerCase(), passwordHash, role: "coach", name: nameParts.join(" ") || "Coach" });
  console.log(`Created coach ${email}.`);
}
process.exit(0);
