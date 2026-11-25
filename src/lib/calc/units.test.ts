import { describe, expect, it } from "vitest";
import { clean, formatWeight, fromKg, KG_PER_LB, roundLoad, roundToIncrement, toKg } from "./units";

describe("unit conversion", () => {
  it("uses the exact pound definition", () => {
    expect(KG_PER_LB).toBe(0.45359237);
    expect(toKg(1, "lb")).toBe(0.45359237);
  });

  it("kg is identity", () => {
    expect(toKg(182.5, "kg")).toBe(182.5);
    expect(fromKg(182.5, "kg")).toBe(182.5);
  });

  it("converts common plate loads", () => {
    expect(clean(toKg(405, "lb"), 3)).toBe(183.705);
    expect(clean(fromKg(100, "kg"), 2)).toBe(100);
    expect(clean(fromKg(100, "lb"), 2)).toBe(220.46);
  });

  it("round-trips lb → kg → lb without drift", () => {
    for (const lb of [45, 135, 225, 315, 405, 495, 587.5, 1000]) {
      expect(clean(fromKg(toKg(lb, "lb"), "lb"), 6)).toBe(lb);
    }
  });
});

describe("roundToIncrement", () => {
  it("rounds to nearest 2.5", () => {
    expect(roundToIncrement(181.2, 2.5)).toBe(180);
    expect(roundToIncrement(181.3, 2.5)).toBe(182.5);
    expect(roundToIncrement(183.74, 2.5)).toBe(182.5);
    expect(roundToIncrement(183.75, 2.5)).toBe(185); // ties round up
  });

  it("rounds to nearest 5", () => {
    expect(roundToIncrement(402.4, 5)).toBe(400);
    expect(roundToIncrement(402.5, 5)).toBe(405);
  });

  it("supports small and odd increments", () => {
    expect(roundToIncrement(101.3, 1)).toBe(101);
    expect(roundToIncrement(101.3, 0.5)).toBe(101.5);
    expect(roundToIncrement(23.1, 2)).toBe(24); // dumbbells in 2 kg steps
    expect(roundToIncrement(101.3, 1.25)).toBe(101.25);
  });

  it("is robust to float noise at exact multiples", () => {
    expect(roundToIncrement(0.1 * 3 * 25, 2.5)).toBe(7.5);
    expect(roundToIncrement(200 * 0.725, 2.5)).toBe(145);
  });

  it("leaves the value alone for a non-positive increment", () => {
    expect(roundToIncrement(101.33, 0)).toBe(101.33);
  });
});

describe("roundLoad", () => {
  it("rounds in kg by default to 2.5", () => {
    expect(roundLoad(146.3, "kg")).toEqual({ value: 147.5, unit: "kg", kg: 147.5 });
  });

  it("converts to lb and rounds to 5 lb", () => {
    const r = roundLoad(183.7, "lb");
    expect(r.value).toBe(405);
    expect(r.kg).toBe(clean(405 * KG_PER_LB));
  });

  it("honours a custom increment", () => {
    expect(roundLoad(100, "lb", 2.5).value).toBe(220);
    expect(roundLoad(101, "kg", 1).value).toBe(101);
  });
});

describe("formatWeight", () => {
  it("formats without trailing zeros", () => {
    expect(formatWeight(180, "kg")).toBe("180 kg");
    expect(formatWeight(182.5, "kg", 2.5)).toBe("182.5 kg");
    expect(formatWeight(183.705, "lb", 5)).toBe("405 lb");
  });
});
