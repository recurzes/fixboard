import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import formConfig from "../../../../backend/app/intake/form_config.json";
import { routes } from "../../app/routes";
import { siteConfig } from "../../shared/lib/siteConfig";
import { fakeImageApis, photo } from "./photos.testutil";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const API = "https://api.test.invalid/api/public";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const option = (label: string, extra = {}) => ({
  value: label.toLowerCase(),
  label,
  urgent: false,
  self_check: null,
  ...extra,
});
const choice = (id: string, label: string, options: object[]) => ({
  id,
  label,
  type: "single_choice",
  required: true,
  options,
});
const CONFIG = {
  emergency_number: "(000) 000-0000",
  require_emergency_ack: true,
  form_enabled: true,
  categories: [
    {
      id: "ac",
      label: "AC",
      questions: [
        choice("above_90", "Above 90?", [
          option("Yes", { urgent: true }),
          option("No"),
        ]),
        choice("gas", "Gas?", [option("Yes", { urgent: true }), option("No")]),
        {
          id: "where",
          label: "Where?",
          type: "text",
          required: false,
          options: [],
        },
      ],
    },
    {
      id: "plumbing",
      label: "Plumbing",
      questions: [
        choice("problem", "Problem?", [
          option("Clogged", {
            self_check: {
              id: "drain",
              text: "Try a plunger",
              pending_client_approval: true,
            },
          }),
          option("Leak"),
        ]),
      ],
    },
  ],
};

type RawQuestion = {
  label: string;
  required: boolean;
  options?: { label: string; urgent?: boolean; self_check?: object }[];
};

// The server fills in these defaults when it serves the file.
const servedConfig = {
  ...formConfig,
  form_enabled: true,
  categories: formConfig.categories.map((category) => ({
    ...category,
    questions: category.questions.map((question: RawQuestion) => ({
      ...question,
      options: (question.options ?? []).map((option) => ({
        urgent: false,
        self_check: null,
        ...option,
      })),
    })),
  })),
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

async function reachStep2(container: HTMLElement) {
  await formLoaded(container);
  await pickUnit(container);
  await change(control(container, "tenant_name"), "Sam");
  await change(control(container, "email"), "sam@example.com");
  await next(container);
}

const group = (container: HTMLElement, question: string) =>
  [...container.querySelectorAll("fieldset")].find((fieldset) =>
    fieldset.querySelector("legend")!.textContent.startsWith(question),
  );

const radio = (container: HTMLElement, question: string, answer: string) =>
  [...group(container, question)!.querySelectorAll("label")]
    .find((label) => label.textContent === answer)!
    .querySelector("input")!;

const pick = (container: HTMLElement, question: string, answer: string) =>
  act(async () => radio(container, question, answer).click());

const category = (container: HTMLElement, label: string) =>
  pick(container, "What kind of problem", label);

const stepHeading = (container: HTMLElement) =>
  container.querySelector("h2")?.textContent;

// The number inside the error itself, not only in the banner above it.
const errorNumber = (container: HTMLElement) =>
  container.querySelector('[role="alert"] a[href^="tel:"]');

const callouts = (container: HTMLElement) =>
  container.querySelectorAll('[role="alert"] a[href="tel:0000000000"]');

const triedBox = (container: HTMLElement) =>
  [...container.querySelectorAll("label")]
    .find((label) => label.textContent === "I tried this")
    ?.querySelector("input");

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
  expect(errorNumber(container)).not.toBeNull();

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
    expect(container.textContent).toContain(
      `No units listed. Please call ${siteConfig.emergencyNumber}`,
    ),
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
  expect(errorNumber(container)).not.toBeNull();

  down = false;
  await act(async () => retry.click());

  await vi.waitFor(() =>
    expect(control(container, "unit_id").disabled).toBe(false),
  );
});

it("gives the number and Retry when the property list fails", async () => {
  fakeApi({
    [`${API}/properties`]: () => json({ error: { code: "x" } }, 503),
  });
  const container = await open();
  await formLoaded(container);

  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "We can't load the property list right now.",
    ),
  );
  expect(errorNumber(container)).not.toBeNull();
  expect(button(container, "Retry")).toBeDefined();
});

