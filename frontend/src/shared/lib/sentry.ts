import * as Sentry from "@sentry/react";

const FILTERED = "[Filtered]";
const SENSITIVE_KEY_PARTS = [
  "phone",
  "email",
  "description",
  "followup_answers",
  "tenant_name",
  "entry_notes",
  "password",
  "token",
  "authorization",
  "cookie",
];
// Personal data can also end up inside exception messages.
const SENSITIVE_VALUE = new RegExp(
  [
    String.raw`[\w.+-]+@[\w-]+\.[\w.-]+`, // email
    String.raw`bearer\s+[\w.~+/=-]+`, // bearer token
    String.raw`\beyJ[\w-]+\.[\w-]+\.[\w-]+`, // JWT
    String.raw`(?<![\w-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b`, // US phone
  ].join("|"),
  "gi",
);
// Signed photo links work as passwords, and staff search terms sit in query strings.
const URL_QUERY = /((?:https?:\/\/|\/)[^\s?#"']*)[?#][^\s"']*/gi;

function scrub(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(URL_QUERY, "$1").replace(SENSITIVE_VALUE, FILTERED);
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        SENSITIVE_KEY_PARTS.some((part) => key.toLowerCase().includes(part))
          ? FILTERED
          : scrub(v),
      ]),
    );
  }
  return value;
}

function scrubEvent(event: Sentry.ErrorEvent) {
  delete event.request?.data;
  delete event.request?.cookies;
  delete event.request?.query_string;
  return scrub(event) as Sentry.ErrorEvent;
}

export function initSentry(dsn: string | undefined) {
  if (!dsn) return;
  Sentry.init({
    dsn,
    beforeSend: scrubEvent,
    // Console lines can hold form values, and DOM breadcrumbs describe inputs.
    integrations: (defaults) => [
      ...defaults.filter(({ name }) => name !== "Console"),
      Sentry.breadcrumbsIntegration({ dom: false }),
    ],
  });
}
