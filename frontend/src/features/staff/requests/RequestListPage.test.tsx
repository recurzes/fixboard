import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { routes } from "../../../app/routes";
import { signOut } from "../../../shared/lib/auth";
import type { RequestRow } from "./useRequests";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const AUTH = "https://auth.test.invalid";
const API = "https://api.test.invalid";
const LIST = `${API}/api/staff/requests`;
const SUMMARY = `${LIST}/summary`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const PAGE_SIZE = 25;

const CATEGORIES = [
  { id: "plumbing", label: "Plumbing", questions: [] },
  { id: "pest", label: "Pest", questions: [] },
];
const PROPERTIES = [
  { id: 1, name: "Palm Court" },
  { id: 2, name: "Harbor View" },
];

const row = (id: number, change: Partial<RequestRow> = {}): RequestRow => ({
  id,
  reference_number: `MR-${1000 + id}`,
  property_id: 1,
  property_name: "Palm Court",
  unit_id: id,
  unit_label: `U${id}`,
  tenant_name: `Tenant ${id}`,
  category: "plumbing",
  status: "scheduled",
  urgent: false,
  needs_review: false,
  assignee_id: null,
  assignee_name: null,
  scheduled_at: null,
  created_at: "2026-11-01T12:00:00Z",
  ...change,
});

/** Applies the rules the backend's list endpoint is tested for, so these tests can check rows. */
function answer(rows: RequestRow[], params: URLSearchParams) {
  const statuses = params.getAll("status");
  const properties = params.getAll("property");
  const categories = params.getAll("category");
  const q = params.get("q")?.toLowerCase();
  const matched = rows.filter(
    (request) =>
      (statuses.length
        ? statuses.includes(request.status)
        : params.get("include_done") === "true" || request.status !== "done") &&
      (!properties.length ||
        properties.includes(String(request.property_id))) &&
      (!categories.length || categories.includes(request.category)) &&
      (!params.get("urgent") || request.urgent) &&
      (!params.get("needs_review") || request.needs_review) &&
      (!q ||
        request.reference_number.toLowerCase() === q ||
        request.tenant_name.toLowerCase().includes(q)),
  );
  const start = Number(params.get("cursor") ?? 0);
  const end = start + PAGE_SIZE;
  return {
    items: matched.slice(start, end),
    next_cursor: end < matched.length ? String(end) : null,
  };
}

/** Counted from the same rows as the list, with the backend's rule that open counts leave out Done. */
function summaryOf(rows: RequestRow[]) {
  const open = rows.filter(({ status }) => status !== "done");
  const withStatus = (wanted: RequestRow["status"]) =>
    rows.filter(({ status }) => status === wanted).length;
  return {
    by_status: {
      new: withStatus("new"),
      scheduled: withStatus("scheduled"),
      waiting_on_vendor: withStatus("waiting_on_vendor"),
      done: withStatus("done"),
    },
    open_urgent: open.filter(({ urgent }) => urgent).length,
    open_needs_review: open.filter(({ needs_review }) => needs_review).length,
  };
}

