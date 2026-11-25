import { describe, expect, it } from "vitest";
import { addDays, daysBetween, formatShortDate, mondayOf, plannedDate, weekdayOf } from "./dates";

describe("dates", () => {
  it("weekday is Monday-based", () => {
    expect(weekdayOf("2026-11-23")).toBe(0); // Monday
    expect(weekdayOf("2026-11-29")).toBe(6); // Sunday
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("monday of a week", () => {
    expect(mondayOf("2026-11-25")).toBe("2026-11-23");
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
  });
  it("planned dates from block start, week and weekday", () => {
    expect(plannedDate("2026-11-16", 0, 0)).toBe("2026-11-16");
    expect(plannedDate("2026-11-16", 1, 2)).toBe("2026-11-25");
    expect(plannedDate("2026-11-16", 3, 5)).toBe("2026-12-12");
    // block starting on a Wednesday: a Monday day falls on the following Monday
    expect(plannedDate("2026-11-18", 0, 0)).toBe("2026-11-23");
  });
  it("days between", () => {
    expect(daysBetween("2026-11-25", "2027-03-14")).toBe(109);
  });
  it("formats", () => {
    expect(formatShortDate("2026-11-25")).toBe("Wed Nov 25");
  });
});
