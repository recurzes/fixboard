import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { routes } from "../../../app/routes";
import { signOut } from "../../../shared/lib/auth";
import { siteConfig } from "../../../shared/lib/siteConfig";
import type { PublicConfig } from "../../../shared/form/usePublicConfig";
import type { RequestDetail } from "./useRequest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const AUTH = "https://auth.test.invalid";
const API = "https://api.test.invalid";
const LIST = `${API}/api/staff/requests`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const CONFIG: PublicConfig = {
  emergency_number: "555-0100",
  require_emergency_ack: true,
  form_enabled: true,
  categories: [
    {
      id: "plumbing",
      label: "Plumbing",
      questions: [
        {
          id: "where",
          label: "Where is the problem?",
          type: "single_choice",
          required: true,
          options: [
            {
              value: "sink",
              label: "Sink",
              urgent: false,
              self_check: {
                id: "clogged_drain",
                text: "Try a plunger first.",
                pending_client_approval: false,
              },
            },
            {
              value: "ceiling",
              label: "Ceiling",
              urgent: true,
              self_check: null,
            },
          ],
        },
      ],
    },
  ],
};

/** A stand-in for the backend. Each POST answers with the RequestDetail the real route returns. */
function fakeServer() {
  const server = {
    posts: [] as Record<string, unknown>[],
    created: null as RequestDetail | null,
  };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === `${AUTH}/token`) return json({ token: "jwt" });
    if (url === `${API}/api/staff/me`) {
      return json({ name: "Sam Lee", email: "sam@example.com" });
    }
    if (url === `${API}/api/public/config`) return json(CONFIG);
    if (url === `${API}/api/public/properties`) {
      return json([{ id: 1, name: "Palm Court" }]);
    }
    if (url === `${API}/api/public/properties/1/units`) {
      return json([{ id: 3, label: "U3" }]);
    }
    if (url === `${API}/api/staff/assignees`) return json([]);
    if (url === `${LIST}/summary`) {
      return json({
        by_status: { new: 1, scheduled: 0, waiting_on_vendor: 0, done: 0 },
        open_urgent: 0,
        open_needs_review: 0,
      });
    }
    if (url === LIST && method === "POST") {
      const body = JSON.parse(init!.body as string);
      server.posts.push(body);
      server.created = {
        id: 9,
        reference_number: "MR-1009",
        property_id: 1,
        property_name: "Palm Court",
        unit_id: body.unit_id,
        unit_label: "U3",
        tenant_name: body.tenant_name,
        category: body.category,
        status: "new",
        urgent: false,
        // Staff-logged requests skip the review flag, even unmatched.
        needs_review: false,
        assignee_id: null,
        assignee_name: null,
        scheduled_at: null,
        created_at: "2026-11-02T15:00:00Z",
        phone: "+15551234567",
        email: null,
        description: body.description,
        followup_answers: body.followup_answers,
        entry_permission: body.entry_permission,
        entry_notes: body.entry_notes,
        source: body.source,
        contact_matched: false,
        // The server works this out from the answers, whoever logged it.
        self_check_shown: "clogged_drain",
        self_check_tried: false,
        emergency_ack_at: null,
        updated_at: "2026-11-02T15:00:00.123456Z",
        photo_ids: [],
        notes: [],
        history: [],
      };
      return json(server.created, 201);
    }
    if (url === `${LIST}/9`) return json(server.created);
    if (url.startsWith(LIST)) return json({ items: [], next_cursor: null });
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

async function open(ready = "How did it come in?") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const router = createMemoryRouter(routes, {
    initialEntries: ["/staff/requests/new"],
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
  await sees(container, ready);
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

const radio = (container: HTMLElement, value: string) =>
  container.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${value}"]`,
  )!;

function field<T extends HTMLElement>(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll("label")].find(
    ({ textContent }) => textContent === label,
  )!;
  return container.ownerDocument.getElementById(found.htmlFor) as T;
}

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