function fakeServers(
  rows: RequestRow[],
  list?: (url: string) => Response | Promise<Response> | undefined,
  summary: () => Response = () => json(summaryOf(rows)),
) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === `${AUTH}/token`) return json({ token: "jwt" });
    if (url === `${API}/api/staff/me`) {
      return json({ name: "Sam Lee", email: "sam@example.com" });
    }
    if (url === `${API}/api/public/config`) {
      return json({ categories: CATEGORIES });
    }
    if (url === `${API}/api/public/properties`) return json(PROPERTIES);
    if (url === SUMMARY) return summary();
    if (url.startsWith(LIST)) {
      return (
        (await list?.(url)) ?? json(answer(rows, new URL(url).searchParams))
      );
    }
    if (url.startsWith(AUTH)) return json({ status: true });
    throw new Error(`Unexpected call to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    listCalls: () =>
      fetchMock.mock.calls
        .map(([url]) => url)
        .filter((url) => url.startsWith(LIST) && url !== SUMMARY),
    summaryCalls: () =>
      fetchMock.mock.calls.filter(([url]) => url === SUMMARY).length,
  };
}

const cleanups: (() => void)[] = [];

afterEach(async () => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({})),
  );
  await signOut();
});

async function open(url: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  );
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, router };
}

const references = (container: HTMLElement) =>
  [...container.querySelectorAll("table tbody a")].map(
    (link) => link.textContent,
  );

const seesRows = (container: HTMLElement, count: number) =>
  vi.waitFor(() => expect(references(container)).toHaveLength(count));

const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("button")].find(
    ({ textContent }) => textContent === name,
  );

const checkbox = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("label")]
    .find(({ textContent }) => textContent === name)
    ?.querySelector("input") as HTMLInputElement;

const click = (element: HTMLElement | undefined) =>
  act(async () => element!.click());

function type(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>('input[name="q"]')!;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(input, value);
  return act(async () => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("loads the first page with Done left out, and shows labels and the row's columns", async () => {
  const { listCalls } = fakeServers([
    row(1, {
      status: "new",
      urgent: true,
      needs_review: true,
      assignee_name: "AC contractor",
    }),
    row(2, { status: "done" }),
  ]);
  const { container } = await open("/staff");
  await seesRows(container, 1);

  expect(listCalls()).toEqual([`${LIST}?`]);
  await vi.waitFor(() =>
    expect(container.querySelector("tbody")!.textContent).toContain("Plumbing"),
  );
  const cells = [...container.querySelectorAll("tbody td")].map(
    (cell) => cell.textContent,
  );
  expect(cells.slice(0, 5)).toEqual([
    "MR-1001",
    "Palm Court · U1",
    "Plumbing",
    "NewUrgentNeeds review",
    "AC contractor",
  ]);
});

it("a New row gets the bar and bold text, and other rows don't", async () => {
  fakeServers([row(1, { status: "new" }), row(2)]);
  const { container } = await open("/staff");
  await seesRows(container, 2);

  const [fresh, seen] = container.querySelectorAll("tbody tr");
  expect(fresh.className).toContain("font-bold");
  expect(fresh.querySelector("td")!.className).toContain("border-l-blue-900");
  expect(seen.className).not.toContain("font-bold");
  expect(seen.querySelector("td")!.className).toContain("border-l-transparent");
});

it("each row and card is a real link to the request, with no reference number in it", async () => {
  fakeServers([row(7)]);
  const { container, router } = await open("/staff");
  await seesRows(container, 1);

  const links =
    container.querySelectorAll<HTMLAnchorElement>("tbody a, main ul a");
  expect([...links].map((link) => link.getAttribute("href"))).toEqual([
    "/staff/requests/7",
    "/staff/requests/7",
  ]);
  links[0].focus();
  expect(document.activeElement).toBe(links[0]);
  await click(links[0]);
  expect(router.state.location.pathname).toBe("/staff/requests/7");
});

it("a card shows the same data as its table row", async () => {
  fakeServers([row(1, { status: "new", assignee_name: "Electrician" })]);
  const { container } = await open("/staff");
  await seesRows(container, 1);
  await vi.waitFor(() =>
    expect(container.querySelector("main ul")!.textContent).toContain(
      "Plumbing",
    ),
  );

  const card = container.querySelector("main ul")!.textContent;
  for (const cell of container.querySelectorAll("tbody td")) {
    expect(card).toContain(cell.textContent);
  }
});

it("a filter goes in the URL, survives a reload, and Back removes it", async () => {
  fakeServers([row(1, { urgent: true }), row(2)]);
  const { container, router } = await open("/staff");
  await seesRows(container, 2);

  await click(checkbox(container, "Urgent"));
  expect(router.state.location.search).toBe("?urgent=true");
  await seesRows(container, 1);

  const reloaded = await open(`/staff${router.state.location.search}`);
  await seesRows(reloaded.container, 1);
  expect(checkbox(reloaded.container, "Urgent").checked).toBe(true);

  await act(async () => router.navigate(-1));
  await seesRows(container, 2);
  expect(checkbox(container, "Urgent").checked).toBe(false);
});

it("Done shows only when toggled or selected", async () => {
  fakeServers([row(1), row(2, { status: "done" })]);
  const { container, router } = await open("/staff");
  await seesRows(container, 1);

  await click(checkbox(container, "Show Done"));
  expect(router.state.location.search).toBe("?include_done=true");
  await seesRows(container, 2);

  await click(checkbox(container, "Show Done"));
  await seesRows(container, 1);

  await click(checkbox(container, "Done"));
  expect(router.state.location.search).toBe("?status=done");
  await vi.waitFor(() => expect(references(container)).toEqual(["MR-1002"]));
});

it("a selected status turns Show Done off and disables it, because it would do nothing", async () => {
  fakeServers([row(1), row(2, { status: "done" })]);
  const { container, router } = await open("/staff?include_done=true");
  await seesRows(container, 2);

  await click(checkbox(container, "Scheduled"));

  expect(router.state.location.search).toBe("?status=scheduled");
  const toggle = checkbox(container, "Show Done");
  expect(toggle.disabled).toBe(true);
  expect(toggle.checked).toBe(false);
  expect(container.textContent).toContain(
    "Not used while a status is selected.",
  );
});

it("property and category combine, and the summary counts what's selected", async () => {
  const { listCalls } = fakeServers([
    row(1),
    row(2, { property_id: 2 }),
    row(3, { category: "pest" }),
    row(4, { property_id: 2, category: "pest" }),
  ]);
  const { container, router } = await open("/staff");
  await seesRows(container, 4);

  await vi.waitFor(() =>
    expect(checkbox(container, "Harbor View")).toBeTruthy(),
  );
  await click(checkbox(container, "Harbor View"));
  await click(checkbox(container, "Pest"));

  expect(router.state.location.search).toBe("?property=2&category=pest");
  await vi.waitFor(() => expect(references(container)).toEqual(["MR-1004"]));
  expect(listCalls().at(-1)).toBe(`${LIST}?property=2&category=pest`);
  const summaries = [...container.querySelectorAll("summary")];
  expect(summaries.map(({ textContent }) => textContent)).toEqual([
    "Status",
    "Property (1)",
    "Category (1)",
  ]);
});

it("Clear filters empties the URL and the search box", async () => {
  fakeServers([row(1, { urgent: true, tenant_name: "Ana" }), row(2)]);
  const { container, router } = await open("/staff?urgent=true&q=Ana");
  await seesRows(container, 1);
  const input = container.querySelector<HTMLInputElement>('input[name="q"]')!;
  expect(input.value).toBe("Ana");

  await click(button(container, "Clear filters"));

  expect(router.state.location.search).toBe("");
  expect(input.value).toBe("");
  expect(checkbox(container, "Urgent").checked).toBe(false);
  await seesRows(container, 2);
  expect(button(container, "Clear filters")!.disabled).toBe(true);
});

it("typing searches once after the pause, and a reference shows one row", async () => {
  const { listCalls } = fakeServers([row(1), row(2), row(3)]);
  const { container, router } = await open("/staff");
  await seesRows(container, 3);
  const before = router.state.historyAction;

  await type(container, "MR");
  await type(container, "MR-10");
  await type(container, "mr-1002");
  expect(listCalls()).toHaveLength(1);

  await vi.waitFor(() => expect(references(container)).toEqual(["MR-1002"]));
  expect(listCalls()).toEqual([`${LIST}?`, `${LIST}?q=mr-1002`]);
  expect(router.state.location.search).toBe("?q=mr-1002");
  // Replaced, so Back leaves the list instead of undoing the search.
  expect(router.state.historyAction).toBe("REPLACE");
  expect(before).toBe("POP");
});

it("Back after a search puts the older text back in the box", async () => {
  fakeServers([row(1), row(2)]);
  const { container, router } = await open("/staff");
  await seesRows(container, 2);

  await click(checkbox(container, "Urgent"));
  await type(container, "mr-1001");
  await vi.waitFor(() =>
    expect(router.state.location.search).toBe("?urgent=true&q=mr-1001"),
  );

  // Back returns no promise, so act can end before the re-render.
  await act(async () => router.navigate(-1));

  const input = container.querySelector<HTMLInputElement>('input[name="q"]')!;
  expect(router.state.location.search).toBe("");
  await vi.waitFor(() => expect(input.value).toBe(""));
});

it("Load more walks 60 rows over three pages with no repeats, then goes away", async () => {
  const { listCalls } = fakeServers(
    Array.from({ length: 60 }, (_, index) => row(index + 1)),
  );
  const { container } = await open("/staff");
  await seesRows(container, 25);

  await click(button(container, "Load more"));
  await seesRows(container, 50);
  await click(button(container, "Load more"));
  await seesRows(container, 60);

  expect(new Set(references(container)).size).toBe(60);
  expect(button(container, "Load more")).toBeUndefined();
  expect(listCalls()).toEqual([
    `${LIST}?`,
    `${LIST}?cursor=25`,
    `${LIST}?cursor=50`,
  ]);
});

it("a failed Load more keeps the rows and can be tried again", async () => {
  let down = true;
  fakeServers(
    Array.from({ length: 30 }, (_, index) => row(index + 1)),
    (url) =>
      down && url.includes("cursor")
        ? json({ error: { code: "service_unavailable" } }, 503)
        : undefined,
  );
  const { container } = await open("/staff");
  await seesRows(container, 25);

  await click(button(container, "Load more"));
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "We can't load more requests right now.",
    ),
  );
  expect(references(container)).toHaveLength(25);

  down = false;
  await click(button(container, "Load more"));
  await seesRows(container, 30);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("shows a skeleton while the first page loads", async () => {
  let release: (response: Response) => void = () => {};
  fakeServers(
    [],
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const { container } = await open("/staff");

  await vi.waitFor(() =>
    expect(container.textContent).toContain("Loading requests"),
  );

  await act(async () => release(json({ items: [], next_cursor: null })));
  await vi.waitFor(() =>
    expect(container.textContent).not.toContain("Loading requests"),
  );
});

it('an empty list says "No open requests"', async () => {
  fakeServers([]);
  const { container } = await open("/staff");

  await vi.waitFor(() =>
    expect(container.textContent).toContain("No open requests"),
  );
  expect(container.textContent).not.toContain("No matches");
});

it("an empty filtered list offers Clear filters, and that clears them", async () => {
  fakeServers([row(1)]);
  const { container, router } = await open("/staff?urgent=true");
  await vi.waitFor(() =>
    expect(container.textContent).toContain("No matches."),
  );
  expect(container.textContent).not.toContain("Search Done too");

  const clear = [...container.querySelectorAll("button")].filter(
    ({ textContent }) => textContent === "Clear filters",
  );
  await click(clear.at(-1));

  expect(router.state.location.search).toBe("");
  await seesRows(container, 1);
});

it("a search that misses offers Done, which finds a Done request", async () => {
  fakeServers([row(1, { status: "done" })]);
  const { container, router } = await open("/staff?q=mr-1001");
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "This search doesn't include Done requests.",
    ),
  );

  await click(button(container, "Search Done too"));

  expect(router.state.location.search).toBe("?include_done=true&q=mr-1001");
  await seesRows(container, 1);
});

it("a failed load shows Retry, and Retry loads the list", async () => {
  let down = true;
  fakeServers([row(1)], () =>
    down ? json({ error: { code: "service_unavailable" } }, 503) : undefined,
  );
  const { container } = await open("/staff");
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "We can't load requests right now.",
    ),
  );

  down = false;
  await click(button(container, "Retry"));

  await seesRows(container, 1);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("an edited URL can't make the API refuse the list", async () => {
  const { listCalls } = fakeServers([row(1)]);
  const { container } = await open("/staff?status=closed&property=abc");
  await seesRows(container, 1);

  expect(listCalls()).toEqual([`${LIST}?`]);
});

it("a failed filter list says so, and the request list still works", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === `${AUTH}/token`) return json({ token: "jwt" });
      if (url === `${API}/api/staff/me`) {
        return json({ name: "Sam Lee", email: "sam@example.com" });
      }
      if (url === SUMMARY) return json(summaryOf([row(1)]));
      if (url.startsWith(LIST))
        return json(answer([row(1)], new URLSearchParams()));
      return json({ error: { code: "service_unavailable" } }, 503);
    }),
  );
  const { container } = await open("/staff");
  await seesRows(container, 1);

  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "We can't load this list right now.",
    ),
  );
  // Falls back to the id, because the config holds the label.
  expect(container.querySelector("tbody")!.textContent).toContain("plumbing");
});

// Only the interval is faked, so fetches and the router still run for real.
const fakePolling = () =>
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
const poll = () =>
  act(async () => {
    vi.advanceTimersByTime(30_000);
  });

const seesCount = (count: number) =>
  vi.waitFor(() =>
    expect(document.title).toBe(
      `${count ? `(${count}) ` : ""}Requests – Fixboard`,
    ),
  );

const chip = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("button")].find(({ textContent }) =>
    textContent.startsWith(`${label} `),
  )!;

it("polls the summary once per 30 seconds, and not while the tab is hidden", async () => {
  fakePolling();
  const { summaryCalls } = fakeServers([row(1)]);
  const { container } = await open("/staff");
  await seesRows(container, 1);
  expect(summaryCalls()).toBe(1);

  await poll();
  expect(summaryCalls()).toBe(2);
  await poll();
  expect(summaryCalls()).toBe(3);

  const hidden = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  await poll();
  hidden.mockRestore();
  expect(summaryCalls()).toBe(3);
});

it("the nav badge and tab title follow the New count, and the title resets on leaving", async () => {
  fakePolling();
  const rows = [row(1, { status: "new" }), row(2, { status: "new" }), row(3)];
  fakeServers(rows);
  const { container, router } = await open("/staff");
  await seesCount(2);
  const nav = container.querySelector('nav[aria-label="Staff"] a')!;
  expect(nav.textContent).toBe("Requests2 new");

  rows.push(row(4, { status: "new" }));
  await poll();
  await seesCount(3);
  expect(nav.textContent).toBe("Requests3 new");

  rows.splice(0, 3);
  rows[0].status = "scheduled";
  await poll();
  await seesCount(0);
  expect(nav.textContent).toBe("Requests");

  rows[0].status = "new";
  await poll();
  await seesCount(1);
  await act(async () => router.navigate("/"));
  await vi.waitFor(() =>
    expect(document.title).toBe("Report a problem – Fixboard"),
  );
});

it("a new request shows the banner, and Show it brings the row in without a reload", async () => {
  fakePolling();
  const rows = [row(1)];
  const { listCalls } = fakeServers(rows);
  const { container } = await open("/staff");
  await seesRows(container, 1);
  await seesCount(0);
  expect(container.textContent).not.toContain("new request");

  rows.push(row(2, { status: "new" }));
  await poll();
  await seesCount(1);
  expect(container.textContent).toContain("1 new request.");
  expect(references(container)).toHaveLength(1);

  await click(button(container, "Show it"));

  await seesRows(container, 2);
  expect(container.textContent).not.toContain("new request");
  expect(listCalls()).toEqual([`${LIST}?`, `${LIST}?`]);
});

it("arrivals add up, and a falling count adds nothing and hides nothing", async () => {
  fakePolling();
  const rows = [row(1, { status: "new" })];
  fakeServers(rows);
  const { container } = await open("/staff");
  await seesCount(1);

  rows[0].status = "scheduled";
  await poll();
  await seesCount(0);
  expect(container.textContent).not.toContain("new request");

  rows.push(row(2, { status: "new" }));
  await poll();
  await seesCount(1);
  rows.push(row(3, { status: "new" }));
  await poll();
  await seesCount(2);
  expect(container.textContent).toContain("2 new requests.");

  rows[1].status = "scheduled";
  await poll();
  await seesCount(1);
  expect(container.textContent).toContain("2 new requests.");
  expect(button(container, "Show them")).toBeTruthy();
});

it("Show it clears a filter that would hide the new request", async () => {
  fakePolling();
  const rows = [row(1, { urgent: true })];
  fakeServers(rows);
  const { container, router } = await open("/staff?urgent=true");
  await seesRows(container, 1);
  await seesCount(0);

  rows.push(row(2, { status: "new" }));
  await poll();
  await seesCount(1);
  await click(button(container, "Show it"));

  expect(router.state.location.search).toBe("");
  await seesRows(container, 2);
});

it("each status chip's count matches the list it sets, and clicking again removes it", async () => {
  const rows = [
    row(1, { status: "new" }),
    row(2, { status: "new" }),
    row(3, { status: "scheduled" }),
    row(4, { status: "waiting_on_vendor" }),
    row(5, { status: "done" }),
    row(6, { status: "done" }),
    row(7, { status: "done" }),
  ];
  fakeServers(rows);
  const { container, router } = await open("/staff");
  await seesRows(container, 4);
  await seesCount(2);

  for (const [label, status, count] of [
    ["New", "new", 2],
    ["Scheduled", "scheduled", 1],
    ["Waiting on vendor", "waiting_on_vendor", 1],
    ["Done", "done", 3],
  ] as const) {
    expect(chip(container, label).textContent).toBe(`${label} ${count}`);
    await click(chip(container, label));
    expect(router.state.location.search).toBe(`?status=${status}`);
    await seesRows(container, count);
    expect(chip(container, label).getAttribute("aria-pressed")).toBe("true");
  }

  await click(chip(container, "Done"));
  expect(router.state.location.search).toBe("");
  await seesRows(container, 4);
});

it("the open urgent and needs-review counts leave out Done", async () => {
  fakeServers([
    row(1, { urgent: true, needs_review: true }),
    row(2, { urgent: true }),
    row(3, { status: "done", urgent: true, needs_review: true }),
  ]);
  const { container } = await open("/staff");

  await vi.waitFor(() =>
    expect(container.textContent).toContain("Open urgent 2"),
  );
  expect(container.textContent).toContain("Needs review 1");
});

it("a failed summary leaves the list working, with no counts", async () => {
  const { summaryCalls } = fakeServers([row(1)], undefined, () =>
    json({ error: { code: "service_unavailable" } }, 503),
  );
  const { container } = await open("/staff");
  await seesRows(container, 1);
  await vi.waitFor(() => expect(summaryCalls()).toBe(1));

  expect(container.querySelector('[aria-label="Request counts"]')).toBeNull();
  expect(document.title).toBe("Requests – Fixboard");
});
