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