it("says to call when no properties are listed", async () => {
  fakeApi({ [`${API}/properties`]: () => json([]) });
  const container = await open();
  await formLoaded(container);

  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      `No properties listed. Please call ${siteConfig.emergencyNumber}`,
    ),
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
  const summary = container.querySelector('form [role="alert"]')!;
  expect(summary.textContent).toMatch(/^3 problems:/);
  expect(summary.querySelectorAll("li")).toHaveLength(3);
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

  await category(container, "Plumbing");
  await pick(container, "Problem?", "Leak");
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

it("renders every category and question in the real config, marking required ones", async () => {
  fakeApi({ [`${API}/config`]: () => json(servedConfig) });
  const container = await open();
  await reachStep2(container);
  expect(servedConfig.categories).toHaveLength(7);

  for (const { label, questions } of servedConfig.categories) {
    await category(container, label);
    for (const question of questions) {
      const mark = `${question.label} (required)`;
      expect(container.textContent?.includes(mark)).toBe(question.required);
      expect(container.textContent).toContain(question.label);
    }
  }
});

it("shows a self-check only on the answers the real config gives one", async () => {
  fakeApi({ [`${API}/config`]: () => json(servedConfig) });
  const container = await open();
  await reachStep2(container);

  const withCard: string[] = [];
  for (const { label, questions } of servedConfig.categories) {
    await category(container, label);
    for (const question of questions) {
      for (const { label: answer, self_check } of question.options) {
        await pick(container, question.label, answer);
        expect(!!triedBox(container)).toBe(!!self_check);
        if (triedBox(container)) withCard.push(answer);
      }
    }
  }
  expect(withCard).toEqual([
    "A clogged drain",
    "An outlet or lights stopped working",
  ]);
});

it("keeps Next blocked until the category and required answers are in", async () => {
  fakeApi();
  const container = await open();
  await reachStep2(container);

  await next(container);
  expect(stepHeading(container)).toContain("Step 2 of 3");
  expect(container.textContent).toContain("Choose the kind of problem");
  expect(document.activeElement).toBe(radio(container, "What kind", "AC"));

  await category(container, "AC");
  expect(container.querySelector('[aria-invalid="true"]')).toBeNull();

  await next(container);
  expect(stepHeading(container)).toContain("Step 2 of 3");
  expect(document.activeElement).toBe(radio(container, "Above 90?", "Yes"));

  await pick(container, "Above 90?", "No");
  await next(container);
  expect(document.activeElement).toBe(radio(container, "Gas?", "Yes"));

  // "Where?" is optional, so it stays empty and Next goes through.
  await pick(container, "Gas?", "No");
  await next(container);
  expect(stepHeading(container)).toContain("Step 3 of 3");
});

it("forgets the answers when the category changes", async () => {
  fakeApi();
  const container = await open();
  await reachStep2(container);
  await category(container, "AC");
  await pick(container, "Above 90?", "Yes");
  await change(control(container, "where"), "Bedroom");

  await category(container, "Plumbing");
  await category(container, "AC");

  expect(radio(container, "Above 90?", "Yes").checked).toBe(false);
  expect(control(container, "where").value).toBe("");
  expect(callouts(container)).toHaveLength(0);
});

it("hides the self-check and drops its tick when the answer changes", async () => {
  fakeApi();
  const container = await open();
  await reachStep2(container);
  await category(container, "Plumbing");
  expect(triedBox(container)).toBeUndefined();

  await pick(container, "Problem?", "Clogged");
  expect(container.textContent).toContain("Try a plunger");
  await act(async () => triedBox(container)!.click());
  expect(triedBox(container)!.checked).toBe(true);

  await pick(container, "Problem?", "Leak");
  expect(container.textContent).not.toContain("Try a plunger");

  await pick(container, "Problem?", "Clogged");
  expect(triedBox(container)!.checked).toBe(false);
});

it("says to call on an urgent answer, once, and still reaches step 3", async () => {
  const fetchMock = fakeApi();
  const container = await open();
  await reachStep2(container);
  await category(container, "AC");
  expect(callouts(container)).toHaveLength(0);

  await pick(container, "Above 90?", "Yes");
  expect(callouts(container)).toHaveLength(1);
  expect(callouts(container)[0].textContent).toBe(siteConfig.emergencyNumber);
  expect(container.textContent).toContain("You can still send this request.");

  await pick(container, "Gas?", "Yes");
  expect(callouts(container)).toHaveLength(1);

  await pick(container, "Above 90?", "No");
  expect(callouts(container)).toHaveLength(1);

  await pick(container, "Gas?", "No");
  expect(callouts(container)).toHaveLength(0);

  await pick(container, "Gas?", "Yes");
  await next(container);
  expect(stepHeading(container)).toContain("Step 3 of 3");
  // Every call so far is a plain read, so nothing about the answer left the browser.
  for (const [, init] of fetchMock.mock.calls as unknown as [
    string,
    RequestInit | undefined,
  ][]) {
    expect(init?.method ?? "GET").toBe("GET");
  }
});

async function reachStep3(container: HTMLElement) {
  await reachStep2(container);
  await category(container, "Plumbing");
  await pick(container, "Problem?", "Leak");
  await next(container);
  expect(stepHeading(container)).toContain("Step 3 of 3");
}

const description = (container: HTMLElement) =>
  control<HTMLTextAreaElement>(container, "description");

const submit = (container: HTMLElement) =>
  act(async () => button(container, "Submit")!.click());

/** True if the browser would ask before leaving the page. */
function promptsOnLeave() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it("counts the description, warns near the limit, and stops at the backend's", async () => {
  fakeApi();
  const container = await open();
  await reachStep3(container);
  expect(container.textContent).toContain(
    "What is happening? When did it start?",
  );
  expect(description(container).maxLength).toBe(5000);
  expect(container.textContent).toContain("0 of 5000 characters");

  await change(description(container), "x".repeat(4499));
  expect(container.textContent).toContain("4499 of 5000 characters");
  expect(container.querySelector('[aria-live="polite"]')).toBeNull();

  await change(description(container), "x".repeat(4500));
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
    "500 characters left",
  );

  await change(description(container), "x".repeat(5000));
  expect(container.textContent).toContain("0 characters left");
});

