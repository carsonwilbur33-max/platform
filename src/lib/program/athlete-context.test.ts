import { describe, expect, it } from "vitest";
import { rx } from "@/lib/calc/shorthand";
import { AthleteContext } from "./athlete-context";

const athlete = { unit: "kg" as const, roundingKg: 2.5, roundingLb: 5, e1rmFormula: "epley" as const };
const exercises = [
  { id: "sq", name: "Squat", parentId: null, defaultTmRatio: null },
  { id: "ssb", name: "SSB Squat", parentId: "sq", defaultTmRatio: 0.85 },
  { id: "fs", name: "Front Squat", parentId: "sq", defaultTmRatio: 0.8 },
  { id: "db", name: "DB Row", parentId: null, defaultTmRatio: null },
];
const tms = [
  { exerciseId: "sq", weightKg: 190, effectiveDate: "2026-10-01" },
  { exerciseId: "sq", weightKg: 200, effectiveDate: "2026-11-01" },
  { exerciseId: "fs", weightKg: 150, effectiveDate: "2026-11-01" },
];
const settings = [
  { exerciseId: "ssb", unit: null, rounding: null, tmRatio: 0.9 },
  { exerciseId: "db", unit: "lb" as const, rounding: 2.5, tmRatio: null },
];
const ctx = new AthleteContext(athlete, exercises, tms, settings);

describe("AthleteContext", () => {
  it("resolves dated TMs", () => {
    expect(ctx.tmFor("sq", "2026-10-15")).toBe(190);
    expect(ctx.tmFor("sq", "2026-11-20")).toBe(200);
    expect(ctx.tmFor("sq", "2026-09-01")).toBeNull();
  });

  it("variation: athlete ratio overrides exercise default", () => {
    expect(ctx.tmFor("ssb", "2026-11-20")).toBe(180); // 200 × 0.9 (not 0.85)
  });

  it("variation: own TM wins over parent ratio", () => {
    expect(ctx.tmFor("fs", "2026-11-20")).toBe(150);
  });

  it("per-exercise unit and rounding overrides", () => {
    expect(ctx.unitFor("sq")).toBe("kg");
    expect(ctx.unitFor("db")).toBe("lb");
    expect(ctx.unitFor("sq", "lb")).toBe("lb");
    expect(ctx.incrementFor("db", "lb")).toBe(2.5);
    expect(ctx.incrementFor("sq", "lb")).toBe(5);
  });

  it("suggests loads for a cell, previewing backoffs from the top set", () => {
    const s = ctx.suggestGroups("sq", "2026-11-20", rx("top 1 @8; 4x4 -10%"));
    expect(s[0]?.text).toBe("≈185 kg"); // 92.2% of 200 = 184.4
    expect(s[1]?.text).toBe("165 kg"); // 184.4 × 0.9 = 166 → 165
  });

  it("uses the actual top set when given", () => {
    const s = ctx.suggestGroups("sq", "2026-11-20", rx("top 1 @8; 4x4 -10%"), { actualTopSet: { weightKg: 190, reps: 1, rpe: 8 } });
    expect(s[1]?.text).toBe("170 kg"); // 171 → 170
  });

  it("shows lb for an lb-override exercise", () => {
    expect(ctx.suggestGroups("db", "2026-11-20", rx("3x10 70-80lb"))[0]?.text).toBe("70–80 lb");
  });
});
