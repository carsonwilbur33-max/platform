import { describe, expect, it } from "vitest";
import { rx } from "@/lib/calc/shorthand";
import { describeTarget, normalizeVideoUrl, pickTodaySession, pickTopSet, repeatUntilDone, setRows, type SessionRef } from "./session";

const sg = (s: string) => rx(s)[0];
const L = (weightKg: number, reps: number, rpe: number | null = null) => ({ weightKg, reps, rpe });

describe("setRows", () => {
  it("fixed sets are all required", () => {
    expect(setRows(sg("3x5 @8"), []).map((r) => r.kind)).toEqual(["required", "required", "required"]);
  });
  it("a set range makes the extra sets optional", () => {
    const rows = setRows(sg("3-4x6-8 @8"), []);
    expect(rows.map((r) => r.kind)).toEqual(["required", "required", "required", "optional"]);
    expect(rows[3].label).toBe("Set 4 (optional)");
  });
  it("work-up sets are named by rep count", () => {
    expect(setRows(sg("top 1 @8"), [])[0].label).toBe("Top single");
    expect(setRows(sg("top 3 @8"), [])[0].label).toBe("Top triple");
    expect(setRows(sg("top 5 @8"), [])[0].label).toBe("Top set");
  });
  it("sets logged beyond the plan show as extra", () => {
    const rows = setRows(sg("2x5 @8"), [L(100, 5), L(100, 5), L(100, 5)]);
    expect(rows.map((r) => r.kind)).toEqual(["required", "required", "extra"]);
  });
  it("repeat-until offers one more set until the stop RPE or the cap", () => {
    const g = sg("4 -8% until @9 max4");
    expect(setRows(g, [])).toHaveLength(1);
    expect(setRows(g, [L(170, 4, 8)])).toHaveLength(2);
    expect(setRows(g, [L(170, 4, 8), L(170, 4, 9)])).toHaveLength(2); // reached @9: done
    expect(repeatUntilDone(g, [L(170, 4, 8), L(170, 4, 9)])).toBe(true);
    expect(repeatUntilDone(g, [L(1, 4, 7), L(1, 4, 7), L(1, 4, 7), L(1, 4, 7)])).toBe(true); // cap
    expect(repeatUntilDone(g, [L(170, 4, null)])).toBe(false);
  });
});

describe("describeTarget", () => {
  it("reads like a coach would say it", () => {
    expect(describeTarget(sg("3x5 @7-7.5 [175-180kg]"))).toBe("5 reps · RPE 7–7.5 · stay within 175–180 kg");
    expect(describeTarget(sg("3x6-8 rir2"))).toBe("6–8 reps · 2 RIR");
    expect(describeTarget(sg("4x4 -8%"))).toBe("4 reps · 8% below top set");
    expect(describeTarget(sg("1xAMRAP 80% @9"))).toBe("as many reps as possible · 80% of TM · stop at RPE 9");
    expect(describeTarget(sg("4 -8% until @9 max5"))).toBe("4 reps · 8% below top set · repeat until RPE 9 (max 5 sets)");
    expect(describeTarget(sg("3x3 80%e1rm"))).toBe("3 reps · 80% of top-set e1RM");
  });
});

describe("pickTopSet", () => {
  it("takes the heaviest, latest on ties", () => {
    expect(pickTopSet([L(180, 1, 7), L(190, 1, 8), L(185, 1, 9)])).toEqual({ weightKg: 190, reps: 1, rpe: 8 });
    expect(pickTopSet([L(190, 1, 8), L(190, 1, 8.5)])?.rpe).toBe(8.5);
    expect(pickTopSet([])).toBeNull();
  });
});

describe("pickTodaySession", () => {
  const s = (id: string, completed = false, inProgress = false): SessionRef => ({ id, plannedDate: null, completed, inProgress });
  it("the next session after the last completed one", () => {
    expect(pickTodaySession([s("a", true), s("b", true), s("c"), s("d")])?.id).toBe("c");
  });
  it("a skipped session doesn't block the way forward", () => {
    expect(pickTodaySession([s("a", true), s("b"), s("c", true), s("d")])?.id).toBe("d");
  });
  it("an in-progress session wins", () => {
    expect(pickTodaySession([s("a", true), s("b", false, true), s("c")])?.id).toBe("b");
  });
  it("first session of a new program, and nothing left", () => {
    expect(pickTodaySession([s("a"), s("b")])?.id).toBe("a");
    expect(pickTodaySession([s("a", true)])).toBeNull();
    expect(pickTodaySession([])).toBeNull();
  });
});

describe("normalizeVideoUrl", () => {
  it("accepts http(s) links and adds https to bare ones", () => {
    expect(normalizeVideoUrl("https://youtu.be/abc")).toBe("https://youtu.be/abc");
    expect(normalizeVideoUrl("drive.google.com/file/d/x/view")).toBe("https://drive.google.com/file/d/x/view");
    expect(normalizeVideoUrl("  ")).toBeNull();
  });
  it("rejects scripts and junk", () => {
    expect(normalizeVideoUrl("javascript:alert(1)")).toBe("invalid");
    expect(normalizeVideoUrl("data:text/html,hi")).toBe("invalid");
    expect(normalizeVideoUrl("not a url")).toBe("invalid");
    expect(normalizeVideoUrl("https://" + "a".repeat(600) + ".com")).toBe("invalid");
  });
});
