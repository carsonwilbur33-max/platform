import { describe, expect, it } from "vitest";
import { checkLoggedSet } from "./deviation";
import { effectiveTm, estimateTopSet, findTopSetGroup, formatSuggestion, roundSuggestion, suggestLoad, tmAsOf } from "./load";
import { rx } from "./shorthand";
import { KG_PER_LB } from "./units";

const sg = (s: string) => rx(s)[0];
const kg = (s: string, tmKg: number | null = 200, extra = {}) => {
  const r = suggestLoad(sg(s), { tmKg, ...extra });
  return r && roundSuggestion(r, "kg");
};

describe("training max resolution", () => {
  it("own TM wins over parent ratio", () => {
    expect(effectiveTm(180, 200, 0.9)).toBe(180);
  });
  it("derives from parent × ratio", () => {
    expect(effectiveTm(null, 200, 0.9)).toBe(180);
  });
  it("null when nothing applies", () => {
    expect(effectiveTm(null, 200, null)).toBeNull();
    expect(effectiveTm(null, null, 0.9)).toBeNull();
  });
  it("picks the TM effective on a date", () => {
    const tms = [
      { weightKg: 190, effectiveDate: "2026-09-01" },
      { weightKg: 200, effectiveDate: "2026-10-15" },
      { weightKg: 210, effectiveDate: "2026-12-01" },
    ];
    expect(tmAsOf(tms, "2026-08-31")).toBeNull();
    expect(tmAsOf(tms, "2026-10-14")?.weightKg).toBe(190);
    expect(tmAsOf(tms, "2026-10-15")?.weightKg).toBe(200);
    expect(tmAsOf(tms, "2026-11-25")?.weightKg).toBe(200);
  });
});

describe("suggestLoad", () => {
  it("% of TM, rounded to 2.5 kg", () => {
    expect(kg("5x5 75%")).toMatchObject({ min: 150, max: 150, basis: "tm", estimate: false });
    // 72% = 144 → 145, 77% = 154 → 155
    expect(kg("4x6 72-77%")).toMatchObject({ min: 145, max: 155 });
  });

  it("fixed load needs no TM", () => {
    expect(kg("3x5 180kg", null)).toMatchObject({ min: 180, max: 180, basis: "fixed" });
  });

  it("fixed load written in lb displays in kg and lb", () => {
    const s = suggestLoad(sg("3x5 405lb"), { tmKg: null })!;
    expect(roundSuggestion(s, "lb").min).toBe(405);
    expect(roundSuggestion(s, "kg").min).toBe(182.5); // 183.7 → 182.5
  });

  it("RPE estimates from TM and the chart", () => {
    // 3x5 @8 → 81.1% of 200 = 162.2 → 162.5
    expect(kg("3x5 @8")).toMatchObject({ min: 162.5, max: 162.5, estimate: true, basis: "rpe-estimate" });
    // 3x6-8 @7-8: lightest = 8 reps @7 (70.7%) = 141.4 → 142.5; heaviest = 6 reps @8 (78.6%) = 157.2 → 157.5
    expect(kg("3x6-8 @7-8")).toMatchObject({ min: 142.5, max: 157.5 });
  });

  it("RIR is the same as RPE = 10 − RIR", () => {
    expect(kg("3x5 rir2")).toEqual(kg("3x5 @8"));
    expect(kg("3x5 rir1-2")).toEqual(kg("3x5 @8-9"));
  });

  it("RPE target is clamped into a hard load bound", () => {
    // 5 reps @7–7.5 = 78.6–79.9%. Off TM 225: 176.9–179.8 → inside 175–180, not clamped
    const inside = kg("3x5 @7-7.5 [175-180kg]", 225)!;
    expect(inside).toMatchObject({ min: 177.5, max: 180, clamped: false });
    // Off TM 250 the RPE range is 196.5–199.8, so it clamps to the bound's top
    const clamped = kg("3x5 @7-7.5 [175-180kg]", 250)!;
    expect(clamped).toMatchObject({ min: 180, max: 180, clamped: true });
  });

  it("uses the bound when the target can't produce a load", () => {
    expect(kg("3x5 @8 [175-180kg]", null)).toMatchObject({ min: 175, max: 180, basis: "fixed" });
  });

  it("an RPE bound doesn't change the load", () => {
    expect(kg("3x3 80% [@6-8.5]")).toMatchObject({ min: 160, max: 160 });
  });

  it("backoff drop from the actual top set", () => {
    const topSet = { weightKg: 200, reps: 1, rpe: 8 };
    expect(kg("4x4 -8%", 200, { topSet })).toMatchObject({ min: 185, max: 185, basis: "top-set" }); // 184 → 185
    expect(kg("4x4 -5-10%", 200, { topSet })).toMatchObject({ min: 180, max: 190 });
    expect(kg("4x4 -8%", 200)).toBeNull(); // no top set yet
  });

  it("backoff as % of the top set's e1RM", () => {
    // 200 x1 @8 → e1RM 216.9; 80% = 173.5 → 172.5
    expect(kg("3x3 80%e1rm", 200, { topSet: { weightKg: 200, reps: 1, rpe: 8 } })).toMatchObject({ min: 172.5, basis: "top-e1rm" });
  });

  it("AMRAP with only an RPE cap has no suggestion; with % it does", () => {
    expect(kg("AMRAP @9")).toBeNull();
    expect(kg("1xAMRAP 80% @9")).toMatchObject({ min: 160 });
  });

  it("rounds to the athlete's unit and increment", () => {
    const s = suggestLoad(sg("5x5 75%"), { tmKg: 200 })!; // 150 kg = 330.7 lb
    expect(roundSuggestion(s, "lb", 5).min).toBe(330);
    expect(roundSuggestion(s, "lb", 2.5).min).toBe(330);
    expect(roundSuggestion(s, "kg", 1).min).toBe(150);
    expect(roundSuggestion(s, "lb", 5).minKg).toBeCloseTo(330 * KG_PER_LB, 3);
  });

  it("formats", () => {
    expect(formatSuggestion(kg("4x6 72-77%")!)).toBe("145–155 kg");
    expect(formatSuggestion(kg("3x5 @8")!)).toBe("≈162.5 kg");
  });
});

