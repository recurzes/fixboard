import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { routes } from "../../../app/routes";
import { signOut } from "../../../shared/lib/auth";
import type { Assignee } from "./useAssignees";
import type { Note, RequestDetail } from "./useRequest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const AUTH = "https://auth.test.invalid";
const API = "https://api.test.invalid";
const LIST = `${API}/api/staff/requests`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const ASSIGNEES: Assignee[] = [
  { id: 1, name: "In-house maintenance", kind: "in_house", active: true },
  { id: 2, name: "Pest control", kind: "outside_vendor", active: true },
  { id: 3, name: "AC contractor", kind: "outside_vendor", active: true },
  { id: 4, name: "Plumber", kind: "outside_vendor", active: true },
  { id: 5, name: "Electrician", kind: "outside_vendor", active: true },
];
// Microseconds, as the server sends it. A Date would drop them.
const SEEN = "2026-11-01T12:00:00.123456Z";

const detail = (change: Partial<RequestDetail> = {}): RequestDetail => ({
  id: 7,
  reference_number: "MR-1007",
  property_id: 1,
  property_name: "Palm Court",
  unit_id: 3,
  unit_label: "U3",
  tenant_name: "Ana Diaz",
  category: "hvac",
  status: "new",
  urgent: false,
  needs_review: false,
  assignee_id: null,
  assignee_name: null,
  scheduled_at: null,
  created_at: "2026-11-01T12:00:00Z",
  phone: null,
  email: "ana@example.com",
  description: "AC blows warm air.",
  followup_answers: {},
  entry_permission: "anytime",
  entry_notes: null,
  source: "tenant_form",
  contact_matched: true,
  self_check_shown: null,
  self_check_tried: false,
  emergency_ack_at: null,
  updated_at: SEEN,
  photo_ids: [],
  notes: [],
  history: [],
  ...change,
});

