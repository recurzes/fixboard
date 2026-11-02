import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { routes } from "../../../app/routes";
import { signOut } from "../../../shared/lib/auth";
import type { RequestDetail } from "./useRequest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const AUTH = "https://auth.test.invalid";
const API = "https://api.test.invalid";
const LIST = `${API}/api/staff/requests`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const CATEGORIES = [
  {
    id: "hvac",
    label: "Heating and cooling",
    questions: [
      {
        id: "above_90",
        label: "Is it above 90 degrees inside?",
        type: "single_choice",
        required: true,
        options: [
          { value: "yes", label: "Yes", urgent: true, self_check: null },
        ],
      },
      {
        id: "air",
        label: "What comes out of the vents?",
        type: "single_choice",
        required: true,
        options: [
          {
            value: "warm_air",
            label: "Warm air",
            urgent: false,
            self_check: {
              id: "thermostat",
              text: "Check the thermostat is set to Cool.",
              pending_client_approval: false,
            },
          },
        ],
      },
    ],
  },
];

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
  phone: "+15551234567",
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
  updated_at: "2026-11-01T12:00:00Z",
  photo_ids: [],
  notes: [],
  history: [],
  ...change,
});

function fakeServers(
  request: RequestDetail | Response,
  photo: (photoId: string, call: number) => Response = (photoId, call) =>
    json({ url: `https://bucket.test.invalid/${photoId}?v=${call}` }),
) {
  const photoCalls: Record<string, number> = {};
  const fetchMock = vi.fn(async (url: string) => {
    if (url === `${AUTH}/token`) return json({ token: "jwt" });
    if (url === `${API}/api/staff/me`) {
      return json({ name: "Sam Lee", email: "sam@example.com" });
    }
    if (url === `${API}/api/public/config`) {
      return json({ categories: CATEGORIES });
    }
    if (url === `${API}/api/public/properties`) return json([]);
    if (url === `${API}/api/staff/assignees`) return json([]);
    if (url === `${LIST}/summary`) {
      return json({
        by_status: { new: 0, scheduled: 0, waiting_on_vendor: 0, done: 0 },
        open_urgent: 0,
        open_needs_review: 0,
      });
    }
    const photoMatch = url.match(/\/photos\/(\d+)$/);
    if (photoMatch) {
      const id = photoMatch[1];
      photoCalls[id] = (photoCalls[id] ?? 0) + 1;
      return photo(id, photoCalls[id]);
    }
    if (url.startsWith(`${LIST}/`)) {
      return request instanceof Response ? request.clone() : json(request);
    }
    if (url.startsWith(LIST)) {
      return json({
        items: request instanceof Response ? [] : [request],
        next_cursor: null,
      });
    }
    if (url.startsWith(AUTH)) return json({ status: true });
    throw new Error(`Unexpected call to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { photoCalls };
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

const sees = (container: HTMLElement, text: string) =>
  vi.waitFor(() => expect(container.textContent).toContain(text));

const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("button")].find(
    ({ textContent }) => textContent === name,
  );

const click = (element: Element | null | undefined) =>
  act(async () => (element as HTMLElement).click());

/** Each fact as "term: value", in page order. */
const facts = (container: HTMLElement) =>
  [...container.querySelectorAll("dt")].map(
    (term) => `${term.textContent}: ${term.nextElementSibling!.textContent}`,
  );

const fire = (element: Element, type: string) =>
  act(async () => element.dispatchEvent(new Event(type)));

it.each([
  ["an unknown id", "999", json({ detail: "Request not found" }, 404)],
  ["a non-numeric id", "abc", json({ detail: "Invalid" }, 422)],
])("%s shows Request not found", async (_, id, response) => {
  fakeServers(response);
  const { container } = await open(`/staff/requests/${id}`);
  await sees(container, "Request not found");
  expect(button(container, "Retry")).toBeUndefined();
});

it("a server error offers Retry, not Request not found", async () => {
  fakeServers(json({ detail: "Down" }, 503));
  const { container } = await open("/staff/requests/7");
  await sees(container, "We can't load this request right now.");
  expect(container.textContent).not.toContain("Request not found");
});

it("the header shows the reference and badges, and the tenant's contact links", async () => {
  fakeServers(detail({ urgent: true, source: "in_person" }));
  const { container } = await open("/staff/requests/7");
  await sees(container, "Ana Diaz");

  expect(container.querySelector("h1")!.textContent).toBe("MR-1007");
  expect(container.textContent).toContain("NewUrgent");
  const phone = container.querySelector('a[href^="tel:"]')!;
  expect(phone.getAttribute("href")).toBe("tel:+15551234567");
  expect(phone.textContent).toBe("(555) 123-4567");
  expect(
    container.querySelector('a[href^="mailto:"]')!.getAttribute("href"),
  ).toBe("mailto:ana@example.com");
  expect(facts(container)).toEqual(
    expect.arrayContaining([
      "Property and unit: Palm Court · U3",
      "Source: In person",
    ]),
  );
});

it("a missing phone or email says so, with no empty link", async () => {
  fakeServers(detail({ phone: null }));
  const { container } = await open("/staff/requests/7");
  await sees(container, "Ana Diaz");
  expect(container.querySelector('a[href^="tel:"]')).toBeNull();
  expect(facts(container)).toContain("Phone: Not given");
});

it("every answer shows its question and option label, in config order, and the self-check text", async () => {
  fakeServers(
    detail({
      followup_answers: { air: "warm_air", above_90: "yes" },
      self_check_shown: "thermostat",
      self_check_tried: true,
    }),
  );
  const { container } = await open("/staff/requests/7");
  await sees(container, "Is it above 90 degrees inside?");

  expect(facts(container)).toEqual(
    expect.arrayContaining([
      "Category: Heating and cooling",
      "Description: AC blows warm air.",
      "Is it above 90 degrees inside?: Yes",
      "What comes out of the vents?: Warm air",
      "Self-check suggested: Check the thermostat is set to Cool.",
      "Tenant tried it: Yes",
    ]),
  );
  const order = facts(container);
  expect(
    order.findIndex((fact) => fact.startsWith("Is it above")),
  ).toBeLessThan(order.findIndex((fact) => fact.startsWith("What comes out")));
});

it("a question, option, or self-check no longer in config shows its raw id", async () => {
  fakeServers(
    detail({
      followup_answers: { retired: "maybe", air: "cold_air" },
      self_check_shown: "old_check",
    }),
  );
  const { container } = await open("/staff/requests/7");
  await sees(container, "What comes out of the vents?");
  expect(facts(container)).toEqual(
    expect.arrayContaining([
      "retired: maybe",
      "What comes out of the vents?: cold_air",
      "Self-check suggested: old_check",
    ]),
  );
});

it("no self-check says None and leaves out Tenant tried it", async () => {
  fakeServers(detail());
  const { container } = await open("/staff/requests/7");
  await sees(container, "Self-check suggested");
  expect(facts(container)).toContain("Self-check suggested: None");
  expect(container.textContent).not.toContain("Tenant tried it");
});

it('"Only if I\'m home" gets its own warning line, and entry notes show', async () => {
  fakeServers(
    detail({ entry_permission: "only_when_home", entry_notes: "Home after 5" }),
  );
  const { container } = await open("/staff/requests/7");
  await sees(container, "Only if I'm home");
  expect(container.textContent).toContain(
    "Do not enter unless the tenant is there.",
  );
  expect(container.textContent).toContain("Home after 5");
});

it("other entry permissions show their label with no warning line", async () => {
  fakeServers(detail({ entry_permission: "notify_first" }));
  const { container } = await open("/staff/requests/7");
  await sees(container, "Tell me first");
  expect(container.textContent).not.toContain("Do not enter");
});

it.each([
  [{}, []],
  [{ urgent: true }, ["Urgent:"]],
  [{ needs_review: true }, ["Needs review:"]],
  [{ urgent: true, needs_review: true }, ["Urgent:", "Needs review:"]],
  // Staff took it from the tenant directly, so it's unmatched but not flagged.
  [{ contact_matched: false }, []],
])("flags %o show banners %o", async (flags, banners) => {
  fakeServers(detail(flags));
  const { container } = await open("/staff/requests/7");
  await sees(container, "Ana Diaz");
  const shown = [...container.querySelectorAll("strong")]
    .map(({ textContent }) => textContent)
    .filter((text) => text === "Urgent:" || text === "Needs review:");
  expect(shown).toEqual(banners);
});

it("Back returns to the same filtered list", async () => {
  fakeServers(detail({ urgent: true }));
  const { container, router } = await open("/staff?urgent=true");
  await vi.waitFor(() =>
    expect(container.querySelector("table tbody a")).not.toBeNull(),
  );
  await click(container.querySelector("table tbody a"));
  await sees(container, "Back to list");
  expect(router.state.location.pathname).toBe("/staff/requests/7");

  await click(
    [...container.querySelectorAll("a")].find(({ textContent }) =>
      textContent?.includes("Back to list"),
    ),
  );
  expect(router.state.location.pathname).toBe("/staff");
  expect(router.state.location.search).toBe("?urgent=true");
});

it("a request opened directly goes back to the plain list", async () => {
  fakeServers(detail());
  const { container } = await open("/staff/requests/7");
  await sees(container, "Back to list");
  const back = [...container.querySelectorAll("a")].find(({ textContent }) =>
    textContent?.includes("Back to list"),
  )!;
  expect(back.getAttribute("href")).toBe("/staff");
});

const thumbnails = (container: HTMLElement) =>
  [...container.querySelectorAll("ul img")] as HTMLImageElement[];

it("each thumbnail fetches its own link and shows a skeleton until it loads", async () => {
  const { photoCalls } = fakeServers(detail({ photo_ids: [11, 12] }));
  const { container } = await open("/staff/requests/7");
  await vi.waitFor(() => expect(thumbnails(container)).toHaveLength(2));

  expect(photoCalls).toEqual({ "11": 1, "12": 1 });
  expect(thumbnails(container)[0].src).toBe(
    "https://bucket.test.invalid/11?v=1",
  );
  expect(container.textContent).toContain("Loading Photo 1 of 2");
  await fire(thumbnails(container)[0], "load");
  expect(container.textContent).not.toContain("Loading Photo 1 of 2");
  expect(container.textContent).toContain("Loading Photo 2 of 2");
});

it("an expired link is fetched again when the image errors, then Retry if it fails again", async () => {
  const { photoCalls } = fakeServers(detail({ photo_ids: [11] }));
  const { container } = await open("/staff/requests/7");
  await vi.waitFor(() => expect(thumbnails(container)).toHaveLength(1));

  await fire(thumbnails(container)[0], "error");
  await vi.waitFor(() =>
    expect(thumbnails(container)[0].src).toBe(
      "https://bucket.test.invalid/11?v=2",
    ),
  );
  expect(button(container, "Retry")).toBeUndefined();

  await fire(thumbnails(container)[0], "error");
  await vi.waitFor(() => expect(button(container, "Retry")).toBeDefined());
  expect(photoCalls["11"]).toBe(2);

  await click(button(container, "Retry"));
  await vi.waitFor(() =>
    expect(thumbnails(container)[0]?.src).toBe(
      "https://bucket.test.invalid/11?v=3",
    ),
  );
});

it("a link that fails to fetch offers Retry", async () => {
  fakeServers(detail({ photo_ids: [11] }), (photoId, call) =>
    call === 1
      ? json({ detail: "Down" }, 503)
      : json({ url: `https://bucket.test.invalid/${photoId}` }),
  );
  const { container } = await open("/staff/requests/7");
  await vi.waitFor(() => expect(button(container, "Retry")).toBeDefined());
  await click(button(container, "Retry"));
  await vi.waitFor(() => expect(thumbnails(container)).toHaveLength(1));
});

it("the keyboard steps through every photo in the viewer, wrapping round, and Close closes it", async () => {
  fakeServers(detail({ photo_ids: [11, 12, 13] }));
  const { container } = await open("/staff/requests/7");
  await vi.waitFor(() => expect(thumbnails(container)).toHaveLength(3));
  const dialog = container.querySelector("dialog")!;
  expect(dialog.open).toBe(false);

  await click(thumbnails(container)[1].closest("button"));
  expect(dialog.open).toBe(true);
  const shown = () => dialog.querySelector("img")?.src;
  await vi.waitFor(() => expect(shown()).toContain("/12?"));

  const press = (key: string) =>
    act(async () =>
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      ),
    );
  await press("ArrowRight");
  expect(dialog.textContent).toContain("Photo 3 of 3");
  await vi.waitFor(() => expect(shown()).toContain("/13?"));
  await press("ArrowRight");
  await vi.waitFor(() => expect(shown()).toContain("/11?"));
  await press("ArrowLeft");
  await vi.waitFor(() => expect(shown()).toContain("/13?"));

  await click(button(dialog, "Next"));
  await vi.waitFor(() => expect(shown()).toContain("/11?"));
  await click(button(dialog, "Previous"));
  await vi.waitFor(() => expect(shown()).toContain("/13?"));

  await click(button(dialog, "Close"));
  expect(dialog.open).toBe(false);
  expect(dialog.querySelector("img")).toBeNull();
});

it("no photos says so", async () => {
  fakeServers(detail());
  const { container } = await open("/staff/requests/7");
  await sees(container, "No photos.");
});
