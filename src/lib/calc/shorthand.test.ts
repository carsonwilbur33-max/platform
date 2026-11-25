import { describe, expect, it } from "vitest";
import { formatPrescription, parsePrescription, rx } from "./shorthand";
import { toKg } from "./units";

const one = (s: string) => {
  const g = rx(s);
  expect(g).toHaveLength(1);
  return g[0];
};

describe("parse: sets and reps", () => {
  it("fixed sets × reps", () => {
    expect(one("3x5")).toMatchObject({ mode: "straight", sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, target: null, bounds: [] });
  });
  it("ranges for sets and reps", () => {
    expect(one("3-4x6-8")).toMatchObject({ sets: { min: 3, max: 4 }, reps: { min: 6, max: 8 } });
  });
  it("tolerates spaces, ×, and en dashes", () => {
    expect(one("3 × 6–8 @ 7–8")).toEqual(one("3x6-8 @7-8"));
    expect(one("3 X 5 180 kg")).toEqual(one("3x5 180kg"));
  });
  it("AMRAP", () => {
    expect(one("AMRAP")).toMatchObject({ sets: { min: 1, max: 1 }, reps: "amrap" });
    expect(one("2xAMRAP")).toMatchObject({ sets: { min: 2, max: 2 }, reps: "amrap" });
  });
  it("bare reps means one set", () => {
    expect(one("5 @8")).toMatchObject({ sets: { min: 1, max: 1 }, reps: { min: 5, max: 5 } });
  });
});

describe("parse: intensity types", () => {
  it("RPE single and range in 0.5 steps", () => {
    expect(one("3x5 @8").target).toEqual({ kind: "rpe", min: 8, max: 8 });
    expect(one("3x5 @7-7.5").target).toEqual({ kind: "rpe", min: 7, max: 7.5 });
  });
  it("rejects RPE not in 0.5 steps or out of range", () => {
    expect(parsePrescription("3x5 @7.3").ok).toBe(false);
    expect(parsePrescription("3x5 @11").ok).toBe(false);
  });
  it("RIR, both spellings", () => {
    expect(one("3x5 rir2").target).toEqual({ kind: "rir", min: 2, max: 2 });
    expect(one("3x5 1-2rir").target).toEqual({ kind: "rir", min: 1, max: 2 });
    expect(one("3x5 RIR 1-2").target).toEqual({ kind: "rir", min: 1, max: 2 });
  });
  it("% of training max", () => {
    expect(one("5x5 75%").target).toEqual({ kind: "pct1rm", min: 75, max: 75 });
    expect(one("4x6 72-77%").target).toEqual({ kind: "pct1rm", min: 72, max: 77 });
  });
  it("fixed load in kg and lb", () => {
    expect(one("3x5 180kg").target).toEqual({ kind: "load", minKg: 180, maxKg: 180, unit: "kg" });
    const lb = one("3x8 135-145lbs").target;
    expect(lb).toEqual({ kind: "load", minKg: toKg(135, "lb"), maxKg: toKg(145, "lb"), unit: "lb" });
  });
  it("backoff drop from top set", () => {
    expect(one("4x4 -8%").target).toEqual({ kind: "drop", min: 8, max: 8 });
    expect(one("4x4 -5-10%").target).toEqual({ kind: "drop", min: 5, max: 10 });
  });
  it("% of today's top-set e1RM", () => {
    expect(one("3x3 80%e1rm").target).toEqual({ kind: "pctE1rm", min: 80, max: 80 });
    expect(one("3x3 78-82% e1rm").target).toEqual({ kind: "pctE1rm", min: 78, max: 82 });
  });
  it("requires a unit on loads", () => {
    const r = parsePrescription("3x5 180");
    expect(r.ok).toBe(false);
  });
});

