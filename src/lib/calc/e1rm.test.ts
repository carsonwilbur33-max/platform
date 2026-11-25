import { describe, expect, it } from "vitest";
import { brzycki, epley, estimateE1rm } from "./e1rm";
import { chartPct, DEFAULT_RPE_CHART, validateRpeChart, type RpeChart } from "./rpe-chart";

describe("default RPE chart", () => {
  const c = DEFAULT_RPE_CHART;
  it("has RPE 10 → 6 in half steps and 12 rep columns", () => {
    expect(c.rpes).toEqual([10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6]);
    expect(c.pct.every((row) => row.length === 12)).toBe(true);
  });

  it("matches published Tuchscherer values", () => {
    expect(chartPct(c, 1, 10)).toBe(100);
    expect(chartPct(c, 1, 9)).toBe(95.5);
    expect(chartPct(c, 1, 8)).toBe(92.2);
    expect(chartPct(c, 3, 8)).toBe(86.3);
    expect(chartPct(c, 5, 8)).toBe(81.1);
    expect(chartPct(c, 5, 7)).toBe(78.6);
    expect(chartPct(c, 8, 9)).toBe(76.2);
    expect(chartPct(c, 10, 10)).toBe(73.9);
    expect(chartPct(c, 12, 6)).toBe(57.4);
  });

  it("is a valid chart", () => {
    expect(validateRpeChart(c)).toEqual([]);
  });

  it("interpolates between half steps", () => {
    const v = chartPct(c, 1, 9.25)!;
    expect(v).toBeCloseTo((97.8 + 95.5) / 2, 5);
  });

  it("returns null outside the chart", () => {
    expect(chartPct(c, 13, 8)).toBeNull();
    expect(chartPct(c, 5, 5.5)).toBeNull();
    expect(chartPct(c, 0, 8)).toBeNull();
    expect(chartPct(c, 2.5, 8)).toBeNull();
  });

  it("validation catches bad edits", () => {
    const bad: RpeChart = { rpes: [10], pct: [[100, 101]] };
    expect(validateRpeChart(bad).length).toBeGreaterThan(0);
  });
});

describe("Epley / Brzycki", () => {
  it("1 rep returns the weight", () => {
    expect(epley(200, 1)).toBe(200);
    expect(brzycki(200, 1)).toBe(200);
  });
  it("formulas", () => {
    expect(epley(100, 10)).toBeCloseTo(133.333, 3);
    expect(brzycki(100, 10)).toBeCloseTo(133.333, 3);
    expect(epley(150, 5)).toBe(175);
    expect(brzycki(150, 5)).toBeCloseTo(168.75, 5);
  });
  it("Brzycki falls back past its asymptote", () => {
    expect(brzycki(50, 40)).toBe(epley(50, 40));
  });
});

describe("estimateE1rm", () => {
  it("uses the RPE chart when RPE is logged", () => {
    const r = estimateE1rm({ weightKg: 180, reps: 5, rpe: 8 });
    expect(r?.method).toBe("rpe-chart");
    expect(r?.e1rmKg).toBeCloseTo(180 / 0.811, 1); // 221.95
  });

  it("a single at RPE 10 is the 1RM", () => {
    expect(estimateE1rm({ weightKg: 230, reps: 1, rpe: 10 })?.e1rmKg).toBe(230);
  });

  it("falls back to Epley without RPE", () => {
    const r = estimateE1rm({ weightKg: 150, reps: 5 });
    expect(r).toEqual({ e1rmKg: 175, method: "epley" });
  });

  it("can use Brzycki instead", () => {
    const r = estimateE1rm({ weightKg: 150, reps: 5 }, { formula: "brzycki" });
    expect(r?.method).toBe("brzycki");
    expect(r?.e1rmKg).toBeCloseTo(168.75, 2);
  });

  it("uses reps + RIR with the formula when RPE is off-chart", () => {
    // 15 reps @ 8 → 17 effective reps to failure
    const r = estimateE1rm({ weightKg: 100, reps: 15, rpe: 8 });
    expect(r?.method).toBe("epley");
    expect(r?.e1rmKg).toBeCloseTo(100 * (1 + 17 / 30), 2);
  });

  it("respects an edited chart", () => {
    const chart: RpeChart = { rpes: [10, 9], pct: [[100, 90], [95, 85]] };
    expect(estimateE1rm({ weightKg: 170, reps: 2, rpe: 9 }, { chart })?.e1rmKg).toBe(200);
  });

  it("rejects invalid input", () => {
    expect(estimateE1rm({ weightKg: 0, reps: 5 })).toBeNull();
    expect(estimateE1rm({ weightKg: 100, reps: 0 })).toBeNull();
    expect(estimateE1rm({ weightKg: 100, reps: 3, rpe: 11 })).toBeNull();
  });
});
