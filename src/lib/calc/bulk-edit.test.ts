import { describe, expect, it } from "vitest";
import { applyBulkEdit, bulkEditTouches } from "./bulk-edit";
import { formatPrescription, rx } from "./shorthand";

const edit = (text: string, e: Parameters<typeof applyBulkEdit>[1], factor = 1) =>
  formatPrescription(rx(text).map((g) => applyBulkEdit(g, e, factor)));

describe("bulk edit", () => {
  it("adds percentage points to %TM targets and bounds", () => {
    expect(edit("4x6 72-77%", { kind: "pct", amount: 2.5 })).toBe("4x6 74.5-79.5%");
    expect(edit("3x5 @8 [70-75%]", { kind: "pct", amount: 2.5 })).toBe("3x5 @8 [72.5-77.5%]");
    expect(edit("3x3 80%e1rm", { kind: "pct", amount: 2 })).toBe("3x3 82%e1rm");
  });

  it("is progressive with a week factor (week 1 unchanged)", () => {
    expect(edit("5x5 70%", { kind: "pct", amount: 2.5 }, 0)).toBe("5x5 70%");
    expect(edit("5x5 70%", { kind: "pct", amount: 2.5 }, 1)).toBe("5x5 72.5%");
    expect(edit("5x5 70%", { kind: "pct", amount: 2.5 }, 3)).toBe("5x5 77.5%");
  });

  it("adds fixed load in either unit, keeping the written unit", () => {
    expect(edit("3x5 140-150kg", { kind: "load", amount: 5, unit: "kg" })).toBe("3x5 145-155kg");
    expect(edit("3x10 70-80lb", { kind: "load", amount: 5, unit: "lb" })).toBe("3x10 75-85lb");
    expect(edit("3x5 @7 [175-180kg]", { kind: "load", amount: 2.5, unit: "kg" })).toBe("3x5 @7 [177.5-182.5kg]");
  });

  it("moves RPE up and RIR down, snapped to 0.5 and clamped", () => {
    expect(edit("3x5 @7-7.5", { kind: "rpe", amount: 0.5 })).toBe("3x5 @7.5-8");
    expect(edit("3x5 rir2", { kind: "rpe", amount: 1 })).toBe("3x5 rir1");
    expect(edit("3x5 @9.5", { kind: "rpe", amount: 1 })).toBe("3x5 @10");
    expect(edit("3x5 rir0", { kind: "rpe", amount: 1 })).toBe("3x5 rir0");
  });

  it("changes sets and reps, never below 1, leaving AMRAP alone", () => {
    expect(edit("3x5 @8", { kind: "sets", amount: 1 })).toBe("4x5 @8");
    expect(edit("3-4x6-8 @8", { kind: "reps", amount: -1 })).toBe("3-4x5-7 @8");
    expect(edit("1x2 @8", { kind: "reps", amount: -3 })).toBe("1x1 @8");
    expect(edit("1xAMRAP 80% @9", { kind: "reps", amount: 2 })).toBe("1xAMRAP 80% @9");
  });

  it("leaves unrelated intensities untouched", () => {
    expect(edit("top 1 @8; 4x4 -10%", { kind: "pct", amount: 5 })).toBe("top 1 @8; 4x4 -10%");
    expect(edit("3x5 180kg", { kind: "pct", amount: 5 })).toBe("3x5 180kg");
  });

  it("reports whether an edit touches a cell", () => {
    expect(bulkEditTouches(rx("3x5 180kg"), { kind: "pct", amount: 5 })).toBe(false);
    expect(bulkEditTouches(rx("3x5 75%"), { kind: "pct", amount: 5 })).toBe(true);
  });
});
