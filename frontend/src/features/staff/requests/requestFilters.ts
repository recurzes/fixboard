export const STATUSES = [
  "new",
  "scheduled",
  "waiting_on_vendor",
  "done",
] as const;
export type RequestStatus = (typeof STATUSES)[number];

export type RequestFilters = {
  property: string[];
  status: RequestStatus[];
  category: string[];
  needs_review: boolean;
  urgent: boolean;
  include_done: boolean;
  q: string;
};

// The backend's limits, so an edited URL shows a list instead of a 422 that Retry can't fix.
const MAX_ID = 2 ** 31 - 1;
const isId = (value: string) =>
  /^[1-9]\d*$/.test(value) && Number(value) <= MAX_ID;
const isText = (value: string) => value.length <= 200 && !value.includes("\0");
const isStatus = (value: string): value is RequestStatus =>
  (STATUSES as readonly string[]).includes(value);

/** The URL can hold anything, so only what the API accepts comes out. */
export function parseFilters(params: URLSearchParams): RequestFilters {
  const status = params.getAll("status").filter(isStatus);
  const q = params.get("q")?.trim() ?? "";
  return {
    property: params.getAll("property").filter(isId),
    status,
    category: params.getAll("category").filter(isText),
    needs_review: params.get("needs_review") === "true",
    urgent: params.get("urgent") === "true",
    // A status filter overrides this on the backend, so the two never travel together.
    include_done: !status.length && params.get("include_done") === "true",
    q: isText(q) ? q : "",
  };
}

/** Uses the API's parameter names, so this is both the page URL and the request. */
export function serializeFilters(filters: RequestFilters) {
  const params = new URLSearchParams();
  for (const key of ["property", "status", "category"] as const) {
    for (const value of filters[key]) params.append(key, value);
  }
  if (filters.needs_review) params.set("needs_review", "true");
  if (filters.urgent) params.set("urgent", "true");
  if (filters.include_done && !filters.status.length) {
    params.set("include_done", "true");
  }
  if (filters.q.trim()) params.set("q", filters.q.trim());
  return params;
}