it("offers the backend's entry values, the notice, and a hint for only if I'm home", async () => {
  fakeApi();
  const container = await open();
  await reachStep3(container);
  const question = "Can we enter your home?";
  const values = [...group(container, question)!.querySelectorAll("input")].map(
    ({ value }) => value,
  );
  expect(values).toEqual(["anytime", "notify_first", "only_when_home"]);
  expect(container.textContent).toContain(siteConfig.entryNotice);
  const hint = "Tell us the days and times you're home";
  expect(container.textContent).not.toContain(hint);

  await pick(container, question, "Only if I'm home");
  expect(container.textContent).toContain(hint);

  await pick(container, question, "Anytime");
  expect(container.textContent).not.toContain(hint);
  expect(control<HTMLTextAreaElement>(container, "entry_notes").maxLength).toBe(
    1000,
  );
});

it("Submit shows each missing field in page order, and stays until the box is ticked", async () => {
  fakeApi();
  const container = await open();
  await reachStep3(container);
  const box = control(container, "not_an_emergency");

  await submit(container);
  expect(document.activeElement).toBe(description(container));

  await change(description(container), "The sink leaks");
  await submit(container);
  expect(document.activeElement).toBe(
    radio(container, "Can we enter your home?", "Anytime"),
  );

  await pick(container, "Can we enter your home?", "Anytime");
  await submit(container);
  expect(document.activeElement).toBe(box);
  expect(container.textContent).toContain("Confirm this is not an emergency");

  await act(async () => box.click());
  await submit(container);
  expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
  expect(stepHeading(container)).toContain("Step 3 of 3");
});

it("puts the box directly above Submit, with the number, and the privacy notice under it", async () => {
  fakeApi();
  const container = await open();
  await reachStep3(container);
  const box = control(container, "not_an_emergency");
  const submitButton = button(container, "Submit")!;
  const notice = [...container.querySelectorAll("p")].find(
    (paragraph) => paragraph.textContent === siteConfig.privacyNotice,
  )!;

  const follows = (a: Node, b: Node) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
  expect(follows(box, submitButton)).toBeTruthy();
  expect(follows(submitButton, notice)).toBeTruthy();
  // Nothing to fill in sits between the box and Submit.
  const controls = [...container.querySelectorAll("input, textarea, select")];
  expect(controls.at(-1)).toBe(box);
  expect(box.closest("div")!.parentElement!.textContent).toContain(
    `flooding, call ${siteConfig.emergencyNumber}.`,
  );
});

it("hides the box and lets Submit through when the config switches it off", async () => {
  fakeApi({
    [`${API}/config`]: () => json({ ...CONFIG, require_emergency_ack: false }),
  });
  const container = await open();
  await reachStep3(container);
  expect(control(container, "not_an_emergency")).toBeNull();

  await change(description(container), "The sink leaks");
  await pick(container, "Can we enter your home?", "Anytime");
  await submit(container);
  expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
});

