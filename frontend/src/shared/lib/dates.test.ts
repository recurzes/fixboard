import { expect, it, vi } from "vitest";
import { formatDate, formatDateTime } from "./dates";

// Pinned, so setting the client's real zone does not break these tests.
vi.mock("./siteConfig", () => ({
  siteConfig: { timeZone: "America/Chicago" },
}));

// Intl may use a narrow no-break space before AM or PM.
const dateTime = (value: string | Date) =>
  formatDateTime(value).replace(/\s/g, " ");

it.each([
  // Winter is UTC-6, summer is UTC-5.
  ["2026-01-15T18:30:00Z", "01/15/2026, 12:30 PM"],
  ["2026-07-15T18:30:00Z", "07/15/2026, 1:30 PM"],
  // The clocks go forward at 2:00 AM on March 8, 2026, skipping the 2 o'clock hour.
  ["2026-03-08T07:59:00Z", "03/08/2026, 1:59 AM"],
  ["2026-03-08T08:00:00Z", "03/08/2026, 3:00 AM"],
  // They go back at 2:00 AM on November 1, 2026, repeating the 1 o'clock hour.
  ["2026-11-01T06:30:00Z", "11/01/2026, 1:30 AM"],
  ["2026-11-01T07:30:00Z", "11/01/2026, 1:30 AM"],
])("%s shows as %s", (utc, shown) => {
  expect(dateTime(utc)).toBe(shown);
  expect(dateTime(new Date(utc))).toBe(shown);
});

it("uses the company's date, not the UTC date", () => {
  expect(formatDate("2026-01-01T03:00:00Z")).toBe("12/31/2025");
  expect(dateTime("2026-01-01T03:00:00Z")).toBe("12/31/2025, 9:00 PM");
});
