import { describe, it, expect } from "vitest";
import { dayStart, dayEnd, localDay, monthStart, isValidTimezone } from "../src/lib/time";

describe("timezone boundaries", () => {
  it("Cairo winter (UTC+2)", () => {
    expect(dayStart("2026-01-15", "Africa/Cairo").toISOString()).toBe("2026-01-14T22:00:00.000Z");
    expect(dayEnd("2026-01-15", "Africa/Cairo").toISOString()).toBe("2026-01-15T21:59:59.999Z");
  });

  it("Cairo summer DST (UTC+3)", () => {
    expect(dayStart("2026-07-15", "Africa/Cairo").toISOString()).toBe("2026-07-14T21:00:00.000Z");
  });

  it("other zones and UTC", () => {
    expect(dayStart("2026-03-01", "UTC").toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(dayStart("2026-03-01", "Asia/Riyadh").toISOString()).toBe("2026-02-28T21:00:00.000Z");
    expect(dayStart("2026-03-01", "America/New_York").toISOString()).toBe("2026-03-01T05:00:00.000Z");
  });

  it("local day and month start", () => {
    // 23:30 UTC on Jan 31 is already Feb 1 in Cairo.
    const at = new Date("2026-01-31T23:30:00Z");
    expect(localDay(at, "Africa/Cairo")).toBe("2026-02-01");
    expect(monthStart(at, "Africa/Cairo").toISOString()).toBe("2026-01-31T22:00:00.000Z");
    expect(monthStart(at, "UTC").toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("validates IANA names", () => {
    expect(isValidTimezone("Africa/Cairo")).toBe(true);
    expect(isValidTimezone("Mars/Base")).toBe(false);
  });
});
