import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { siteConfig } from "../../shared/lib/siteConfig";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const API = "https://api.test.invalid/api/public";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const CONFIG = {
  emergency_number: "(000) 000-0000",
  require_emergency_ack: true,
  categories: [],
};
const UNITS: Record<string, { id: number; label: string }[]> = {
  "1": [
    { id: 11, label: "1A" },
    { id: 12, label: "1B" },
  ],
  "2": [{ id: 21, label: "2A" }],
  "3": [],
};

function fakeApi(routesOverride: Record<string, () => Response> = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    if (routesOverride[url]) return routesOverride[url]();
    if (url === `${API}/config`) return json(CONFIG);
    if (url === `${API}/properties`) {
      return json([
        { id: 1, name: "Oak" },
        { id: 2, name: "Pine" },
        { id: 3, name: "Empty" },
      ]);
    }
    const id = url.match(/properties\/(\d+)\/units$/)?.[1];
    if (id) return json(UNITS[id]);
    throw new Error(`Unexpected call to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const cleanups: (() => void)[] = [];

async function open() {
  vi.stubGlobal("scrollTo", vi.fn());
  const container = document.createElement("div");
  document.body.append(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <RouterProvider
          router={createMemoryRouter(routes, { initialEntries: ["/"] })}
        />
      </QueryClientProvider>,
    ),
  );
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

const control = <T extends HTMLElement = HTMLInputElement>(
  container: HTMLElement,
  name: string,
) => container.querySelector<T>(`[name="${name}"]`)!;

const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === text,
  );

/** Goes through the native setter, or React doesn't see the change. */
async function change(
  element: HTMLInputElement | HTMLSelectElement,
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

const formLoaded = (container: HTMLElement) =>
  vi.waitFor(() => expect(button(container, "Next")).toBeDefined());

async function pickUnit(container: HTMLElement) {
  await vi.waitFor(() =>
    expect(control(container, "property_id").disabled).toBe(false),
  );
  await change(control(container, "property_id"), "1");
  await vi.waitFor(() =>
    expect(control(container, "unit_id").disabled).toBe(false),
  );
  await change(control(container, "unit_id"), "11");
}

const next = (container: HTMLElement) =>
  act(async () => button(container, "Next")!.click());

it("with the API down, shows the banner, the number, and a working Retry", async () => {
  let down = true;
  fakeApi({
    [`${API}/config`]: () =>
      down ? json({ error: { code: "x" } }, 503) : json(CONFIG),
  });
  const container = await open();

  const retry = await vi.waitFor(() => {
    expect(button(container, "Retry")).toBeDefined();
    return button(container, "Retry")!;
  });
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector('a[href^="tel:"]')?.textContent).toBe(
    siteConfig.emergencyNumber,
  );

  down = false;
  await act(async () => retry.click());
  await formLoaded(container);
  expect(button(container, "Retry")).toBeUndefined();
});

it("shows a spinner while the config loads, and the banner too", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  const container = await open();

  expect(container.textContent).toContain("Loading the form");
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector('a[href="tel:0000000000"]')).not.toBeNull();
});

it("fetches the config once however many steps are visited", async () => {
  const fetchMock = fakeApi();
  const container = await open();
  await formLoaded(container);
  await pickUnit(container);
  await change(control(container, "tenant_name"), "Sam");
  await change(control(container, "phone"), "5551234567");
  await next(container);

  const calls = fetchMock.mock.calls.filter(([url]) => url === `${API}/config`);
  expect(calls).toHaveLength(1);
});

it("keeps the unit disabled until a property is chosen, and clears it on change", async () => {
  fakeApi();
  const container = await open();
  await formLoaded(container);
  const unit = control<HTMLSelectElement>(container, "unit_id");
  expect(unit.disabled).toBe(true);

  await pickUnit(container);
  expect(unit.value).toBe("11");

  await change(control(container, "property_id"), "2");
  await vi.waitFor(() =>
    expect([...unit.options].map((option) => option.text)).toEqual([
      "Choose your unit",
      "2A",
    ]),
  );
  expect(unit.value).toBe("");
});

it("says to call when a property has no units, and Next stays blocked", async () => {
  fakeApi();
  const container = await open();
  await formLoaded(container);
  await vi.waitFor(() =>
    expect(control(container, "property_id").disabled).toBe(false),
  );

  await change(control(container, "property_id"), "3");

  await vi.waitFor(() =>
    expect(container.textContent).toContain("No units listed. Please call us"),
  );
  await change(control(container, "tenant_name"), "Sam");
  await change(control(container, "phone"), "5551234567");
  await next(container);
  expect(container.querySelector("h2")?.textContent).toContain("Step 1 of 3");
  expect(document.activeElement).toBe(control(container, "unit_id"));
});

it("offers Retry when the unit list fails", async () => {
  let down = true;
  fakeApi({
    [`${API}/properties/1/units`]: () =>
      down ? json({ error: { code: "x" } }, 503) : json(UNITS["1"]),
  });
  const container = await open();
  await formLoaded(container);
  await vi.waitFor(() =>
    expect(control(container, "property_id").disabled).toBe(false),
  );
  await change(control(container, "property_id"), "1");
  const retry = await vi.waitFor(() => {
    expect(button(container, "Retry")).toBeDefined();
    return button(container, "Retry")!;
  });

  down = false;
  await act(async () => retry.click());

  await vi.waitFor(() =>
    expect(control(container, "unit_id").disabled).toBe(false),
  );
});

it("gives the contact fields the right keyboards and autofill", async () => {
  fakeApi();
  const container = await open();
  await formLoaded(container);

  const phone = control(container, "phone");
  expect(phone.type).toBe("tel");
  expect(phone.inputMode).toBe("tel");
  expect(phone.autocomplete).toBe("tel");
  const email = control(container, "email");
  expect(email.type).toBe("email");
  expect(email.inputMode).toBe("email");
  expect(email.autocomplete).toBe("email");
  expect(control(container, "tenant_name").autocomplete).toBe("name");
});

it("formats the phone as it is typed", async () => {
  fakeApi();
  const container = await open();
  await formLoaded(container);

  await change(control(container, "phone"), "5551234567");

  expect(control(container, "phone").value).toBe("(555) 123-4567");
});

it("Next shows the errors and focuses the first invalid field", async () => {
  fakeApi();
  const container = await open();
  await formLoaded(container);
  await vi.waitFor(() =>
    expect(control(container, "property_id").disabled).toBe(false),
  );
  expect(container.textContent).not.toContain("Phone or email is required");

  await next(container);

  expect(container.textContent).toContain("Phone or email is required");
  expect(document.activeElement).toBe(control(container, "property_id"));
  expect(container.querySelector("h2")?.textContent).toContain("Step 1 of 3");

  await pickUnit(container);
  await next(container);
  expect(document.activeElement).toBe(control(container, "tenant_name"));

  await change(control(container, "tenant_name"), "Sam");
  await next(container);
  expect(document.activeElement).toBe(control(container, "phone"));

  // An error goes away once its field is fixed.
  await change(control(container, "email"), "sam@example.com");
  expect(container.textContent).not.toContain("Phone or email is required");
});

it("moves focus to the heading and scrolls up on each step change, keeping values", async () => {
  fakeApi();
  const container = await open();
  await formLoaded(container);
  expect(button(container, "Back")).toBeUndefined();
  await pickUnit(container);
  await change(control(container, "tenant_name"), "Sam");
  await change(control(container, "email"), "sam@example.com");

  await next(container);

  const heading = container.querySelector("h2")!;
  expect(heading.textContent).toContain("Step 2 of 3");
  expect(document.activeElement).toBe(heading);
  expect(window.scrollTo).toHaveBeenCalledWith(0, 0);

  await next(container);
  expect(heading.textContent).toContain("Step 3 of 3");
  expect(button(container, "Next")).toBeUndefined();

  await act(async () => button(container, "Back")!.click());
  await act(async () => button(container, "Back")!.click());

  expect(heading.textContent).toContain("Step 1 of 3");
  expect(document.activeElement).toBe(heading);
  expect(control(container, "tenant_name").value).toBe("Sam");
  expect(control(container, "unit_id").value).toBe("11");
  // Coming back must not greet the tenant with old errors.
  expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
});
