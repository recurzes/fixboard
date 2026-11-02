import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { routes } from "../../../app/routes";
import { signOut } from "../../../shared/lib/auth";
import type { Assignee } from "../requests/useAssignees";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const AUTH = "https://auth.test.invalid";
const API = "https://api.test.invalid";
const ASSIGNEES = `${API}/api/staff/assignees`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const error = (status: number) =>
  json({ error: { code: "error", message: "No", fields: [] } }, status);

const SEEDED: Assignee[] = [
  { id: 1, name: "In-house maintenance", kind: "in_house", active: true },
  { id: 2, name: "Pest control", kind: "outside_vendor", active: true },
  { id: 3, name: "AC contractor", kind: "outside_vendor", active: true },
  { id: 4, name: "Plumber", kind: "outside_vendor", active: true },
  { id: 5, name: "Electrician", kind: "outside_vendor", active: true },
];

/** The vendor routes as built: exact-case unique names, a locked in-house entry, and requests that read the name through a join. */
function fakeServer() {
  const server = { assignees: SEEDED.map((entry) => ({ ...entry })) };
  const byName = (name: string) =>
    server.assignees.find((entry) => entry.name === name);
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    if (url === `${AUTH}/token`) return json({ token: "jwt" });
    if (url === `${API}/api/staff/me`) {
      return json({ name: "Sam Lee", email: "sam@example.com" });
    }
    if (url === `${API}/api/public/config`) return json({ categories: [] });
    if (url === `${API}/api/staff/requests/summary`) {
      return json({
        by_status: { new: 0, scheduled: 1, waiting_on_vendor: 0, done: 0 },
        open_urgent: 0,
        open_needs_review: 0,
      });
    }
    if (url === `${ASSIGNEES}?include_inactive=true`) {
      return json(server.assignees);
    }
    if (url === ASSIGNEES && method === "GET") {
      return json(server.assignees.filter(({ active }) => active));
    }
    if (url === ASSIGNEES && method === "POST") {
      if (byName(body.name.trim())) return error(409);
      const added: Assignee = {
        id: server.assignees.length + 1,
        name: body.name.trim(),
        kind: "outside_vendor",
        active: true,
      };
      server.assignees.push(added);
      return json(added, 201);
    }
    const patch = url.match(/\/api\/staff\/assignees\/(\d+)$/);
    if (patch && method === "PATCH") {
      const entry = server.assignees.find(({ id }) => id === +patch[1])!;
      if (entry.kind === "in_house" && body.active === false) return error(422);
      const taken = body.name && byName(body.name.trim());
      if (taken && taken !== entry) return error(409);
      if (body.name) entry.name = body.name.trim();
      if ("active" in body) entry.active = body.active;
      return json(entry);
    }
    // An old request on the Plumber, whose name comes through a join.
    if (url === `${API}/api/staff/requests/7`) {
      return json({
        id: 7,
        reference_number: "MR-1007",
        property_name: "Palm Court",
        unit_label: "U3",
        tenant_name: "Ana Diaz",
        category: "plumbing",
        status: "scheduled",
        urgent: false,
        needs_review: false,
        assignee_id: 4,
        assignee_name: server.assignees[3].name,
        scheduled_at: null,
        created_at: "2026-11-01T12:00:00Z",
        phone: null,
        email: "ana@example.com",
        description: "Leak.",
        followup_answers: {},
        entry_permission: "anytime",
        entry_notes: null,
        source: "tenant_form",
        contact_matched: true,
        self_check_shown: null,
        self_check_tried: false,
        emergency_ack_at: null,
        updated_at: "2026-11-01T12:00:00.123456Z",
        photo_ids: [],
        notes: [],
        history: [],
      });
    }
    if (url.startsWith(AUTH)) return json({ status: true });
    throw new Error(`Unexpected call to ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return server;
}

// jsdom has no showModal(). The browser's focus trap, Esc, and focus return can't be tested here.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

const cleanups: (() => void)[] = [];

afterEach(async () => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({})),
  );
  await signOut();
});

async function open() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const router = createMemoryRouter(routes, {
    initialEntries: ["/staff/vendors"],
  });
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
  await sees(container, "Electrician");
  return { container, router };
}

const sees = (container: HTMLElement, text: string) =>
  vi.waitFor(() => expect(container.textContent).toContain(text));

const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("button")].find(
    ({ textContent }) => textContent === name,
  )!;

const click = (element: Element) =>
  act(async () => (element as HTMLElement).click());

function field<T extends HTMLElement>(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll("label")].find(
    ({ textContent }) => textContent === label,
  )!;
  return container.ownerDocument.getElementById(found.htmlFor) as T;
}

/** Goes through the native setter, or React doesn't see the change. */
async function change(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")]
      .slice(0, 3)
      .map(({ textContent }) => textContent),
  );

/** The detail page's picker: the selected option, and the outside vendors on offer. */
async function picker(
  container: HTMLElement,
  router: { navigate: (to: string) => Promise<void> },
) {
  await act(() => router.navigate("/staff/requests/7"));
  await sees(container, "Status and assignment");
  const select = field<HTMLSelectElement>(container, "Assignee");
  await vi.waitFor(() =>
    expect(select.querySelectorAll("optgroup option").length).toBeGreaterThan(
      1,
    ),
  );
  return {
    selected: select.selectedOptions[0].textContent,
    vendors: [
      ...select.querySelectorAll('optgroup[label="Outside vendors"] option'),
    ].map(({ textContent }) => textContent),
  };
}

it("lists the five seeded entries with kind and state, and In-house maintenance locked with the reason", async () => {
  fakeServer();
  const { container } = await open();

  await vi.waitFor(() =>
    expect(rows(container)).toEqual([
      ["In-house maintenance", "In-house", "Active"],
      ["Pest control", "Outside vendor", "Active"],
      ["AC contractor", "Outside vendor", "Active"],
      ["Plumber", "Outside vendor", "Active"],
      ["Electrician", "Outside vendor", "Active"],
    ]),
  );
  expect(button(container, "Deactivate In-house maintenance")).toBeUndefined();
  expect(container.textContent).toContain(
    "Locked. In-house maintenance can't be deactivated",
  );
});

it("adds an outside vendor, which then shows in the assignee picker", async () => {
  fakeServer();
  const { container, router } = await open();

  await change(field(container, "Add an outside vendor"), "Roofer");
  await click(button(container, "Add vendor"));

  await sees(container, "Added Roofer");
  await vi.waitFor(() =>
    expect(rows(container)).toContainEqual([
      "Roofer",
      "Outside vendor",
      "Active",
    ]),
  );
  expect(
    field<HTMLInputElement>(container, "Add an outside vendor").value,
  ).toBe("");
  expect((await picker(container, router)).vendors).toContain("Roofer");
});

it("shows a duplicate name inline, and an empty one before sending", async () => {
  fakeServer();
  const { container } = await open();
  const input = field<HTMLInputElement>(container, "Add an outside vendor");

  await click(button(container, "Add vendor"));
  expect(container.textContent).toContain("Enter a name");

  await change(input, "Plumber");
  await click(button(container, "Add vendor"));
  await sees(container, "Another entry, active or not, already has this name.");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(input);

  // Typing clears it. The mutation's reset reaches React on a timer, after act.
  await change(input, "Plumber 2");
  await vi.waitFor(() =>
    expect(container.textContent).not.toContain("already has this name"),
  );
});

it("renames inline, and the new name shows in the picker and on an old request", async () => {
  fakeServer();
  const { container, router } = await open();

  await click(button(container, "Rename Plumber"));
  const input = field<HTMLInputElement>(container, "New name for Plumber");
  await change(input, "Electrician");
  await click(button(container, "Save"));
  await sees(container, "already has this name");

  await change(input, "Pipe Pros");
  await click(button(container, "Save"));
  await sees(container, "Renamed to Pipe Pros");
  await vi.waitFor(() =>
    expect(rows(container)).toContainEqual([
      "Pipe Pros",
      "Outside vendor",
      "Active",
    ]),
  );
  expect(document.activeElement).toBe(button(container, "Rename Pipe Pros"));

  const { selected, vendors } = await picker(container, router);
  expect(selected).toBe("Pipe Pros");
  expect(vendors).toContain("Pipe Pros");
});

it("deactivates after a confirm, so the vendor leaves the picker but an old request keeps its name, then reactivates", async () => {
  fakeServer();
  const { container, router } = await open();

  await click(button(container, "Deactivate Plumber"));
  const dialog = container.querySelector("dialog")!;
  expect(dialog.open).toBe(true);
  expect(dialog.textContent).toContain("Deactivate Plumber?");
  await click(button(container, "Deactivate"));

  await sees(container, "Plumber deactivated");
  expect(dialog.open).toBe(false);
  await vi.waitFor(() =>
    expect(rows(container)).toContainEqual([
      "Plumber",
      "Outside vendor",
      "Inactive",
    ]),
  );

  const { selected, vendors } = await picker(container, router);
  expect(selected).toBe("Plumber");
  expect(vendors).not.toContain("Plumber");

  await act(() => router.navigate("/staff/vendors"));
  await sees(container, "Reactivate Plumber");
  await click(button(container, "Reactivate Plumber"));
  await click(button(container, "Reactivate"));
  await sees(container, "Plumber reactivated");
  await vi.waitFor(() =>
    expect(rows(container)).toContainEqual([
      "Plumber",
      "Outside vendor",
      "Active",
    ]),
  );
});