/** A small stand-in for the backend: checks updated_at, moves Waiting on vendor off a non-vendor, and keeps history newest first. */
function fakeServer(start: RequestDetail) {
  const server = {
    request: start,
    patches: [] as Record<string, unknown>[],
    notes: [] as unknown[],
    saves: 0,
  };
  const event = (
    kind: string,
    field: string | null = null,
    old: unknown = null,
    next: unknown = null,
  ) => {
    const count = server.request.history.length;
    server.request.history = [
      {
        id: count + 1,
        event: kind,
        field,
        old_value: old === null ? null : String(old),
        new_value: next === null ? null : String(next),
        actor_name: "Sam Lee",
        created_at: `2026-11-02T15:0${count}:00Z`,
      },
      ...server.request.history,
    ];
  };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    if (url === `${AUTH}/token`) return json({ token: "jwt" });
    if (url === `${API}/api/staff/me`) {
      return json({ name: "Sam Lee", email: "sam@example.com" });
    }
    if (url === `${API}/api/public/config`) return json({ categories: [] });
    if (url === `${API}/api/public/properties`) return json([]);
    if (url === `${API}/api/staff/assignees`) return json(ASSIGNEES);
    if (url === `${LIST}/summary`) {
      return json({
        by_status: { new: 0, scheduled: 0, waiting_on_vendor: 0, done: 0 },
        open_urgent: 0,
        open_needs_review: 0,
      });
    }
    if (url === `${LIST}/7/notes` && method === "POST") {
      server.notes.push(body);
      const note: Note = {
        id: 100 + server.notes.length,
        body: body.body,
        author_name: "Sam Lee",
        created_at: "2026-11-02T15:00:00Z",
      };
      server.request = {
        ...server.request,
        notes: [...server.request.notes, note],
      };
      event("note_added");
      return json(note, 201);
    }
    if (url === `${LIST}/7` && method === "PATCH") {
      server.patches.push(body);
      if (body.updated_at !== server.request.updated_at) {
        return json(
          { error: { code: "conflict", message: "Please reload it" } },
          409,
        );
      }
      const changes = { ...body };
      delete changes.updated_at;
      const next = { ...server.request, ...changes };
      if ("assignee_id" in changes) {
        next.assignee_name =
          ASSIGNEES.find(({ id }) => id === changes.assignee_id)?.name ?? null;
      }
      const vendor =
        ASSIGNEES.find(({ id }) => id === next.assignee_id)?.kind ===
        "outside_vendor";
      if (!changes.status && next.status === "waiting_on_vendor" && !vendor) {
        next.status = "scheduled";
      }
      server.saves += 1;
      next.updated_at = `2026-11-02T10:00:0${server.saves}.654321Z`;
      const before = server.request;
      server.request = next;
      for (const key of ["status", "scheduled_at", "needs_review"] as const) {
        if (before[key] !== next[key]) {
          event("changed", key, before[key], next[key]);
        }
      }
      if (before.assignee_id !== next.assignee_id) {
        event("changed", "assignee", before.assignee_name, next.assignee_name);
      }
      return json(next);
    }
    if (url === `${LIST}/7`) return json(server.request);
    if (url.startsWith(LIST)) {
      return json({ items: [server.request], next_cursor: null });
    }
    if (url.startsWith(AUTH)) return json({ status: true });
    throw new Error(`Unexpected call to ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return server;
}

const cleanups: (() => void)[] = [];

afterEach(async () => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
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
  await sees(container, "Status and assignment");
  return { container, router };
}

const sees = (container: HTMLElement, text: string) =>
  vi.waitFor(() => expect(container.textContent).toContain(text));

const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("button")].find(
    ({ textContent }) => textContent === name,
  )!;

/** The list items in the section with this heading. */
const items = (container: HTMLElement, title: string) =>
  [
    ...[...container.querySelectorAll("section")]
      .find((section) => section.querySelector("h2")?.textContent === title)!
      .querySelectorAll("li"),
  ].map((item) => item.textContent!.replace(/\s/g, " "));

const click = (element: Element) =>
  act(async () => (element as HTMLElement).click());

/** The control a label points at. */
function field<T extends HTMLElement>(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll("label")].find(
    ({ textContent }) => textContent === label,
  )!;
  return container.ownerDocument.getElementById(found.htmlFor) as T;
}
const select = (container: HTMLElement, label: string) =>
  field<HTMLSelectElement>(container, label);

/** Goes through the native setter, or React doesn't see the change. */
async function change(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  const proto = Object.getPrototypeOf(element);
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}

const statusOption = (container: HTMLElement, value: string) =>
  select(container, "Status").querySelector<HTMLOptionElement>(
    `option[value="${value}"]`,
  )!;

it("the picker groups the five seeded entries, with Unassigned first", async () => {
  fakeServer(detail());
  const { container } = await open("/staff/requests/7");
  const picker = select(container, "Assignee");
  await vi.waitFor(() => expect(picker.options).toHaveLength(6));

  expect(picker.options[0].textContent).toBe("Unassigned");
  const groups = [...picker.querySelectorAll("optgroup")].map((group) => [
    group.label,
    [...group.querySelectorAll("option")].map(({ textContent }) => textContent),
  ]);
  expect(groups).toEqual([
    ["In-house", ["In-house maintenance"]],
    [
      "Outside vendors",
      ["Pest control", "AC contractor", "Plumber", "Electrician"],
    ],
  ]);
});

it("a vendor deactivated since it was picked still shows as the assignee", async () => {
  fakeServer(detail({ assignee_id: 9, assignee_name: "Old roofer" }));
  const { container } = await open("/staff/requests/7");
  const picker = select(container, "Assignee");
  await vi.waitFor(() => expect(picker.options).toHaveLength(7));
  expect(picker.value).toBe("9");
  expect(picker.selectedOptions[0].textContent).toBe("Old roofer");
});

it("choosing In-house disables Waiting on vendor with a reason, and a vendor enables it", async () => {
  fakeServer(detail());
  const { container } = await open("/staff/requests/7");
  await vi.waitFor(() =>
    expect(select(container, "Assignee").options).toHaveLength(6),
  );

  await change(select(container, "Assignee"), "1");
  expect(statusOption(container, "waiting_on_vendor").disabled).toBe(true);
  expect(container.textContent).toContain(
    "Waiting on vendor needs an outside vendor as the assignee.",
  );

  await change(select(container, "Assignee"), "4");
  expect(statusOption(container, "waiting_on_vendor").disabled).toBe(false);
  expect(container.textContent).not.toContain("needs an outside vendor");
});

it("Save stays disabled until something changes, and Discard puts it back", async () => {
  fakeServer(detail());
  const { container } = await open("/staff/requests/7");
  const save = button(container, "Save changes");
  expect(save.disabled).toBe(true);
  expect(button(container, "Discard").disabled).toBe(true);

  await change(select(container, "Status"), "done");
  expect(save.disabled).toBe(false);
  await change(select(container, "Status"), "new");
  expect(save.disabled).toBe(true);

  await change(select(container, "Status"), "done");
  await click(button(container, "Discard"));
  expect(select(container, "Status").value).toBe("new");
  expect(save.disabled).toBe(true);
});

it("2:00 PM saves as UTC with only that field and the seen updated_at, shows 2:00 PM, and says Saved", async () => {
  const server = fakeServer(detail());
  const { container } = await open("/staff/requests/7");
  const when = field<HTMLInputElement>(container, "Scheduled for");

  // November 5 is after the clocks go back, so New York is UTC-5.
  await change(when, "2026-11-05T14:00");
  await click(button(container, "Save changes"));
  await sees(container, "Saved");

  expect(server.patches).toEqual([
    { scheduled_at: "2026-11-05T19:00:00.000Z", updated_at: SEEN },
  ]);
  expect(field<HTMLInputElement>(container, "Scheduled for").value).toBe(
    "2026-11-05T14:00",
  );
  expect(button(container, "Save changes").disabled).toBe(true);

  // The next save carries the updated_at the server returned.
  await click(button(container, "Clear"));
  await click(button(container, "Save changes"));
  await vi.waitFor(() => expect(server.patches).toHaveLength(2));
  expect(server.patches[1]).toEqual({
    scheduled_at: null,
    updated_at: "2026-11-02T10:00:01.654321Z",
  });
});

it("a saved change shows in the list without a reload", async () => {
  fakeServer(detail());
  const { container, router } = await open("/staff/requests/7");
  await change(select(container, "Status"), "done");
  await click(button(container, "Save changes"));
  await sees(container, "Saved");

  await act(async () => router.navigate("/staff"));
  await vi.waitFor(() =>
    expect(container.querySelector("table tbody")?.textContent).toContain(
      "Done",
    ),
  );
});

it("moving a Waiting on vendor request in-house hints Scheduled, sends no status, and shows what the server saved", async () => {
  const server = fakeServer(
    detail({
      status: "waiting_on_vendor",
      assignee_id: 4,
      assignee_name: "Plumber",
    }),
  );
  const { container } = await open("/staff/requests/7");
  await vi.waitFor(() =>
    expect(select(container, "Assignee").options).toHaveLength(6),
  );
  expect(container.textContent).not.toContain("Status will move");

  await change(select(container, "Assignee"), "1");
  expect(container.textContent).toContain("Status will move to Scheduled");
  await click(button(container, "Save changes"));
  await sees(container, "Saved");

  expect(server.patches).toEqual([{ assignee_id: 1, updated_at: SEEN }]);
  expect(select(container, "Status").value).toBe("scheduled");
  expect(container.querySelector("h1")!.parentElement!.textContent).toContain(
    "Scheduled",
  );
  expect(container.textContent).not.toContain("Status will move");
});

it("choosing Waiting on vendor and then In-house goes back to the saved status", async () => {
  const server = fakeServer(detail());
  const { container } = await open("/staff/requests/7");
  await vi.waitFor(() =>
    expect(select(container, "Assignee").options).toHaveLength(6),
  );
  await change(select(container, "Assignee"), "4");
  await change(select(container, "Status"), "waiting_on_vendor");
  await change(select(container, "Assignee"), "1");

  expect(select(container, "Status").value).toBe("new");
  await click(button(container, "Save changes"));
  await sees(container, "Saved");
  expect(server.patches).toEqual([{ assignee_id: 1, updated_at: SEEN }]);
});

it("a 409 loads the latest version, resets the form, and says what you tried", async () => {
  const server = fakeServer(detail());
  const { container } = await open("/staff/requests/7");
  await vi.waitFor(() =>
    expect(select(container, "Assignee").options).toHaveLength(6),
  );
  // Another tab saves first.
  server.request = detail({
    status: "done",
    updated_at: "2026-11-02T09:00:00.000001Z",
  });

  await change(select(container, "Assignee"), "4");
  await click(button(container, "Save changes"));
  await sees(container, "Someone else changed this request");
  expect(container.textContent).toContain(
    "You tried to: assign it to Plumber.",
  );
  await vi.waitFor(() =>
    expect(select(container, "Status").value).toBe("done"),
  );
  expect(select(container, "Assignee").value).toBe("");
  expect(button(container, "Save changes").disabled).toBe(true);

  // The next save is against the version just loaded.
  await change(select(container, "Assignee"), "4");
  await click(button(container, "Save changes"));
  await sees(container, "Saved");
  expect(server.patches.at(-1)).toEqual({
    assignee_id: 4,
    updated_at: "2026-11-02T09:00:00.000001Z",
  });
  expect(container.textContent).not.toContain("Someone else changed");
});

it("Mark as reviewed clears the banner and the list badge, and keeps unsaved edits", async () => {
  const server = fakeServer(detail({ needs_review: true }));
  const { container, router } = await open("/staff/requests/7");
  await change(select(container, "Status"), "done");

  await click(button(container, "Mark as reviewed"));
  await sees(container, "Saved");
  expect(server.patches).toEqual([{ needs_review: false, updated_at: SEEN }]);
  expect(container.textContent).not.toContain("Needs review");
  expect(select(container, "Status").value).toBe("done");

  await click(button(container, "Save changes"));
  await vi.waitFor(() => expect(server.patches).toHaveLength(2));
  expect(server.patches[1]).toEqual({
    status: "done",
    updated_at: "2026-11-02T10:00:01.654321Z",
  });

  await act(async () => router.navigate("/staff"));
  await vi.waitFor(() =>
    expect(container.querySelector("table tbody")?.textContent).toContain(
      "Done",
    ),
  );
  expect(container.querySelector("table tbody")!.textContent).not.toContain(
    "Needs review",
  );
});

it("a new note appears with its author and time after saving", async () => {
  const server = fakeServer(
    detail({
      notes: [
        {
          id: 1,
          body: "Called the tenant.",
          author_name: "Kim Park",
          created_at: "2026-11-01T14:00:00Z",
        },
      ],
    }),
  );
  const { container } = await open("/staff/requests/7");
  await sees(container, "Called the tenant.");
  const box = field<HTMLTextAreaElement>(container, "Add a note");
  expect(button(container, "Add note").disabled).toBe(true);

  await change(box, "Plumber booked for Thursday.");
  await click(button(container, "Add note"));
  await sees(container, "Plumber booked for Thursday.");

  expect(server.notes).toEqual([{ body: "Plumber booked for Thursday." }]);
  expect(items(container, "Notes")).toEqual([
    "Kim Park · 11/01/2026, 9:00 AMCalled the tenant.",
    "Sam Lee · 11/02/2026, 10:00 AMPlumber booked for Thursday.",
  ]);
  expect(box.value).toBe("");
  expect(container.textContent).toContain("Note added");
});

it("three changes read back as who did what and when, newest first, without a reload", async () => {
  fakeServer(detail());
  const { container, router } = await open("/staff/requests/7");
  await sees(container, "No history yet.");
  await vi.waitFor(() =>
    expect(select(container, "Assignee").options).toHaveLength(6),
  );

  await change(select(container, "Assignee"), "4");
  await click(button(container, "Save changes"));
  await sees(container, "Sam Lee assigned it to Plumber");

  await change(select(container, "Status"), "scheduled");
  await click(button(container, "Save changes"));
  await sees(container, "Sam Lee changed status from New to Scheduled");

  await change(field<HTMLTextAreaElement>(container, "Add a note"), "Booked.");
  await click(button(container, "Add note"));
  await sees(container, "Sam Lee added a note");

  expect(items(container, "History")).toEqual([
    "Sam Lee added a note11/02/2026, 10:02 AM",
    "Sam Lee changed status from New to Scheduled11/02/2026, 10:01 AM",
    "Sam Lee assigned it to Plumber11/02/2026, 10:00 AM",
  ]);
  expect(router.state.location.pathname).toBe("/staff/requests/7");
});

it("leaving with unsaved edits asks first, and staying keeps them", async () => {
  fakeServer(detail());
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  const { container, router } = await open("/staff/requests/7");

  await act(async () => router.navigate("/staff"));
  expect(confirm).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe("/staff");

  await act(async () => router.navigate("/staff/requests/7"));
  await sees(container, "Status and assignment");
  await change(select(container, "Status"), "done");
  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);

  await act(async () => router.navigate("/staff"));
  expect(confirm).toHaveBeenCalledOnce();
  expect(router.state.location.pathname).toBe("/staff/requests/7");
  expect(select(container, "Status").value).toBe("done");

  confirm.mockReturnValue(true);
  await act(async () => router.navigate("/staff"));
  expect(router.state.location.pathname).toBe("/staff");
});