describe("parse: targets and hard bounds", () => {
  it("RPE target with load bound (the brief's example)", () => {
    const g = one("3x5 @7-7.5 [175-180kg]");
    expect(g.target).toEqual({ kind: "rpe", min: 7, max: 7.5 });
    expect(g.bounds).toEqual([{ kind: "load", minKg: 175, maxKg: 180, unit: "kg" }]);
  });
  it("% target with RPE bound", () => {
    const g = one("3x3 80% [@6-8.5]");
    expect(g.target).toEqual({ kind: "pct1rm", min: 80, max: 80 });
    expect(g.bounds).toEqual([{ kind: "rpe", min: 6, max: 8.5 }]);
  });
  it("multiple bounds, inside one bracket or several", () => {
    expect(one("3x5 @8 [70-80% @9]").bounds).toHaveLength(2);
    expect(one("3x5 @8 [70-80%] [@9]").bounds).toHaveLength(2);
  });
  it("bound with no target", () => {
    const g = one("3x5 [175-180kg]");
    expect(g.target).toBeNull();
    expect(g.bounds).toHaveLength(1);
  });
  it("rejects two targets without brackets", () => {
    const r = parsePrescription("3x5 @8 180kg");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/brackets/);
  });
});

describe("parse: special modes", () => {
  it("work up to a top single/double/triple", () => {
    expect(one("top 1 @8")).toMatchObject({ mode: "workUp", sets: { min: 1, max: 1 }, reps: { min: 1, max: 1 }, target: { kind: "rpe", min: 8, max: 8 } });
    expect(one("top 3 @8.5")).toMatchObject({ mode: "workUp", reps: { min: 3, max: 3 } });
  });
  it("repeat until RPE, with and without a cap", () => {
    expect(one("4 -8% until @9")).toMatchObject({ mode: "repeatUntil", sets: null, reps: { min: 4, max: 4 }, repeatUntilRpe: 9, target: { kind: "drop" } });
    expect(one("4 -8% until@9 max6").maxSets).toBe(6);
    expect(one("3 150kg until @8 cap 5").maxSets).toBe(5);
  });
  it("repeat until rejects fixed sets and missing load", () => {
    expect(parsePrescription("3x4 -8% until @9").ok).toBe(false);
    expect(parsePrescription("4 until @9").ok).toBe(false);
  });
  it("AMRAP with RPE cap", () => {
    const g = one("1xAMRAP 80% @9");
    expect(g.target).toEqual({ kind: "pct1rm", min: 80, max: 80 });
    expect(g.amrapRpeCap).toBe(9);
    expect(one("AMRAP @9")).toMatchObject({ target: null, amrapRpeCap: 9 });
  });
  it("multiple set groups per cell", () => {
    expect(rx("top 1 @8; 4x4 -8%")).toHaveLength(2);
    expect(rx("top 1 @8\n4x4 -8%\n")).toHaveLength(2);
  });
});

describe("parse errors", () => {
  it.each([
    ["", true],
    ["3x5 banana", false],
    ["3x5 @8 [", false],
    ["5-3x5", false],
    ["3x0", false],
    ["top 1 @8 until @9", false],
  ])("%s", (input, ok) => {
    expect(parsePrescription(input).ok).toBe(ok);
  });
  it("reports which group failed", () => {
    const r = parsePrescription("3x5 @8; 3x5 nope");
    expect(r).toMatchObject({ ok: false, group: 1 });
  });
});

describe("format round trip", () => {
  it.each([
    "3x5 @8",
    "3-4x6-8 @7-8",
    "3x5 rir1-2",
    "4x6 72-77%",
    "3x5 180kg",
    "3x8 135-145lb",
    "3x5 @7-7.5 [175-180kg]",
    "top 1 @8",
    "4x4 -8%",
    "3x3 80%e1rm",
    "4 -8% until @9 max6",
    "1xAMRAP 80% @9",
    "3x3 80% [@6-8.5]",
  ])("%s", (s) => {
    const g = rx(s);
    expect(formatPrescription(g)).toBe(s);
    expect(rx(formatPrescription(g))).toEqual(g);
  });

  it("normalizes sloppy input", () => {
    expect(formatPrescription(rx("Top 1 @ 8 ;  4 X 4 -8 %"))).toBe("top 1 @8; 4x4 -8%");
    expect(formatPrescription(rx("3x5 405 lbs"))).toBe("3x5 405lb");
  });
});
