import { describe, expect, it } from "vitest";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const h = await hashPassword("correct horse");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("salts hashes", async () => {
    expect(await hashPassword("x")).not.toBe(await hashPassword("x"));
  });
  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "nope")).toBe(false);
  });
  it("tokens are random and hash deterministically", () => {
    const t = randomToken();
    expect(t).not.toBe(randomToken());
    expect(sha256(t)).toBe(sha256(t));
    expect(sha256(t)).toHaveLength(64);
  });
});