const facts = (container: HTMLElement) =>
  [...container.querySelectorAll("dt")].map(
    (term) => `${term.textContent}: ${term.nextElementSibling!.textContent}`,
  );

async function fillIn(container: HTMLElement) {
  await click(radio(container, "phone"));
  const property = field<HTMLSelectElement>(container, "Property");
  await vi.waitFor(() => expect(property.options).toHaveLength(2));
  await change(property, "1");
  const unit = field<HTMLSelectElement>(container, "Unit");
  await vi.waitFor(() => expect(unit.options).toHaveLength(2));
  await change(unit, "3");
  await change(field(container, "Tenant name"), "Ana Diaz");
  await change(field(container, "Phone"), "5551234567");
  await click(radio(container, "plumbing"));
  await click(radio(container, "sink"));
  await change(
    field(container, "Describe the problem (required)"),
    "Kitchen sink drains slowly.",
  );
  await click(radio(container, "anytime"));
}

it("checks every required field, Source included, before sending", async () => {
  const server = fakeServer();
  const { container } = await open();

  await click(button(container, "Log request"));

  for (const error of [
    "Choose how the request came in",
    "Choose your property",
    "Enter the tenant's name",
    "Phone or email is required",
    "Choose the kind of problem",
    "Describe the problem",
    "Choose when we can enter",
  ]) {
    expect(container.textContent).toContain(error);
  }
  expect(document.activeElement).toBe(radio(container, "phone"));
  expect(server.posts).toEqual([]);
  expect(container.querySelector('form [role="alert"]')!.textContent).toMatch(
    /^7 problems:/,
  );
});

it("offers Retry when the form can't load, with no tenant number to call", async () => {
  fakeServer();
  const inner = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) =>
    url === `${API}/api/public/config`
      ? json({ error: { code: "service_unavailable" } }, 503)
      : inner(url as never, init as never),
  );
  const { container } = await open("We can't load the form right now.");

  expect(button(container, "Retry")).toBeDefined();
  expect(container.querySelector('a[href^="tel:"]')).toBeNull();
});

it("leaves out the honeypot, the emergency tick, the privacy notice, the self-check, and the call-us callout", async () => {
  fakeServer();
  const { container } = await open();

  await click(radio(container, "plumbing"));
  await click(radio(container, "sink"));
  expect(container.textContent).not.toContain("Try a plunger first.");
  await click(radio(container, "ceiling"));
  expect(container.textContent).not.toContain("Please call");

  expect(container.querySelector('[name="website"]')).toBeNull();
  expect(container.textContent).not.toContain("This is not an emergency");
  expect(container.textContent).not.toContain(siteConfig.privacyNotice);
  expect(field(container, "Tenant name").getAttribute("autocomplete")).toBe(
    "off",
  );
});

it("logs a phone request and opens it with a toast, showing its source and no review flag", async () => {
  const server = fakeServer();
  const { container, router } = await open();
  await fillIn(container);

  // Two clicks before React re-renders still send one request, because the route has no idempotency key.
  const submit = button(container, "Log request");
  await act(async () => {
    submit.click();
    submit.click();
  });

  await vi.waitFor(() =>
    expect(router.state.location.pathname).toBe("/staff/requests/9"),
  );
  expect(server.posts).toEqual([
    {
      unit_id: 3,
      tenant_name: "Ana Diaz",
      phone: "(555) 123-4567",
      email: "",
      category: "plumbing",
      description: "Kitchen sink drains slowly.",
      entry_permission: "anytime",
      entry_notes: null,
      followup_answers: { where: "sink" },
      source: "phone",
    },
  ]);
  await sees(container, "Request logged");
  expect(facts(container)).toContain("Source: Phone call");
  expect(container.textContent).not.toContain("Needs review");
  // Nobody was shown the self-check the server recorded.
  expect(container.textContent).not.toContain("Self-check suggested");
  // Cleared, so a refresh doesn't toast again.
  expect(router.state.location.state).toBeNull();
});