it("asks before leaving once something is typed, and not after", async () => {
  fakeApi();
  const container = await open();
  await formLoaded(container);
  expect(promptsOnLeave()).toBe(false);

  await change(control(container, "tenant_name"), "Sam");
  expect(promptsOnLeave()).toBe(true);

  await change(control(container, "tenant_name"), "");
  expect(promptsOnLeave()).toBe(false);
});

it("never holds up a call to the emergency number with the prompt", async () => {
  fakeApi();
  const container = await open();
  await formLoaded(container);
  await change(control(container, "tenant_name"), "Sam");

  act(() => container.querySelector<HTMLElement>('a[href^="tel:"]')!.focus());

  expect(promptsOnLeave()).toBe(false);
});

it("never asks once the form has left the page, as on the confirmation page", async () => {
  fakeApi();
  const client = new QueryClient();
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  );
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  await formLoaded(container);
  await change(control(container, "tenant_name"), "Sam");
  expect(promptsOnLeave()).toBe(true);

  await act(async () => router.navigate("/done"));

  expect(container.textContent).toContain("Thank you");
  expect(promptsOnLeave()).toBe(false);
});

const CANNOT_DECODE = () => Promise.reject(new Error("cannot decode"));

const pickPhotos = (container: HTMLElement, files: File[]) =>
  act(async () => {
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

const removeButton = (container: HTMLElement, label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

const previewSources = (container: HTMLElement) =>
  [...container.querySelectorAll("img")].map((image) => image.src);

async function photosOpen() {
  fakeApi();
  const container = await open();
  await reachStep3(container);
  return container;
}

it("opens the camera or library for several images, without forcing the camera", async () => {
  fakeImageApis();
  const container = await photosOpen();
  const input =
    container.querySelector<HTMLInputElement>('input[type="file"]')!;

  expect(input.multiple).toBe(true);
  expect(input.accept).toBe("image/*");
  expect(input.hasAttribute("capture")).toBe(false);
  expect(container.textContent).toContain("0 of 5");
});

it("lists chosen photos with a count, and refuses a sixth with a message", async () => {
  fakeImageApis();
  const container = await photosOpen();

  await pickPhotos(container, [photo("1.jpg"), photo("2.jpg")]);
  expect(container.textContent).toContain("2 of 5");
  expect(container.textContent).toContain("1.jpg");

  await pickPhotos(
    container,
    ["3", "4", "5"].map((n) => photo(`${n}.jpg`)),
  );
  expect(container.textContent).toContain("5 of 5");
  expect(container.querySelector('[role="alert"]')).toBeNull();

  await pickPhotos(container, [photo("6.jpg")]);
  expect(container.textContent).toContain("5 of 5");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "6.jpg: You can add up to 5 photos",
  );
  await vi.waitFor(() => expect(previewSources(container)).toHaveLength(5));
});

it("shows one message per refused file, and clears them on the next pick", async () => {
  fakeImageApis();
  const container = await photosOpen();
  await pickPhotos(container, [photo("a.jpg")]);

  await pickPhotos(container, [photo("clip.mp4", "video/mp4"), photo("a.jpg")]);
  const messages = container.querySelectorAll('[role="alert"] li');
  expect([...messages].map((item) => item.textContent)).toEqual([
    "clip.mp4: Please choose a JPG, PNG, or HEIC photo",
    "a.jpg: You already added this photo",
  ]);

  await pickPhotos(container, [photo("b.jpg")]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("disables Submit while preparing, then shows the thumbnail and restores it", async () => {
  let finish = () => {};
  fakeImageApis({
    decode: () => new Promise((resolve) => (finish = resolve)),
  });
  const container = await photosOpen();

  await pickPhotos(container, [photo("a.jpg")]);
  expect(button(container, "Preparing photos")).toBeUndefined();
  const busy = container.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )!;
  expect(busy.disabled).toBe(true);
  expect(busy.textContent).toContain("Preparing photos");
  expect(container.textContent).toContain("1 of 5. Preparing photos");
  expect(previewSources(container)).toEqual([]);

  await act(async () => finish());

  await vi.waitFor(() =>
    expect(button(container, "Submit")?.disabled).toBe(false),
  );
  expect(previewSources(container)).toHaveLength(1);
  expect(container.textContent).not.toContain("Preparing photos");
});

it("shrinks one photo at a time", async () => {
  const finishes: (() => void)[] = [];
  fakeImageApis({
    decode: () => new Promise((resolve) => finishes.push(resolve)),
  });
  const container = await photosOpen();

  await pickPhotos(container, [photo("a.jpg"), photo("b.jpg")]);
  expect(finishes).toHaveLength(1);

  await act(async () => finishes[0]());
  await vi.waitFor(() => expect(finishes).toHaveLength(2));
  await act(async () => finishes[1]());
  await vi.waitFor(() => expect(button(container, "Submit")).toBeDefined());
});

it("removing a photo revokes its URL, frees its place, and keeps focus", async () => {
  const { revoked } = fakeImageApis();
  const container = await photosOpen();
  await pickPhotos(container, [photo("a.jpg"), photo("b.jpg")]);
  await vi.waitFor(() => expect(previewSources(container)).toHaveLength(2));
  const [first, second] = previewSources(container);

  await act(async () =>
    removeButton(container, "Remove photo 1, a.jpg").click(),
  );

  expect(revoked).toContain(first);
  expect(revoked).not.toContain(second);
  expect(previewSources(container)).toEqual([second]);
  expect(container.textContent).toContain("1 of 5");
  expect(document.activeElement).toBe(button(container, "Add photos"));

  // The same photo can be chosen again, and its label takes the next number.
  await pickPhotos(container, [photo("a.jpg")]);
  await vi.waitFor(() => expect(previewSources(container)).toHaveLength(2));
  expect(removeButton(container, "Remove photo 2, a.jpg")).not.toBeNull();
});

it("drops a photo removed while preparing, without leaking a URL", async () => {
  let finish = () => {};
  const { created, revoked } = fakeImageApis({
    decode: () => new Promise((resolve) => (finish = resolve)),
  });
  const container = await photosOpen();
  await pickPhotos(container, [photo("a.jpg")]);

  await act(async () =>
    removeButton(container, "Remove photo 1, a.jpg").click(),
  );
  expect(button(container, "Submit")?.disabled).toBe(false);
  await act(async () => finish());

  expect(previewSources(container)).toEqual([]);
  expect(container.textContent).toContain("0 of 5");
  await vi.waitFor(() => expect(revoked).toEqual(created));
  // Only the decoding URL, and no preview for a photo that's gone.
  expect(created).toHaveLength(1);
});

it("keeps photos through a change of step, and revokes every URL on leaving", async () => {
  const { created, revoked } = fakeImageApis();
  const container = await photosOpen();
  await pickPhotos(container, [photo("a.jpg"), photo("b.jpg")]);
  await vi.waitFor(() => expect(previewSources(container)).toHaveLength(2));
  const before = previewSources(container);

  await act(async () => button(container, "Back")!.click());
  await next(container);

  expect(stepHeading(container)).toContain("Step 3 of 3");
  expect(previewSources(container)).toEqual(before);

  cleanups.splice(0).forEach((cleanup) => cleanup());
  expect(new Set(revoked)).toEqual(new Set(created));
});

it("asks before leaving when the only data is a photo", async () => {
  fakeImageApis();
  const container = await photosOpen();
  await pickPhotos(container, [photo("a.jpg")]);
  expect(promptsOnLeave()).toBe(true);
});

it("keeps a photo the browser can't read, with no broken thumbnail", async () => {
  fakeImageApis({ decode: CANNOT_DECODE });
  const container = await photosOpen();

  await pickPhotos(container, [photo("a.heic", "image/heic")]);

  await vi.waitFor(() =>
    expect(button(container, "Submit")?.disabled).toBe(false),
  );
  expect(container.textContent).toContain("1 of 5");
  expect(container.textContent).toContain("No preview");
  expect(previewSources(container)).toEqual([]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("asks for a JPG or PNG when an unreadable photo is over the limit", async () => {
  fakeImageApis({ decode: CANNOT_DECODE });
  const container = await photosOpen();
  const big = photo("a.heic", "image/heic", siteConfig.maxPhotoBytes + 1);

  await pickPhotos(container, [big, photo("b.heic", "image/heic")]);

  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "a.heic: Please choose a JPG or PNG",
    ),
  );
  await vi.waitFor(() =>
    expect(button(container, "Submit")?.disabled).toBe(false),
  );
  expect(container.textContent).toContain("1 of 5");
  expect(removeButton(container, "Remove photo 1, b.heic")).not.toBeNull();
});
