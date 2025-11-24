let buildFakeDate = function (parts) {
  return {
    getFullYear: () => parts.year,
    getMonth: () => parts.month - 1,
    getDate: () => parts.day,
    getHours: () => parts.hour,
    getMinutes: () => parts.minute,
    getSeconds: () => parts.second,
    getMilliseconds: () => parts.millisecond,
    getTimezoneOffset: () => parts.timezoneOffsetMinutes,
  };
};
import { describe, expect, it } from "vitest";
import { formatLocalIsoWithOffset } from "./timestamps.js";
describe("formatLocalIsoWithOffset", () => {
  it("formats positive offset with millisecond padding", () => {
    const value = formatLocalIsoWithOffset(
      buildFakeDate({
        year: 2026,
        month: 1,
        day: 2,
        hour: 3,
        minute: 4,
        second: 5,
        millisecond: 6,
        timezoneOffsetMinutes: -150,
      }),
    );
    expect(value).toBe("2026-01-02T03:04:05.006+02:30");
  });
  it("formats negative offset", () => {
    const value = formatLocalIsoWithOffset(
      buildFakeDate({
        year: 2026,
        month: 12,
        day: 31,
        hour: 23,
        minute: 59,
        second: 58,
        millisecond: 321,
        timezoneOffsetMinutes: 300,
      }),
    );
    expect(value).toBe("2026-12-31T23:59:58.321-05:00");
  });
});