describe("top set lookup for backoffs", () => {
  it("finds the nearest earlier non-backoff group", () => {
    const groups = rx("top 1 @8; 3x3 -8%; 2x5 -15%");
    expect(findTopSetGroup(groups, 1)).toBe(groups[0]);
    expect(findTopSetGroup(groups, 2)).toBe(groups[0]);
    expect(findTopSetGroup(groups, 0)).toBeNull();
  });
  it("estimates the top set for coach-side previews", () => {
    const top = estimateTopSet(sg("top 1 @8"), { tmKg: 200 })!;
    expect(top.weightKg).toBeCloseTo(184.4, 1); // 92.2% of 200
    expect(top.rpe).toBe(8);
  });
});

describe("checkLoggedSet (deviation flags)", () => {
  const ctx = { tmKg: 200 };

  it("no flags when on target", () => {
    expect(checkLoggedSet(sg("3x5 @7-7.5 [175-180kg]"), { weightKg: 177.5, reps: 5, rpe: 7.5 }, ctx)).toEqual([]);
  });

  it("flags RPE above the target range", () => {
    const f = checkLoggedSet(sg("3x5 @7-7.5 [175-180kg]"), { weightKg: 177.5, reps: 5, rpe: 8.5 }, ctx);
    expect(f).toEqual([expect.objectContaining({ kind: "rpe_high", hardBound: false })]);
  });

  it("flags RPE below the target range", () => {
    expect(checkLoggedSet(sg("3x5 @7-7.5"), { weightKg: 150, reps: 5, rpe: 6 }, ctx)[0].kind).toBe("rpe_low");
  });

  it("flags load outside a hard bound", () => {
    const f = checkLoggedSet(sg("3x5 @7-7.5 [175-180kg]"), { weightKg: 185, reps: 5, rpe: 7 }, ctx);
    expect(f).toEqual([expect.objectContaining({ kind: "load_high", hardBound: true })]);
    expect(checkLoggedSet(sg("3x5 @7 [175-180kg]"), { weightKg: 170, reps: 5, rpe: 7 }, ctx)[0].kind).toBe("load_low");
  });

  it("allows rounding tolerance on load", () => {
    // 72% of 200 = 144; 145 is the rounded suggestion and must not flag
    expect(checkLoggedSet(sg("4x6 72%"), { weightKg: 145, reps: 6 }, ctx)).toEqual([]);
    // lb athlete: 405 lb = 183.7 kg against a 180-185 kg bound
    expect(checkLoggedSet(sg("3x5 [180-185kg]"), { weightKg: 405 * KG_PER_LB, reps: 5 }, ctx)).toEqual([]);
  });

  it("flags RPE outside an RPE bound as hard", () => {
    const f = checkLoggedSet(sg("3x3 80% [@6-8.5]"), { weightKg: 160, reps: 3, rpe: 9 }, ctx);
    expect(f).toEqual([expect.objectContaining({ kind: "rpe_high", hardBound: true })]);
  });

  it("flags missed and extra reps", () => {
    expect(checkLoggedSet(sg("3x6-8 @8"), { weightKg: 150, reps: 5, rpe: 8 }, ctx)[0].kind).toBe("reps_low");
    expect(checkLoggedSet(sg("3x5 @8"), { weightKg: 150, reps: 6, rpe: 8 }, ctx)[0].kind).toBe("reps_high");
  });

  it("AMRAP: no rep flag, but the RPE cap is a hard bound", () => {
    expect(checkLoggedSet(sg("1xAMRAP 80% @9"), { weightKg: 160, reps: 9, rpe: 9 }, ctx)).toEqual([]);
    expect(checkLoggedSet(sg("1xAMRAP 80% @9"), { weightKg: 160, reps: 10, rpe: 10 }, ctx)[0]).toMatchObject({ kind: "rpe_high", hardBound: true });
  });

  it("backoff loads check against the actual top set", () => {
    const top = { weightKg: 200, reps: 1, rpe: 8 };
    expect(checkLoggedSet(sg("4x4 -8%"), { weightKg: 185, reps: 4 }, { ...ctx, topSet: top })).toEqual([]);
    expect(checkLoggedSet(sg("4x4 -8%"), { weightKg: 195, reps: 4 }, { ...ctx, topSet: top })[0].kind).toBe("load_high");
  });

  it("repeat-until sets don't flag rising RPE", () => {
    const top = { weightKg: 200, reps: 1, rpe: 8 };
    expect(checkLoggedSet(sg("4 -8% until @9"), { weightKg: 185, reps: 4, rpe: 9 }, { ...ctx, topSet: top })).toEqual([]);
  });

  it("RPE not logged: no RPE flags", () => {
    expect(checkLoggedSet(sg("3x5 @8"), { weightKg: 150, reps: 5 }, ctx)).toEqual([]);
  });
});
