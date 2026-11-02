import { siteConfig } from "./siteConfig";

const DATE_PARTS = {
  timeZone: siteConfig.timeZone,
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
} as const;
const DATE = new Intl.DateTimeFormat("en-US", DATE_PARTS);
const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  ...DATE_PARTS,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatDate(value: string | Date) {
  return DATE.format(new Date(value));
}

export function formatDateTime(value: string | Date) {
  return DATE_TIME.format(new Date(value));
}

const WALL = new Intl.DateTimeFormat("en-US", {
  timeZone: siteConfig.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function wallParts(ms: number) {
  const parts = Object.fromEntries(
    WALL.formatToParts(ms).map(({ type, value }) => [type, value]),
  );
  return parts as Record<"year" | "month" | "day" | "hour" | "minute", string>;
}

/** The company clock minus UTC, at a moment. */
function offsetAt(ms: number) {
  const { year, month, day, hour, minute } = wallParts(ms);
  return Date.UTC(+year, +month - 1, +day, +hour, +minute) - ms;
}

/** A UTC ISO string as a `datetime-local` value on the company clock. */
export function toLocalInput(iso: string) {
  const { year, month, day, hour, minute } = wallParts(Date.parse(iso));
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A `datetime-local` value on the company clock as a UTC ISO string. */
export function toUtcIso(local: string) {
  const wall = Date.parse(`${local}Z`);
  const before = offsetAt(wall - DAY_MS);
  const after = offsetAt(wall + DAY_MS);
  const fits = [wall - before, wall - after].filter(
    (ms) => offsetAt(ms) === wall - ms,
  );
  // The repeated hour fits both offsets, so the first one wins. The skipped hour fits neither, so it moves forward, as clocks do.
  return new Date(
    fits.length ? Math.min(...fits) : wall - before,
  ).toISOString();
}
